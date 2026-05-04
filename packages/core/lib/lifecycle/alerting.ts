import { emitEvent } from '../utils/bus';
import { EventType } from '../types/agent';
import { logger } from '../logger';

export class Alerting {
  static async alertHighTokenUsage(
    agentId: string,
    tokens: number,
    threshold: number
  ): Promise<void> {
    try {
      await emitEvent('system.alerting', EventType.OUTBOUND_MESSAGE, {
        userId: 'ADMIN',
        message: `⚠️ High token usage alert: ${agentId} used ${tokens} tokens (threshold: ${threshold})`,
        agentName: 'Alerting',
      });
    } catch (e) {
      logger.warn('Failed to send token usage alert:', e);
    }
  }

  static async alertCircuitBreakerOpen(type: string): Promise<void> {
    try {
      await emitEvent('system.alerting', EventType.OUTBOUND_MESSAGE, {
        userId: 'ADMIN',
        message: `🔴 Circuit breaker OPEN for type: ${type}. Deployments blocked.`,
        agentName: 'Alerting',
      });
    } catch (e) {
      logger.warn('Failed to send circuit breaker alert:', e);
    }
  }

  static async alertDLQOverflow(count: number): Promise<void> {
    try {
      await emitEvent('system.alerting', EventType.OUTBOUND_MESSAGE, {
        userId: 'ADMIN',
        message: `⚠️ DLQ overflow: ${count} failed events in dead letter queue.`,
        agentName: 'Alerting',
      });
    } catch (e) {
      logger.warn('Failed to send DLQ overflow alert:', e);
    }
  }

  static async alertHighErrorRate(agentId: string, rate: number): Promise<void> {
    try {
      await emitEvent('system.alerting', EventType.OUTBOUND_MESSAGE, {
        userId: 'ADMIN',
        message: `⚠️ High error rate for ${agentId}: ${(rate * 100).toFixed(1)}% failures.`,
        agentName: 'Alerting',
      });
    } catch (e) {
      logger.warn('Failed to send error rate alert:', e);
    }
  }
}
