import {
  IMemory,
  IProvider,
  ITool,
  Message,
  ReasoningProfile,
  MessageRole,
  EventType,
  IAgentConfig,
  TraceSource,
  Attachment,
} from './types/index';
import { ClawTracer } from './tracer';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Resource } from 'sst';
import { logger } from './logger';
import { SSTResource } from './types/index';
import { Context as LambdaContext } from 'aws-lambda';
import { SYSTEM } from './constants';
import { AgentRegistry } from './registry';
import { AgentContext } from './agent/context';
import { AgentExecutor, AGENT_DEFAULTS, AGENT_LOG_MESSAGES } from './agent/executor';

const typedResource = Resource as unknown as SSTResource;

/**
 * Processing options for the agent's process method.
 */
export interface AgentProcessOptions {
  profile?: ReasoningProfile;
  context?: LambdaContext;
  isContinuation?: boolean;
  isIsolated?: boolean;
  initiatorId?: string;
  depth?: number;
  traceId?: string;
  nodeId?: string;
  parentId?: string;
  sessionId?: string;
  attachments?: Array<{
    type: 'image' | 'file';
    url?: string;
    base64?: string;
    name?: string;
    mimeType?: string;
  }>;
  source?: TraceSource | string;
}

/**
 * The core Agent class responsible for orchestrating LLM calls, tool execution,
 * and memory management.
 */
export class Agent {
  private eventbridge: EventBridgeClient = new EventBridgeClient({});

  constructor(
    private memory: IMemory,
    private provider: IProvider,
    private tools: ITool[],
    private systemPrompt: string,
    public config?: IAgentConfig
  ) {}

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
        if (customMax !== undefined) maxIterations = parseInt(String(customMax), 10);
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

      await this.emitContinuation(userId, userText, tracer.getTraceId() || 'unknown', {
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
      attachments: resultAttachments, // Store attachments in memory too
    });

    await tracer.endTrace(responseText);

    // 6. Reflection Trigger
    await this.considerReflection(
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

    return { responseText, attachments: resultAttachments };
  }

  /**
   * Logic to determine if a reflection task should be emitted.
   */
  private async considerReflection(
    isIsolated: boolean,
    userId: string,
    history: Message[],
    userText: string,
    traceId: string,
    messages: Message[],
    responseText: string,
    nodeId: string,
    parentId: string | undefined,
    sessionId: string | undefined,
    currentInitiator: string,
    depth: number
  ) {
    let reflectionFrequency: number = AGENT_DEFAULTS.REFLECTION_FREQUENCY;
    try {
      if (!process.env.VITEST) {
        const customFreq = await AgentRegistry.getRawConfig('reflection_frequency');
        if (customFreq !== undefined) reflectionFrequency = parseInt(String(customFreq), 10);
      }
    } catch {
      logger.warn(`Failed to fetch reflection_frequency, using default ${reflectionFrequency}.`);
    }

    const shouldReflect =
      !isIsolated &&
      reflectionFrequency > 0 &&
      history.length > 0 &&
      (history.length % reflectionFrequency === 0 ||
        userText.toLowerCase().includes('remember') ||
        userText.toLowerCase().includes('learn'));

    if (shouldReflect) {
      try {
        await this.eventbridge.send(
          new PutEventsCommand({
            Entries: [
              {
                Source: 'main.agent',
                DetailType: EventType.REFLECT_TASK,
                Detail: JSON.stringify({
                  userId,
                  traceId,
                  nodeId,
                  parentId,
                  sessionId,
                  conversation: [
                    ...messages,
                    {
                      role: MessageRole.ASSISTANT,
                      content: responseText,
                      agentName: this.config?.name || 'SuperClaw',
                      traceId: traceId || 'unknown',
                    },
                  ],
                  initiatorId: currentInitiator,
                  depth,
                }),
                EventBusName: typedResource.AgentBus.name,
              },
            ],
          })
        );
        logger.info('Reflection task emitted for user:', userId);
      } catch (e) {
        logger.error('Failed to emit reflection task:', e);
      }
    }
  }

  /**
   * Emits an event to trigger a continuation of the current task
   */
  private async emitContinuation(
    userId: string,
    task: string,
    traceId: string,
    metadata: {
      initiatorId?: string;
      depth?: number;
      sessionId?: string;
      nodeId?: string;
      parentId?: string;
      attachments?: Array<{
        type: 'image' | 'file';
        url?: string;
        base64?: string;
        name?: string;
        mimeType?: string;
      }>;
    } = {}
  ): Promise<void> {
    try {
      await this.eventbridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: this.config?.id || 'main.agent',
              DetailType: EventType.CONTINUATION_TASK,
              Detail: JSON.stringify({
                userId,
                agentId: this.config?.id || 'main',
                task,
                isContinuation: true,
                traceId,
                nodeId: metadata.nodeId,
                parentId: metadata.parentId,
                initiatorId: metadata.initiatorId,
                depth: (metadata.depth || 0) + 1,
                sessionId: metadata.sessionId,
                attachments: metadata.attachments,
              }),
              EventBusName: typedResource.AgentBus.name,
            },
          ],
        })
      );
      logger.info('Continuation task emitted for user:', userId);
    } catch (e) {
      logger.error('Failed to emit continuation task:', e);
    }
  }
}
