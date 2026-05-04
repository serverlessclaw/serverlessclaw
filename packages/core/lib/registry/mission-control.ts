import { logger } from '../logger';

export interface MissionSignal {
  type:
    | 'strategy_update'
    | 'progress_update'
    | 'milestone_reached'
    | 'resource_allocated'
    | 'handover';
  agentId: string;
  traceId: string;
  workspaceId?: string;
  payload: Record<string, any>;
  timestamp: number;
}

export interface IMissionObserver {
  /**
   * Called when a mission signal is emitted.
   */
  onSignal: (signal: MissionSignal) => Promise<void> | void;
}

/**
 * Registry for Mission Control observers.
 * Allows external dashboards to subscribe to live agent mission state.
 */
export class MissionControlRegistry {
  private static observers: IMissionObserver[] = [];

  /**
   * Registers a new mission observer.
   */
  static register(observer: IMissionObserver) {
    this.observers.push(observer);
    logger.debug(
      `[MissionControlRegistry] Registered new observer. Total: ${this.observers.length}`
    );
  }

  /**
   * Emits a mission signal to all registered observers.
   */
  static async signal(data: Omit<MissionSignal, 'timestamp'>) {
    const signal: MissionSignal = {
      ...data,
      timestamp: Date.now(),
    };

    for (const observer of this.observers) {
      try {
        await observer.onSignal(signal);
      } catch (err) {
        logger.error('[MissionControlRegistry] Error in observer onSignal:', err);
      }
    }
  }

  /**
   * Clears all observers (useful for testing).
   */
  static clear() {
    this.observers = [];
  }
}
