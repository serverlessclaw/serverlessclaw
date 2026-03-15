import {
  IMemory,
  IProvider,
  ITool,
  Message,
  ReasoningProfile,
  MessageRole,
  IAgentConfig,
  TraceSource,
  Attachment,
} from './types/index';
import { ClawTracer } from './tracer';
import { logger } from './logger';
import { SYSTEM, AGENT_ERRORS } from './constants';
import { AgentRegistry } from './registry';
import { AgentContext } from './agent/context';
import { AgentExecutor, AGENT_DEFAULTS, AGENT_LOG_MESSAGES } from './agent/executor';
import { AgentProcessOptions } from './agent/options';
import { AgentEmitter } from './agent/emitter';
import { parseConfigInt } from './providers/utils';

// Re-export for backward compatibility
export type { AgentProcessOptions };

/**
 * The core Agent class responsible for orchestrating LLM calls, tool execution,
 * and memory management.
 */
export class Agent {
  private emitter: AgentEmitter;

  constructor(
    private memory: IMemory,
    private provider: IProvider,
    private tools: ITool[],
    private systemPrompt: string,
    public config?: IAgentConfig
  ) {
    this.emitter = new AgentEmitter(config);
  }

  /**
   * Processes a user message, potentially performing multiple tool-calling iterations
   */
  async process(
    userId: string,
    userText: string,
    options: AgentProcessOptions = {}
  ): Promise<{ responseText: string; attachments?: Attachment[] }> {
    const {
      profile = ReasoningProfile.STANDARD,
      context,
      isContinuation = false,
      isIsolated = false,
      initiatorId,
      depth = 0,
      traceId: incomingTraceId,
      nodeId: incomingNodeId,
      parentId: incomingParentId,
      sessionId,
      attachments: incomingAttachments,
      source = TraceSource.UNKNOWN,
    } = options;

    const baseUserId = userId.startsWith('CONV#') ? userId.split('#')[1] : userId;
    const tracer = new ClawTracer(
      baseUserId,
      source,
      incomingTraceId,
      incomingNodeId,
      incomingParentId
    );
    const traceId = tracer.getTraceId();
    const nodeId = tracer.getNodeId();
    const parentId = tracer.getParentId();
    const currentInitiator = initiatorId || this.config?.id || 'unknown';

    if (!isContinuation) {
      await tracer.startTrace({
        userText,
        sessionId,
        agentId: this.config?.id,
        hasAttachments: !!incomingAttachments,
      });
    }

    const storageId = isIsolated
      ? `${(this.config?.id || 'unknown').toUpperCase()}#${userId}#${traceId}`
      : userId;

    try {
      // 1. Memory Retrieval
      const history = await this.memory.getHistory(storageId);
      const distilled = await this.memory.getDistilledMemory(baseUserId);
      const lessons = await this.memory.getLessons(baseUserId);

      let recoveryContext = '';
      try {
        const recoveryData = await this.memory.getDistilledMemory(SYSTEM.RECOVERY_KEY || 'RECOVERY');
        if (recoveryData) {
          recoveryContext = `${AGENT_LOG_MESSAGES.RECOVERY_LOG_PREFIX}${recoveryData}`;
          await this.memory.updateDistilledMemory(SYSTEM.RECOVERY_KEY || 'RECOVERY', '');
        }
      } catch (e) {
        logger.error('Error checking recovery context:', e);
      }

      if (!isContinuation) {
        await this.memory.addMessage(storageId, {
          role: MessageRole.USER,
          content: userText,
          attachments: incomingAttachments,
        });
      }

      // 2. Model/Provider Resolution
      let activeModel: string | undefined = this.config?.model;
      let activeProvider: string | undefined = this.config?.provider;
      let activeProfile = profile;

      try {
        const globalProvider = (await AgentRegistry.getRawConfig('active_provider')) as string;
        const globalModel = (await AgentRegistry.getRawConfig('active_model')) as string;
        if (globalProvider) activeProvider = globalProvider;
        if (globalModel) activeModel = globalModel;

        if (!process.env.VITEST) {
          const policy = await AgentRegistry.getRawConfig('optimization_policy');
          if (policy === 'aggressive') activeProfile = ReasoningProfile.DEEP;
          else if (policy === 'conservative') activeProfile = ReasoningProfile.FAST;

          if (!globalModel && !activeModel) {
            const profileMap = (await AgentRegistry.getRawConfig('reasoning_profiles')) as Record<
              string,
              string
            >;
            if (profileMap && profileMap[activeProfile]) activeModel = profileMap[activeProfile];
          }
        }
      } catch {
        logger.warn('Failed to fetch config from DDB, using defaults.');
      }

      // 3. Prompt Assembly
      let contextPrompt = this.systemPrompt;
      if (recoveryContext) contextPrompt += recoveryContext;
      contextPrompt += `\n\n${AgentContext.getMemoryIndexBlock(distilled, lessons.length)}`;
      contextPrompt += `\n\n${AgentContext.getIdentityBlock(this.config, activeModel || 'gpt-4o-mini', activeProvider || 'openai', activeProfile, depth)}`;

      const messages: Message[] = [
        { role: MessageRole.SYSTEM, content: contextPrompt },
        ...history,
        { role: MessageRole.USER, content: userText, attachments: incomingAttachments },
      ];

      // 4. Execution Loop
      const executor = new AgentExecutor(
        this.provider,
        this.tools,
        this.config?.id || 'unknown',
        this.config?.name || 'SuperClaw'
      );

      let maxIterations = this.config?.maxIterations || AGENT_DEFAULTS.MAX_ITERATIONS;
      try {
        if (!process.env.VITEST) {
          const customMax = await AgentRegistry.getRawConfig('max_tool_iterations');
          if (customMax !== undefined) maxIterations = parseConfigInt(customMax, maxIterations);
        }
      } catch {
        logger.warn(`Failed to fetch max_tool_iterations from DDB, using default ${maxIterations}.`);
      }

      const {
        responseText,
        paused,
        pauseMessage,
        attachments: resultAttachments,
      } = await executor.runLoop(messages, {
        activeModel,
        activeProvider,
        activeProfile,
        maxIterations,
        tracer,
        context,
        traceId,
        nodeId,
        parentId,
        currentInitiator,
        depth,
        sessionId,
        userId: baseUserId,
        userText,
        mainConversationId: userId,
      });

      if (paused) {
        await this.memory.addMessage(storageId, {
          role: MessageRole.ASSISTANT,
          content: pauseMessage!,
          agentName: this.config?.name || 'SuperClaw',
          traceId,
        });

        await this.emitter.emitContinuation(userId, userText, tracer.getTraceId() || 'unknown', {
          initiatorId: currentInitiator,
          depth,
          sessionId,
          nodeId: nodeId || 'unknown',
          parentId: parentId || 'unknown',
          attachments: incomingAttachments,
        });
        return { responseText: pauseMessage!, attachments: resultAttachments };
      }

      // 5. Finalize and Response
      await this.memory.addMessage(storageId, {
        role: MessageRole.ASSISTANT,
        content: responseText,
        agentName: this.config?.name || 'SuperClaw',
        traceId,
        attachments: resultAttachments,
      });

      await tracer.endTrace(responseText);

      // 6. Reflection Trigger
      await this.emitter.considerReflection(
        isIsolated,
        userId,
        history,
        userText,
        tracer.getTraceId(),
        messages,
        responseText,
        nodeId,
        parentId,
        sessionId,
        currentInitiator,
        depth
      );

      return { responseText: responseText, attachments: resultAttachments };
    } catch (error) {
      const errorDetail = error instanceof Error ? error.message : String(error);
      logger.error(`[Agent.process] Critical failure: ${errorDetail}`, error);

      // Log a strategic gap for the system to evolve
      try {
        const gapId = `GAP#PROC#${Date.now()}`;
        await this.memory.setGap(gapId, `Execution failure for user ${userId} / session ${sessionId}. Error: ${errorDetail}`, {
          category: 'strategic_gap' as any,
          confidence: 10,
          impact: 8,
          complexity: 5,
          risk: 5,
          urgency: 7,
          priority: 7
        });
      } catch (gapError) {
        logger.error('Failed to log strategic gap during error recovery:', gapError);
      }

      return { responseText: AGENT_ERRORS.PROCESS_FAILURE };
    }
  }
}
