import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Resource } from 'sst';
import { logger } from '../logger';
import { Message, MessageRole, EventType, IAgentConfig } from '../types/index';
import { AgentRegistry } from '../registry';
import { SSTResource } from '../types/index';
import { AGENT_DEFAULTS } from './executor';
import { parseConfigInt } from '../providers/utils';

const typedResource = Resource as unknown as SSTResource;

export type ContinuationMetadata = {
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
};

/**
 * Handles agent event emission (reflection and continuation tasks).
 * @since 2026-03-19
 */
export class AgentEmitter {
  private eventbridge: EventBridgeClient = new EventBridgeClient({});

  constructor(private config?: IAgentConfig) {}

  /**
   * Determines if a reflection task should be emitted and emits it.
   */
  async considerReflection(
    isIsolated: boolean,
    userId: string,
    history: Message[],
    userText: string,
    traceId: string,
    messages: Message[],
    responseText: string,
    nodeId: string,
    parentId: string | undefined,
    sessionId: string | undefined
  ): Promise<void> {
    let reflectionFrequency: number = AGENT_DEFAULTS.REFLECTION_FREQUENCY;
    try {
      if (!process.env.VITEST) {
        const customFreq = await AgentRegistry.getRawConfig('reflection_frequency');
        if (customFreq !== undefined)
          reflectionFrequency = parseConfigInt(customFreq, reflectionFrequency);
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
                Source: 'superclaw.agent',
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
                      agentName: this.config?.name ?? 'SuperClaw',
                      traceId: traceId ?? 'unknown',
                    },
                  ],
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
  async emitContinuation(
    userId: string,
    task: string,
    traceId: string,
    metadata: ContinuationMetadata = {}
  ): Promise<void> {
    try {
      await this.eventbridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: this.config?.id ?? 'superclaw.agent',
              DetailType: EventType.CONTINUATION_TASK,
              Detail: JSON.stringify({
                userId,
                agentId: this.config?.id ?? 'superclaw',
                task,
                isContinuation: true,
                traceId,
                nodeId: metadata.nodeId,
                parentId: metadata.parentId,
                initiatorId: metadata.initiatorId,
                depth: (metadata.depth ?? 0) + 1,
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

  /**
   * Emits a real-time message chunk to the AgentBus
   */
  async emitChunk(
    userId: string,
    sessionId: string | undefined,
    traceId: string,
    chunk: string,
    agentName?: string,
    isThought?: boolean,
    options?: Array<{ label: string; value: string; type?: string }>
  ): Promise<void> {
    try {
      const agentId = this.config?.id ?? 'unknown';
      // Root orchestrator uses traceId directly to match API response/history
      // Sub-agents use traceId-agentId to maintain distinct bubbles
      const messageId = agentId === 'superclaw' ? traceId : `${traceId}-${agentId}`;

      logger.info(
        `[Emitter] Emitting chunk for agent ${agentId} | messageId: ${messageId} | traceId: ${traceId}`
      );

      await this.eventbridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: `${agentId}.agent`,
              DetailType: EventType.CHUNK,
              Detail: JSON.stringify({
                userId,
                sessionId,
                traceId,
                messageId,
                message: chunk,
                isThought,
                options,
                agentName: agentName ?? this.config?.name ?? 'SuperClaw',
              }),
              EventBusName: typedResource.AgentBus.name,
            },
          ],
        })
      );
    } catch (e) {
      // Don't let chunk emission failures block the main loop
      logger.warn('Failed to emit chunk:', e);
    }
  }
}
