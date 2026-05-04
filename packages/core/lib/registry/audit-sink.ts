import { logger } from '../logger';

export interface AuditEvent {
  type: 'safety_violation' | 'circuit_breaker' | 'anomaly' | 'budget_exhausted' | 'security_block';
  agentId: string;
  traceId?: string;
  sessionId?: string;
  workspaceId?: string;
  userId?: string;
  details: Record<string, any>;
  timestamp: number;
}

export interface IAuditSink {
  /**
   * Called when a critical audit event occurs.
   */
  onEvent: (event: AuditEvent) => Promise<void> | void;
}

/**
 * Registry for audit sinks.
 * Allows plugins to subscribe to security and performance events.
 */
export class AuditSinkRegistry {
  private static sinks: IAuditSink[] = [];

  /**
   * Registers a new audit sink.
   */
  static register(sink: IAuditSink) {
    this.sinks.push(sink);
    logger.debug(`[AuditSinkRegistry] Registered new sink. Total: ${this.sinks.length}`);
  }

  /**
   * Broadcasts an audit event to all registered sinks.
   */
  static async broadcast(event: Omit<AuditEvent, 'timestamp'>) {
    const fullEvent: AuditEvent = {
      ...event,
      timestamp: Date.now(),
    };

    logger.info(`[AuditSinkRegistry] Broadcasting ${fullEvent.type} event`, {
      agentId: fullEvent.agentId,
      workspaceId: fullEvent.workspaceId,
    });

    for (const sink of this.sinks) {
      try {
        await sink.onEvent(fullEvent);
      } catch (err) {
        logger.error('[AuditSinkRegistry] Error in sink onEvent:', err);
      }
    }
  }

  /**
   * Clears all sinks (useful for testing).
   */
  static clear() {
    this.sinks = [];
  }
}
