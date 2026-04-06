import {
  IMemory,
  IProvider,
  IAgentConfig,
  ReasoningProfile,
  InsightCategory,
  AttachmentType,
  Message,
} from '../types/index';
import { SYSTEM, LIMITS } from '../constants';
import { AgentContext } from './context';
import { ContextManager } from './context-manager';
import { resolvePromptSnippets } from '../prompts/snippets';
import { logger } from '../logger';

export interface ContextResult {
  contextPrompt: string;
  messages: Message[];
  summary: string | null;
  contextLimit: number;
  activeModel: string;
  activeProvider: string;
}

export class AgentAssembler {
  static async prepareContext(
    memory: IMemory,
    provider: IProvider,
    config: IAgentConfig | undefined,
    baseUserId: string,
    storageId: string,
    userText: string,
    incomingAttachments: import('../types/index').Attachment[] | undefined,
    options: {
      isIsolated: boolean;
      depth: number;
      activeModel: string;
      activeProvider: string;
      activeProfile: ReasoningProfile;
      systemPrompt: string;
      pageContext?: {
        url: string;
        title?: string;
        data?: Record<string, unknown>;
        traceId?: string;
        sessionId?: string;
        agentId?: string;
      };
    }
  ): Promise<ContextResult> {
    const {
      isIsolated,
      depth,
      activeModel,
      activeProvider,
      activeProfile,
      systemPrompt,
      pageContext,
    } = options;

    // 1. Memory Retrieval (parallelized)
    const [history, [distilled, lessons, prefPrefixed, prefRaw, globalLessons]] = await Promise.all(
      [
        memory.getHistory(storageId),
        Promise.all([
          memory.getDistilledMemory(baseUserId),
          memory.getLessons(baseUserId),
          memory.searchInsights(
            `USER#${baseUserId}`,
            '*',
            InsightCategory.USER_PREFERENCE,
            50,
            undefined,
            undefined,
            undefined
          ),
          memory.searchInsights(
            baseUserId,
            '*',
            InsightCategory.USER_PREFERENCE,
            50,
            undefined,
            undefined,
            undefined
          ),
          memory.getGlobalLessons(5),
        ]),
      ]
    );

    const preferences = {
      items: [...(prefPrefixed.items ?? []), ...(prefRaw.items ?? [])],
    };

    const facts = [
      ...distilled.split('\n').filter(Boolean),
      ...(preferences.items?.map((i) => i.content) ?? []),
    ].join('\n');

    let recoveryContext = '';
    try {
      const [{ AGENT_LOG_MESSAGES }, recoveryData] = await Promise.all([
        import('./executor'),
        memory.getDistilledMemory(SYSTEM.RECOVERY_KEY),
      ]);
      if (recoveryData) {
        recoveryContext = `${AGENT_LOG_MESSAGES.RECOVERY_LOG_PREFIX}${recoveryData}`;
        await memory.updateDistilledMemory(SYSTEM.RECOVERY_KEY, '');
      }
    } catch {
      // Silently ignore
    }

    const pageContextBlock = pageContext
      ? `\n\n[CURRENT_PAGE_CONTEXT]:\nThe user is currently interacting with this dashboard page. Use this to provide context-aware assistance.\nURL: ${pageContext.url}${pageContext.title ? `\nTitle: ${pageContext.title}` : ''}${pageContext.traceId ? `\nActive Trace ID: ${pageContext.traceId}` : ''}${pageContext.sessionId ? `\nActive Session ID: ${pageContext.sessionId}` : ''}${pageContext.agentId ? `\nActive Agent ID: ${pageContext.agentId}` : ''}${pageContext.data ? `\nPage Data: ${JSON.stringify(pageContext.data)}` : ''}\n`
      : '';

    // 3. Prompt Assembly
    const globalLessonsBlock =
      globalLessons.length > 0
        ? `\n\n[COLLECTIVE_SWARM_INTELLIGENCE]:\nThese are system-wide lessons learned across ALL sessions. Apply them universally:\n${globalLessons.map((l) => `- ${l}`).join('\n')}\n`
        : '';

    const [capabilities, resolvedPrompt] = await Promise.all([
      provider.getCapabilities(activeModel),
      resolvePromptSnippets(systemPrompt),
    ]);

    let contextPrompt = resolvedPrompt;

    if (capabilities.supportedAttachmentTypes?.includes(AttachmentType.IMAGE)) {
      const { VISION_PROMPT_BLOCK } = await import('../prompts/vision');
      contextPrompt += VISION_PROMPT_BLOCK;
    }

    if (recoveryContext) contextPrompt += recoveryContext;
    contextPrompt += pageContextBlock;
    contextPrompt += `\n\n${AgentContext.getMemoryIndexBlock(distilled, lessons.length, preferences.items.length)}`;
    contextPrompt += `\n\n[INTELLIGENCE]\n${facts.length > 0 ? facts : 'No persistent knowledge available for this user yet.'}\n\n`;
    contextPrompt += globalLessonsBlock;
    contextPrompt += `\n\n${AgentContext.getIdentityBlock(
      config,
      activeModel,
      activeProvider,
      activeProfile,
      depth
    )}`;

    contextPrompt += `
      [RELATIONSHIP_CONTEXT]:
      - MODE: ${isIsolated ? 'SYSTEM_TASK' : 'USER_CONSULTATION'}
      - AUDIENCE: ${isIsolated ? 'Orchestrator' : 'Human User'}
      - BEHAVIOR: ${isIsolated ? 'Be technical, precise, and structured.' : 'Be friendly, direct, and conversational. Skip internal monologue.'}
      `;

    const [{ MessageRole }, summary] = await Promise.all([
      import('../types/index'),
      memory.getSummary(storageId),
    ]);
    const currentMessage: Message = {
      role: MessageRole.USER,
      content: userText,
      attachments: incomingAttachments ?? [],
      traceId: pageContext?.traceId ?? 'unknown',
      messageId: pageContext?.agentId ?? `msg-${Date.now()}`, // Fallback if no pageContext
      thought: '',
      tool_calls: [],
    };

    const fullHistory = [...history, currentMessage];

    const contextLimit = capabilities.contextWindow ?? LIMITS.MAX_CONTEXT_LENGTH;

    const managed = await ContextManager.getManagedContext(
      fullHistory,
      summary,
      contextPrompt,
      contextLimit,
      { model: activeModel, provider: activeProvider }
    );

    // Trigger background summarization if context limits are reached
    if (await ContextManager.needsSummarization(fullHistory, contextLimit)) {
      // Fire and forget summarization to not block the current turn
      ContextManager.summarize(memory, storageId, provider, fullHistory).catch((err) =>
        logger.error('Background summarization failed:', err)
      );
    }

    return {
      contextPrompt,
      messages: managed.messages,
      summary: summary, // Use the original summary since ContextManager doesn't return a new one
      contextLimit,
      activeModel,
      activeProvider,
    };
  }
}
