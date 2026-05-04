/**
 * Escalation Policy Manager
 * Handles multi-channel, time-based escalation for human-agent interactions
 */

import { logger } from '../logger';
import { ConfigManager } from '../registry/config';
import { emitEvent, EventPriority } from '../utils/bus';
import { EventType } from '../types/agent';
import { DynamoMemory } from '../memory';
import { sendOutboundMessage } from '../outbound';
import {
  EscalationPolicy,
  EscalationState,
  EscalationChannel,
  DEFAULT_ESCALATION_POLICY,
} from '../types/escalation';

const ESCALATION_POLICY_PREFIX = 'ESCALATION_POLICY#';

/**
 * Manages escalation policies and state for human-agent interactions
 */
export class EscalationManager {
  private memory: DynamoMemory;

  constructor() {
    this.memory = new DynamoMemory();
  }

  /**
   * Gets the escalation policy for a user/priority combination
   */
  async getPolicy(userId: string, priority: string = 'medium'): Promise<EscalationPolicy> {
    try {
      // Try to get user-specific policy first
      const userPolicyKey = `${ESCALATION_POLICY_PREFIX}${userId}_${priority}`;
      const userPolicy = await ConfigManager.getRawConfig(userPolicyKey);
      if (userPolicy) {
        return userPolicy as EscalationPolicy;
      }

      // Try to get global policy for this priority
      const globalPolicyKey = `${ESCALATION_POLICY_PREFIX}global_${priority}`;
      const globalPolicy = await ConfigManager.getRawConfig(globalPolicyKey);
      if (globalPolicy) {
        return globalPolicy as EscalationPolicy;
      }

      // Return default policy
      return DEFAULT_ESCALATION_POLICY;
    } catch (error) {
      logger.warn(`Failed to get escalation policy for ${userId}:`, error);
      return DEFAULT_ESCALATION_POLICY;
    }
  }

  /**
   * Saves an escalation policy
   */
  async savePolicy(userId: string | 'global', policy: EscalationPolicy): Promise<void> {
    try {
      const key =
        userId === 'global'
          ? `${ESCALATION_POLICY_PREFIX}global_${policy.priority}`
          : `${ESCALATION_POLICY_PREFIX}${userId}_${policy.priority}`;

      await ConfigManager.saveRawConfig(key, policy, {
        author: userId,
        description: `Escalation policy update for ${policy.name}`,
      });

      logger.info(`Saved escalation policy ${policy.id} for ${userId}`);
    } catch (error) {
      logger.error(`Failed to save escalation policy:`, error);
      throw error;
    }
  }

  /**
   * Starts a new escalation process
   */
  async startEscalation(
    traceId: string,
    agentId: string,
    userId: string,
    question: string,
    originalTask: string,
    sessionId?: string,
    policyId?: string,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): Promise<EscalationState> {
    try {
      const policy = policyId ? await this.getPolicyById(policyId) : await this.getPolicy(userId);

      if (!policy.enabled) {
        logger.info(`Escalation policy ${policy.id} is disabled, skipping escalation`);
        throw new Error('Escalation policy is disabled');
      }

      const firstLevel = policy.levels[0];
      if (!firstLevel) {
        throw new Error('Escalation policy has no levels defined');
      }

      const state: EscalationState = {
        traceId,
        agentId,
        userId,
        sessionId,
        currentLevel: 1,
        policyId: policy.id,
        startedAt: Date.now(),
        currentLevelExpiresAt: Date.now() + firstLevel.timeoutMs,
        notifiedChannels: [],
        completed: false,
        workspaceId: scope?.workspaceId,
        teamId: scope?.teamId,
        staffId: scope?.staffId,
      };

      // Save escalation state
      await this.saveEscalationState(state);

      // Update main clarification status to ESCALATED
      const { ClarificationStatus } = await import('../types/memory');
      await this.memory.updateClarificationStatus(traceId, agentId, ClarificationStatus.ESCALATED);

      // Send notifications for first level
      await this.sendLevelNotifications(state, policy, question, originalTask);

      // Schedule timeout for first level
      await this.scheduleLevelTimeout(state, firstLevel.timeoutMs);

      logger.info(
        `Started escalation for traceId=${traceId}, agentId=${agentId}, ` +
          `policy=${policy.id}, level=1`
      );

      return state;
    } catch (error) {
      logger.error(`Failed to start escalation:`, error);
      throw error;
    }
  }

