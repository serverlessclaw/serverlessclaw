import { IMemory, Message, MessageRole, IProvider, ReasoningProfile } from '../types/index';
import { LIMITS } from '../constants';
import { CONFIG_DEFAULTS } from '../config-defaults';
import { logger } from '../logger';
import { getContextStrategy, ProviderContextStrategy } from './context-strategies';

export interface ManagedContext {
  messages: Message[];
  tokenEstimate: number;
  tierBreakdown: {
    systemPrompt: number;
    compressedHistory: number;
    activeWindow: number;
    factsExtracted: number;
  };
}

export interface GetManagedContextOptions {
  safetyMargin?: number;
  summaryRatio?: number;
  activeWindowRatio?: number;
  triggerRatio?: number;
  model?: string;
  provider?: string;
}

interface MessageBlock {
  messages: Message[];
  startIndex: number;
  score: number;
  tokens: number;
}

export class ContextManager {
  private static readonly CHARS_PER_TOKEN = 3;

  private static readonly PRIORITY = {
    SYSTEM: 1.0,
    TOOL_ERROR: 0.9,
    USER: 0.8,
    TOOL_RESULT: 0.6,
    ASSISTANT: 0.4,
  } as const;

  static async getManagedContext(
    history: Message[],
    summary: string | null,
    systemPrompt: string,
    limit: number = LIMITS.MAX_CONTEXT_LENGTH,
    options?: GetManagedContextOptions
  ): Promise<ManagedContext> {
    const strategy = getContextStrategy(options?.model, options?.provider);
    const contextLimit = Math.min(limit, strategy.maxContextTokens);

    const safetyMargin =
      options?.safetyMargin ??
      (await this.getConfigValue(
        'CONTEXT_SAFETY_MARGIN',
        CONFIG_DEFAULTS.CONTEXT_SAFETY_MARGIN.code
      ));
    const summaryRatio =
      options?.summaryRatio ??
      (await this.getConfigValue(
        'CONTEXT_SUMMARY_RATIO',
        CONFIG_DEFAULTS.CONTEXT_SUMMARY_RATIO.code
      ));
    const activeWindowRatio =
      options?.activeWindowRatio ??
      (await this.getConfigValue(
        'CONTEXT_ACTIVE_WINDOW_RATIO',
        CONFIG_DEFAULTS.CONTEXT_ACTIVE_WINDOW_RATIO.code
      ));

    // Filter out existing system messages from history to prevent duplication
    // when getManagedContext is called mid-loop with an already managed array.
    const cleanHistory = history.filter((msg) => msg.role !== MessageRole.SYSTEM);

    const systemMessage: Message = { role: MessageRole.SYSTEM, content: systemPrompt };
    const systemTokens = this.estimateTokens([systemMessage]);

    const safetyBudget = Math.floor(contextLimit * safetyMargin);
    const reservedTokens = strategy.reservedResponseTokens;
    const availableTokens = contextLimit - systemTokens - safetyBudget - reservedTokens;

    const compressedBudget = Math.floor(availableTokens * summaryRatio);
    const activeBudget = Math.floor(availableTokens * activeWindowRatio);

    const summaryMessage: Message | null = summary
      ? {
          role: MessageRole.SYSTEM,
          content: `[PREVIOUS_HISTORY_SUMMARY]: ${summary}\n\nThe above is a summary of earlier parts of this conversation.`,
        }
      : null;

    const summaryTokens = summaryMessage ? this.estimateTokens([summaryMessage]) : 0;

    const compressedFactLines: string[] = [];
    let compressedTokens = summaryTokens;

    if (compressedBudget > summaryTokens + 50) {
      const keyFacts = this.extractKeyFacts(cleanHistory);
      for (const fact of keyFacts) {
        const factToken = this.estimateTokens([{ role: MessageRole.SYSTEM, content: fact }]);
        if (compressedTokens + factToken <= compressedBudget) {
          compressedFactLines.push(fact);
          compressedTokens += factToken;
        } else {
          break;
        }
      }
    }

    let compressedMessage: Message | null = null;
    if (compressedFactLines.length > 0) {
      compressedMessage = {
        role: MessageRole.SYSTEM,
        content: `[KEY_FACTS]:\n${compressedFactLines.map((f) => `• ${f}`).join('\n')}${
          summaryMessage ? `\n\n${summaryMessage.content}` : ''
        }`,
      };
    } else if (summaryMessage) {
      compressedMessage = summaryMessage;
    }

    const compressedTierTokens = compressedMessage ? this.estimateTokens([compressedMessage]) : 0;
    const activeBudgetRemaining = activeBudget;

    // Group messages into atomic blocks to preserve tool_calls + tool responses parity
    const blocks: MessageBlock[] = [];
    let i = 0;
    while (i < cleanHistory.length) {
      const msg = cleanHistory[i];
      if (msg.role === MessageRole.ASSISTANT && msg.tool_calls && msg.tool_calls.length > 0) {
        const blockMessages = [msg];
        const startIndex = i;
        i++;
        // Gather all subsequent TOOL messages
        while (i < cleanHistory.length && cleanHistory[i].role === MessageRole.TOOL) {
          blockMessages.push(cleanHistory[i]);
          i++;
        }
        blocks.push({ messages: blockMessages, startIndex, score: 0, tokens: 0 });
      } else {
        blocks.push({ messages: [msg], startIndex: i, score: 0, tokens: 0 });
        i++;
      }
    }

    const scoredBlocks = blocks.map((block) => {
      let maxScore = 0;
      let totalTokens = 0;
      for (let j = 0; j < block.messages.length; j++) {
        const msg = block.messages[j];
        const msgIndex = block.startIndex + j;
        const score = this.scoreMessagePriority(msg, msgIndex, cleanHistory.length, strategy);
        if (score > maxScore) maxScore = score;
        totalTokens += this.estimateTokens([msg]);
      }
      return { ...block, score: maxScore, tokens: totalTokens };
    });

    // Sort blocks descending by score. If ties, descending by startIndex (newer first)
    scoredBlocks.sort((a, b) => {
      if (Math.abs(b.score - a.score) > 0.05) return b.score - a.score;
      return b.startIndex - a.startIndex;
    });

    const activeBlocks: MessageBlock[] = [];
    let activeTokens = 0;

    for (const block of scoredBlocks) {
      if (activeTokens + block.tokens > activeBudgetRemaining) continue;
      activeBlocks.push(block);
      activeTokens += block.tokens;
    }

    // Restore chronological order
    activeBlocks.sort((a, b) => a.startIndex - b.startIndex);
    const activeMessages = activeBlocks.flatMap((b) => b.messages);

    const baseMessages: Message[] = [systemMessage];
    if (compressedMessage) {
      baseMessages.push(compressedMessage);
    }

    return {
      messages: [...baseMessages, ...activeMessages],
      tokenEstimate: systemTokens + compressedTierTokens + activeTokens,
      tierBreakdown: {
        systemPrompt: systemTokens,
        compressedHistory: compressedTierTokens,
        activeWindow: activeTokens,
        factsExtracted: compressedFactLines.length,
      },
    };
  }

