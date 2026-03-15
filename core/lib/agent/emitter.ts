import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Resource } from 'sst';
import { logger } from '../logger';
import { Message, MessageRole, EventType, IAgentConfig } from '../types/index';
import { AgentRegistry } from '../registry';
import { SSTResource } from '../types/index';
import { AGENT_DEFAULTS } from './executor';

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
    sessionId: string | undefined,
    currentInitiator: string,
    depth: number
  ): Promise<void> {
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