  /**
   * Handles escalation level timeout
   */
  async handleLevelTimeout(
    traceId: string,
    agentId: string,
    question: string,
    originalTask: string
  ): Promise<void> {
    try {
      const state = await this.getEscalationState(traceId, agentId);
      if (!state) {
        logger.warn(`No escalation state found for ${traceId}/${agentId}`);
        return;
      }

      if (state.completed) {
        logger.info(`Escalation already completed for ${traceId}/${agentId}`);
        return;
      }

      const policy = await this.getPolicyById(state.policyId);
      const currentLevelIndex = state.currentLevel - 1;
      const currentLevel = policy.levels[currentLevelIndex];

      if (!currentLevel) {
        logger.error(`Invalid escalation level ${state.currentLevel} for policy ${policy.id}`);
        await this.completeEscalation(state, 'failed');
        return;
      }

      // Check if we should continue to next level
      if (currentLevel.continueOnFailure && state.currentLevel < policy.levels.length) {
        // Move to next level
        const nextLevel = policy.levels[state.currentLevel];
        state.currentLevel += 1;
        state.currentLevelExpiresAt = Date.now() + nextLevel.timeoutMs;
        state.notifiedChannels = [];

        await this.saveEscalationState(state);
        await this.sendLevelNotifications(state, policy, question, originalTask);
        await this.scheduleLevelTimeout(state, nextLevel.timeoutMs);

        logger.info(
          `Escalated to level ${state.currentLevel} for traceId=${traceId}, ` +
            `agentId=${agentId} (WS: ${state.workspaceId || 'global'})`
        );
      } else {
        // Final level exhausted
        await this.handleFinalAction(state, policy, question, originalTask);
      }
    } catch (error) {
      logger.error(`Failed to handle escalation timeout:`, error);
    }
  }

  /**
   * Marks escalation as answered
   */
  async markAnswered(traceId: string, agentId: string): Promise<void> {
    try {
      const state = await this.getEscalationState(traceId, agentId);
      if (state && !state.completed) {
        await this.completeEscalation(state, 'answered');
        logger.info(`Escalation marked as answered for ${traceId}/${agentId}`);
      }
    } catch (error) {
      logger.error(`Failed to mark escalation as answered:`, error);
    }
  }

  /**
   * Gets escalation state
   */
  async getEscalationState(traceId: string, agentId: string): Promise<EscalationState | null> {
    try {
      return this.memory.getEscalationState(traceId, agentId);
    } catch (error) {
      logger.warn(`Failed to get escalation state for ${traceId}/${agentId}:`, error);
      return null;
    }
  }

  /**
   * Saves escalation state
   */
  private async saveEscalationState(state: EscalationState): Promise<void> {
    await this.memory.saveEscalationState(state);
  }

  /**
   * Gets policy by ID
   */
  private async getPolicyById(policyId: string): Promise<EscalationPolicy> {
    try {
      const key = `${ESCALATION_POLICY_PREFIX}id_${policyId}`;
      const policy = await ConfigManager.getRawConfig(key);
      if (policy) {
        return policy as EscalationPolicy;
      }
      return DEFAULT_ESCALATION_POLICY;
    } catch (error) {
      logger.warn(`Failed to get policy by ID ${policyId}:`, error);
      return DEFAULT_ESCALATION_POLICY;
    }
  }

