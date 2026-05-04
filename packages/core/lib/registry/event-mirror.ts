import { logger } from '../logger';

export interface AgentBusEvent {
  source: string;
  detailType: string;
  detail: Record<string, any>;
}

export interface IEventMirror {
  /**
   * Called when a new event is published to the AgentBus.
   */
  onEvent: (event: AgentBusEvent) => Promise<void> | void;
}

/**
 * Registry for AgentBus event mirrors.
 * Allows plugins to subscribe to all internal framework signals.
 */
export class EventMirrorRegistry {
  private static mirrors: IEventMirror[] = [];

  /**
   * Registers a new event mirror.
   */
  static register(mirror: IEventMirror) {
    this.mirrors.push(mirror);
    logger.debug(`[EventMirrorRegistry] Registered new mirror. Total: ${this.mirrors.length}`);
  }

  /**
   * Mirrors an event to all registered sinks.
   */
  static async mirror(event: AgentBusEvent) {
    for (const mirror of this.mirrors) {
      try {
        await mirror.onEvent(event);
      } catch (err) {
        logger.error('[EventMirrorRegistry] Error in mirror onEvent:', err);
      }
    }
  }

  /**
   * Clears all mirrors (useful for testing).
   */
  static clear() {
    this.mirrors = [];
  }
}
