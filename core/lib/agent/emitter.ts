import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Resource } from 'sst';
import { logger } from '../logger';
import {
  Message,
  MessageRole,
  EventType,
  IAgentConfig,
  AttachmentType,
  ButtonType,
} from '../types/index';
import { AgentRegistry } from '../registry';
import { SSTResource, isValidAttachment } from '../types/index';
import { AGENT_DEFAULTS } from './executor';
import { parseConfigInt } from '../providers/utils';

const typedResource = Resource as unknown as SSTResource;

export type ContinuationMetadata = {
  initiatorId?: string;
  depth?: number;
  sessionId?: string;
  workspaceId?: string;
  teamId?: string;
  staffId?: string;
  nodeId?: string;
  parentId?: string;
  attachments?: Array<{
    type: AttachmentType;
    url?: string;
    base64?: string;
    name?: string;
    mimeType?: string;
  }>;
  priorInputTokens?: number;
  priorOutputTokens?: number;
  priorTotalTokens?: number;
  tokenBudget?: number;
  costLimit?: number;
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
    sessionId: string | undefined,
    scope?: string | import('../types/memory').ContextualScope
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
      const workspaceId = typeof scope === 'string' ? scope : scope?.workspaceId;
      const teamId = typeof scope === 'string' ? undefined : scope?.teamId;
      const staffId = typeof scope === 'string' ? undefined : scope?.staffId;

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
                  workspaceId,
                  teamId,
                  staffId,
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
      let safeAttachments: ContinuationMetadata['attachments'] | undefined = undefined;
      if (metadata.attachments && Array.isArray(metadata.attachments)) {
        safeAttachments = [];
        for (const rawAtt of metadata.attachments) {
          if (isValidAttachment(rawAtt))
            safeAttachments.push(
              rawAtt as NonNullable<ContinuationMetadata['attachments']>[number]
            );
          else logger.warn('[EMITTER] Skipping invalid continuation attachment');
        }
      }
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
                depth: metadata.depth ?? 0,
                sessionId: metadata.sessionId,
                workspaceId: metadata.workspaceId,
                teamId: metadata.teamId,
                staffId: metadata.staffId,
                attachments: safeAttachments,
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
   * Emits a real-time message chunk directly to the IoT Realtime Bus
   */
  async emitChunk(
    userId: string,
    sessionId: string | undefined,
    traceId: string,
    options: {
      chunk?: string;
      agentName?: string;
      isThought?: boolean;
      buttonOptions?: Array<{ label: string; value: string; type?: ButtonType }>;
      initiatorId?: string;
      thoughtDelta?: string;
      ui_blocks?: Message['ui_blocks'];
      attachments?: Message['attachments'];
      detailType?: EventType;
      scope?: string | import('../types/memory').ContextualScope;
    } = {}
  ): Promise<void> {
    const {
      chunk,
      agentName,
      isThought = false,
      buttonOptions,
      initiatorId = 'orchestrator',
      thoughtDelta,
      ui_blocks,
      attachments,
      detailType = EventType.TEXT_MESSAGE_CONTENT,
      scope,
    } = options;

    try {
      const workspaceId = typeof scope === 'string' ? scope : scope?.workspaceId;
      const teamId = typeof scope === 'string' ? undefined : scope?.teamId;
      const staffId = typeof scope === 'string' ? undefined : scope?.staffId;

      const agentId = this.config?.id ?? 'unknown';

      // Feature: Worker Feedback Toggle
      // If this is a worker agent (initiated by another agent, not the orchestrator)
      // and worker feedback is disabled, skip emission.
      const isRoot = initiatorId === 'orchestrator' || agentId === 'superclaw';

      if (!isRoot) {
        const { AGENT_DEFAULTS } = await import('./executor');
        let feedbackEnabled: boolean = AGENT_DEFAULTS.WORKER_FEEDBACK_ENABLED;
        try {
          if (!process.env.VITEST) {
            const customEnabled = await AgentRegistry.getRawConfig('worker_feedback_enabled');
            if (customEnabled !== undefined)
              feedbackEnabled = customEnabled === 'true' || customEnabled === true;
          }
        } catch {
          // Fallback to default
        }
        if (!feedbackEnabled) return;
      }
      // Standardize assistant ID format: root agents use -superclaw, sub-agents use -agentId
      const messageId = isRoot ? `${traceId}-superclaw` : `${traceId}-${agentId}`;

      // Normalize userId to base form for MQTT topic consistency
      const { extractBaseUserId } = await import('../utils/agent-helpers');
      const baseUserId = extractBaseUserId(userId);
      const safeUserId = baseUserId.replace(/[#+]/g, '_');

      const topic = sessionId
        ? `users/${safeUserId}/sessions/${sessionId}/signal`
        : `users/${safeUserId}/signal`;

      const { publishToRealtime } = await import('../utils/realtime');

      let safeAttachments: Message['attachments'] | undefined = undefined;
      if (attachments && Array.isArray(attachments)) {
        safeAttachments = [];
        for (const rawAtt of attachments) {
          if (isValidAttachment(rawAtt))
            safeAttachments.push(rawAtt as NonNullable<Message['attachments']>[number]);
          else logger.warn('[EMITTER] Skipping invalid realtime attachment');
        }
        if (safeAttachments.length === 0) safeAttachments = undefined;
      }

      const payload = {
        'detail-type': detailType,
        type: detailType, // AG-UI Standard
        userId: baseUserId,
        sessionId,
        traceId,
        messageId,
        message: chunk,
        isThought,
        options: buttonOptions,
        agentName: agentName ?? this.config?.name ?? 'SuperClaw',
        thought: thoughtDelta,
        ui_blocks,
        attachments: safeAttachments,
        workspaceId,
        teamId,
        staffId,
      };

      await publishToRealtime(topic, payload);
    } catch (e) {
      // Don't let chunk emission failures block the main loop
      logger.warn('Failed to emit chunk via realtime bus:', e);
    }
  }

  /**
   * Emits a reputation update event with execution results (success, latency, etc).
   */
  async emitReputationUpdate(
    payload: import('../types/reputation').ReputationUpdatePayload
  ): Promise<void> {
    try {
      await this.eventbridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: this.config?.id ?? 'superclaw.agent',
              DetailType: EventType.REPUTATION_UPDATE,
              Detail: JSON.stringify(payload),
              EventBusName: typedResource.AgentBus.name,
            },
          ],
        })
      );
      logger.debug(`[EMITTER] Reputation update emitted for ${payload.agentId}`);
    } catch (e) {
      logger.error('Failed to emit reputation update:', e);
    }
  }
}
