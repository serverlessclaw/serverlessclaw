import {
  IMemory,
  IProvider,
  IAgentConfig,
  ReasoningProfile,
  InsightCategory,
  AttachmentType,
  Message,
} from '../types/index';
import { SYSTEM, MEMORY_KEYS, LIMITS } from '../constants';
import { AgentContext } from './context';
import { ContextManager } from './context-manager';
import { resolvePromptSnippets } from '../prompts/snippets';

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
    }
  ): Promise<ContextResult> {
    const { isIsolated, depth, activeModel, activeProvider, activeProfile, systemPrompt } = options;

    // 1. Memory Retrieval
    const history = await memory.getHistory(storageId);
    const [distilled, lessons, prefPrefixed, prefRaw, globalLessons] = await Promise.all([
      memory.getDistilledMemory(baseUserId),
      memory.getLessons(baseUserId),
      memory.searchInsights(`USER#${baseUserId}`, '*', InsightCategory.USER_PREFERENCE),
      memory.searchInsights(baseUserId, '*', InsightCategory.USER_PREFERENCE),
      memory.getGlobalLessons(5),
    ]);

    const preferences = {
      items: [...(prefPrefixed.items ?? []), ...(prefRaw.items ?? [])],
    };

    const facts = [
      ...distilled.split('\n').filter(Boolean),
      ...(preferences.items?.map((i) => i.content) ?? []),
    ].join('\n');

    let recoveryContext = '';
    try {
      const { AGENT_LOG_MESSAGES } = await import('./executor');
      const recoveryData = await memory.getDistilledMemory(
        SYSTEM.RECOVERY_KEY ?? MEMORY_KEYS.RECOVERY
      );
      if (recoveryData) {
        recoveryContext = `${AGENT_LOG_MESSAGES.RECOVERY_LOG_PREFIX}${recoveryData}`;
        await memory.updateDistilledMemory(SYSTEM.RECOVERY_KEY ?? MEMORY_KEYS.RECOVERY, '');
      }
    } catch {
      // Silently ignore
    }

    // 3. Prompt Assembly
    const globalLessonsBlock =
      globalLessons.length > 0
        ? `\n\n[COLLECTIVE_SWARM_INTELLIGENCE]:\nThese are system-wide lessons learned across ALL sessions. Apply them universally:\n${globalLessons.map((l) => `- ${l}`).join('\n')}\n`
        : '';

    const capabilities = await provider.getCapabilities(activeModel);

    let contextPrompt = await resolvePromptSnippets(systemPrompt);

    if (capabilities.supportedAttachmentTypes?.includes(AttachmentType.IMAGE)) {
      const { VISION_PROMPT_BLOCK } = await import('../prompts/vision');
      contextPrompt += VISION_PROMPT_BLOCK;
    }

    if (recoveryContext) contextPrompt += recoveryContext;
    contextPrompt += `\n\n${AgentContext.getMemoryIndexBlock(distilled, lessons.length, preferences.items.length)}`;
    contextPrompt += `\n\n[INTELLIGENCE]\n${facts.length > 0 ? facts : 'No persistent knowledge available for this user yet.'}\n\n`;
    contextPrompt += globalLessonsBlock;
    contextPrompt += `\n\n${AgentContext.getIdentityBlock(
      config,
      activeModel ?? SYSTEM.DEFAULT_MODEL,
      activeProvider ?? SYSTEM.DEFAULT_PROVIDER,
      activeProfile,
      depth
    )}`;

    contextPrompt += `
      [RELATIONSHIP_CONTEXT]:
      - MODE: ${isIsolated ? 'SYSTEM_TASK' : 'USER_CONSULTATION'}
      - AUDIENCE: ${isIsolated ? 'Orchestrator' : 'Human User'}
      - BEHAVIOR: ${isIsolated ? 'Be technical, precise, and structured.' : 'Be friendly, direct, and conversational. Skip internal monologue.'}
      `;

    const { MessageRole } = await import('../types/index');
    const currentMessage: Message = {
      role: MessageRole.USER,
      content: userText,
      attachments: incomingAttachments,
    };

    const fullHistory = [...history, currentMessage];
    const summary = await memory.getSummary(storageId);

    const contextLimit = capabilities.contextWindow ?? LIMITS.MAX_CONTEXT_LENGTH;

    const managed = await ContextManager.getManagedContext(
      fullHistory,
      summary,
      contextPrompt,
      contextLimit,
      { model: activeModel, provider: activeProvider }
    );

    // 4. Summarization Trigger (Background)
    if (
      await ContextManager.needsSummarization(
        fullHistory,
        contextLimit,
        undefined,
        activeModel,
        activeProvider
      )
    ) {
      const { logger } = await import('../logger');
      ContextManager.summarize(memory, storageId, provider, fullHistory).catch((err) =>
        logger.error('Background summarization failed:', err)
      );
    }

    return {
      contextPrompt,
      messages: managed.messages,
      summary,
      contextLimit,
      activeModel,
      activeProvider,
    };
  }
}