  static scoreMessagePriority(
    msg: Message,
    recencyIndex: number,
    totalMessages: number,
    strategy?: ProviderContextStrategy
  ): number {
    let base: number;

    if (msg.role === MessageRole.SYSTEM) {
      base = this.PRIORITY.SYSTEM;
    } else if (msg.role === MessageRole.TOOL) {
      const isError = this.isToolError(msg.content ?? '');
      if (isError) {
        base = this.PRIORITY.TOOL_ERROR;
      } else {
        base =
          strategy?.toolResultPriority === 'high'
            ? this.PRIORITY.TOOL_ERROR - 0.1
            : this.PRIORITY.TOOL_RESULT;
      }
    } else if (msg.role === MessageRole.USER) {
      base = this.PRIORITY.USER;
    } else {
      base = this.PRIORITY.ASSISTANT;
    }

    const recencyBonus = totalMessages > 0 ? 0.1 * (recencyIndex / totalMessages) : 0;
    const lengthPenalty = (msg.content ?? '').length > 4000 ? -0.1 : 0;

    return Math.max(0, Math.min(1, base + recencyBonus + lengthPenalty));
  }

  static extractKeyFacts(messages: Message[]): string[] {
    const facts: string[] = [];

    for (const msg of messages) {
      if (msg.role !== MessageRole.TOOL && msg.role !== MessageRole.ASSISTANT) continue;
      const content = msg.content ?? '';

      // Match paths ignoring boundary quotes
      const filePathRegex =
        /(?:^|\s|["'`])(\/[^\s"']+\.(?:ts|tsx|js|jsx|py|sh|yaml|yml|json|md|sql|html|css))(?:["'`]|\s|$)/gm;
      let match;
      while ((match = filePathRegex.exec(content)) !== null) {
        const fact = `file:${match[1]}`;
        if (fact.length <= 120 && !facts.includes(fact)) facts.push(fact);
      }

      const errorMatch = content.match(/(?:Error|FAIL|Exception|Failed)[^\n]{0,80}/);
      if (errorMatch && errorMatch[0].length <= 120) {
        const fact = `err:${errorMatch[0].trim()}`;
        if (!facts.includes(fact)) facts.push(fact);
      }

      const commitMatch = content.match(/\b([a-f0-9]{7,40})\b/i);
      if (commitMatch) {
        const fact = `commit:${commitMatch[1]}`;
        if (!facts.includes(fact)) facts.push(fact);
      }

      const statusMatch = content.match(/(?:BUILD|TEST|DEPLOY|SUCCESS|FAILED|STATUS)[^\n]{0,60}/);
      if (statusMatch && statusMatch[0].length <= 120) {
        const fact = `status:${statusMatch[0].trim()}`;
        if (!facts.includes(fact)) facts.push(fact);
      }

      const decisionMatch = content.match(
        /(?:decision|chose to|will do|proceeding with)[^\n]{0,100}/i
      );
      if (decisionMatch && decisionMatch[0].length <= 120) {
        const fact = `dec:${decisionMatch[0].trim()}`;
        if (!facts.includes(fact)) facts.push(fact);
      }
    }

    return facts.slice(0, 20);
  }

  static isToolError(content: string): boolean {
    const lower = content.toLowerCase();
    return (
      /error:|exception|failed|failure|exit code [1-9]|reject|timeout/i.test(lower) &&
      (lower.includes('error') ||
        lower.includes('exception') ||
        lower.includes('failed') ||
        lower.includes('failure') ||
        /exit code [1-9]/.test(lower))
    );
  }

  static estimateTokens(messages: Message[], charsPerToken?: number): number {
    const ratio = charsPerToken ?? this.CHARS_PER_TOKEN;
    let charCount = 0;
    for (const msg of messages) {
      charCount += (msg.content || '').length;
      if (msg.tool_calls) {
        charCount += JSON.stringify(msg.tool_calls).length;
      }
    }
    return Math.ceil(charCount / ratio);
  }

  static async needsSummarization(
    history: Message[],
    limit: number = LIMITS.MAX_CONTEXT_LENGTH,
    triggerRatio?: number,
    model?: string,
    provider?: string
  ): Promise<boolean> {
    const strategy = getContextStrategy(model, provider);
    const contextLimit = Math.min(limit, strategy.maxContextTokens);

    let ratio: number = triggerRatio ?? strategy.compressionTriggerPercent / 100;
    if (triggerRatio === undefined) {
      try {
        const { ConfigManager } = await import('../registry/config');
        const customRatio = await ConfigManager.getTypedConfig<number>(
          CONFIG_DEFAULTS.CONTEXT_SUMMARY_TRIGGER_RATIO.configKey!,
          -1
        );
        if (customRatio !== -1) ratio = customRatio;
      } catch {
        // use strategy default
      }
    }
    return this.estimateTokens(history) > contextLimit * ratio;
  }

  static async summarize(
    memory: IMemory,
    userId: string,
    provider: IProvider,
    history: Message[]
  ): Promise<void> {
    const previousSummary = await memory.getSummary(userId);
    const keyFacts = this.extractKeyFacts(history);
    const factContext =
      keyFacts.length > 0
        ? `KEY FACTS FROM RECENT MESSAGES:\n${keyFacts.map((f) => `• ${f}`).join('\n')}\n\n`
        : '';

    const summarizationPrompt = `
      You are a memory management system for an AI agent.
      Summarize the following conversation history into a concise, high-density bulleted list of key facts, decisions, and user preferences.
      ${previousSummary ? `Incorporate this previous summary into your new summary: ${previousSummary}` : ''}

      ${factContext}
      CONVERSATION HISTORY:
      ${history.map((m) => `${m.role}: ${m.content}`).join('\n')}
    `;

    try {
      const response = await provider.call(
        [{ role: MessageRole.SYSTEM, content: summarizationPrompt }],
        [],
        ReasoningProfile.FAST
      );

      if (response.content) {
        await memory.updateSummary(userId, response.content);
        logger.info(`Successfully updated summary for session ${userId}`);
      }

      // Persist summarization token usage
      if (response.usage && response.usage.total_tokens > 0) {
        try {
          const { TokenTracker } = await import('../token-usage');
          await TokenTracker.recordInvocation({
            timestamp: Date.now(),
            traceId: '',
            agentId: 'context-manager',
            provider: 'summarization',
            model: 'unknown',
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
            toolCalls: 0,
            taskType: 'summarization',
            success: true,
            durationMs: 0,
          });
        } catch {
          // non-critical
        }
      }
    } catch (e) {
      logger.error(`Failed to summarize conversation for ${userId}:`, e);
    }
  }

  private static async getConfigValue(key: string, fallback: number): Promise<number> {
    try {
      const { ConfigManager } = await import('../registry/config');
      return await ConfigManager.getTypedConfig(key, fallback);
    } catch {
      return fallback;
    }
  }
}