  /**
   * Sends notifications for the current escalation level
   */
  private async sendLevelNotifications(
    state: EscalationState,
    policy: EscalationPolicy,
    question: string,
    originalTask: string
  ): Promise<void> {
    const currentLevel = policy.levels[state.currentLevel - 1];
    if (!currentLevel) return;

    const message = this.formatMessage(
      currentLevel.messageTemplate || 'Agent needs your input: {{question}}',
      question,
      originalTask,
      state.currentLevel,
      policy.levels.length
    );

    for (const channel of currentLevel.channels) {
      try {
        await this.sendToChannel(channel, state.userId, message, state.sessionId, {
          workspaceId: state.workspaceId,
          teamId: state.teamId,
          staffId: state.staffId,
        });
        state.notifiedChannels.push(channel);
      } catch (error) {
        logger.warn(`Failed to send escalation to ${channel}:`, error);
        // Continue with other channels
      }
    }

    await this.saveEscalationState(state);
  }

  /**
   * Formats an escalation message
   */
  private formatMessage(
    template: string,
    question: string,
    originalTask: string,
    currentLevel: number,
    totalLevels: number
  ): string {
    return template
      .replace('{{question}}', question)
      .replace('{{originalTask}}', originalTask)
      .replace('{{currentLevel}}', String(currentLevel))
      .replace('{{totalLevels}}', String(totalLevels));
  }

  /**
   * Sends a message to a specific channel
   */
  private async sendToChannel(
    channel: EscalationChannel,
    userId: string,
    message: string,
    sessionId?: string,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): Promise<void> {
    switch (channel) {
      case EscalationChannel.TELEGRAM:
      case EscalationChannel.SLACK:
      case EscalationChannel.DASHBOARD:
        await sendOutboundMessage(
          'escalation-manager',
          userId,
          message,
          undefined,
          sessionId,
          'SystemGuard',
          undefined,
          undefined,
          undefined,
          scope?.workspaceId,
          scope?.teamId,
          scope?.staffId
        );
        break;

      case EscalationChannel.EMAIL:
        // Email would require additional integration
        logger.info(`Email escalation not yet implemented for user ${userId}`);
        break;

      case EscalationChannel.SMS:
        // SMS would require additional integration
        logger.info(`SMS escalation not yet implemented for user ${userId}`);
        break;
    }
  }

  /**
   * Schedules a timeout for the current escalation level
   */
  private async scheduleLevelTimeout(state: EscalationState, timeoutMs: number): Promise<void> {
    const timeoutId = `escalation-${state.traceId}-${state.agentId}-${state.currentLevel}`;
    const targetTime = Date.now() + timeoutMs;

    // Import scheduler dynamically to avoid circular dependencies
    const { DynamicScheduler } = await import('./scheduler');

    await DynamicScheduler.scheduleOneShotTimeout(
      timeoutId,
      {
        traceId: state.traceId,
        agentId: state.agentId,
        userId: state.userId,
        sessionId: state.sessionId,
        currentLevel: state.currentLevel,
        policyId: state.policyId,
        workspaceId: state.workspaceId,
        teamId: state.teamId,
        staffId: state.staffId,
      },
      targetTime,
      EventType.ESCALATION_LEVEL_TIMEOUT
    );

    logger.info(
      `Scheduled escalation timeout for level ${state.currentLevel}: ` +
        `${new Date(targetTime).toISOString()}`
    );
  }

  /**
   * Handles the final action when all escalation levels are exhausted
   */
  private async handleFinalAction(
    state: EscalationState,
    policy: EscalationPolicy,
    question: string,
    originalTask: string
  ): Promise<void> {
    switch (policy.finalAction) {
      case 'fail':
        await this.completeEscalation(state, 'failed');
        await this.notifyFinalFailure(state, question, originalTask);
        break;

      case 'continue_with_defaults':
        await this.completeEscalation(state, 'continued_with_defaults');
        await this.notifyContinuedWithDefaults(state, question, originalTask);
        break;

      case 'escalate_to_admin':
        await this.escalateToAdmin(state, policy, question, originalTask);
        break;
    }
  }

  /**
   * Completes the escalation process
   */
  private async completeEscalation(
    state: EscalationState,
    outcome: EscalationState['outcome']
  ): Promise<void> {
    state.completed = true;
    state.outcome = outcome;
    await this.saveEscalationState(state);

    // Emit event for tracking
    await emitEvent(
      'escalation-manager',
      EventType.ESCALATION_COMPLETED,
      {
        traceId: state.traceId,
        agentId: state.agentId,
        userId: state.userId,
        outcome,
        currentLevel: state.currentLevel,
        policyId: state.policyId,
        workspaceId: state.workspaceId,
        teamId: state.teamId,
        staffId: state.staffId,
      },
      { priority: EventPriority.HIGH }
    );
  }

  /**
   * Notifies user of final failure
   */
  private async notifyFinalFailure(
    state: EscalationState,
    question: string,
    originalTask: string
  ): Promise<void> {
    await sendOutboundMessage(
      'escalation-manager',
      state.userId,
      `❌ **Escalation Failed**\n\n` +
        `Agent '${state.agentId}' requested clarification but received no response after all escalation attempts.\n\n` +
        `**Question:**\n${question}\n\n` +
        `**Task:** ${originalTask}\n\n` +
        `The task has been marked as failed. Please review and retry manually if needed.`,
      undefined,
      state.sessionId,
      'SystemGuard',
      undefined,
      undefined,
      undefined,
      state.workspaceId,
      state.teamId,
      state.staffId
    );

    // Emit task failed event
    await emitEvent(
      'escalation-manager',
      EventType.TASK_FAILED,
      {
        userId: state.userId,
        agentId: state.agentId,
        task: originalTask,
        error: `Escalation failed after ${state.currentLevel} levels. Question: ${question}`,
        traceId: state.traceId,
        sessionId: state.sessionId,
        workspaceId: state.workspaceId,
        teamId: state.teamId,
        staffId: state.staffId,
      },
      { priority: EventPriority.CRITICAL }
    );
  }

  /**
   * Notifies user that task continued with defaults
   */
  private async notifyContinuedWithDefaults(
    state: EscalationState,
    question: string,
    originalTask: string
  ): Promise<void> {
    await sendOutboundMessage(
      'escalation-manager',
      state.userId,
      `⚠️ **Continued with Defaults**\n\n` +
        `Agent '${state.agentId}' requested clarification but received no response.\n\n` +
        `**Question:**\n${question}\n\n` +
        `**Task:** ${originalTask}\n\n` +
        `The task has continued with default assumptions. Please review the results.`,
      undefined,
      state.sessionId,
      'SystemGuard',
      undefined,
      undefined,
      undefined,
      state.workspaceId,
      state.teamId,
      state.staffId
    );
  }

  /**
   * Escalates to admin users
   */
  private async escalateToAdmin(
    state: EscalationState,
    policy: EscalationPolicy,
    question: string,
    originalTask: string
  ): Promise<void> {
    if (!policy.adminUserIds || policy.adminUserIds.length === 0) {
      logger.warn(`No admin users configured for policy ${policy.id}, failing instead`);
      await this.completeEscalation(state, 'failed');
      await this.notifyFinalFailure(state, question, originalTask);
      return;
    }

    for (const adminUserId of policy.adminUserIds) {
      await sendOutboundMessage(
        'escalation-manager',
        adminUserId,
        `🚨 **Admin Escalation Required**\n\n` +
          `User ${state.userId} has not responded to clarification requests.\n\n` +
          `**Agent:** ${state.agentId}\n` +
          `**Question:**\n${question}\n\n` +
          `**Task:** ${originalTask}\n\n` +
          `Please intervene or contact the user directly.`,
        undefined,
        state.sessionId,
        'SystemGuard',
        undefined
      );
    }

    await this.completeEscalation(state, 'escalated_to_admin');
  }
}

// Export singleton instance
export const escalationManager = new EscalationManager();
