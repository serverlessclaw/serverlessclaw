import { logger } from '../logger';

export interface TelemetryData {
  traceId: string;
  agentId: string;
  workspaceId?: string;
  operation: string;
  status: 'start' | 'success' | 'error';
  durationMs?: number;
  metadata?: Record<string, any>;
  timestamp: number;
}

export interface ITelemetrySink {
  /**
   * Called when new telemetry data is recorded.
   */
  record: (data: TelemetryData) => Promise<void> | void;
}

/**
 * Registry for telemetry sinks.
 * Allows plugins to export framework metrics and traces to external systems.
 */
export class TelemetrySinkRegistry {
  private static sinks: ITelemetrySink[] = [];

  /**
   * Registers a new telemetry sink.
   */
  static register(sink: ITelemetrySink) {
    this.sinks.push(sink);
    logger.debug(`[TelemetrySinkRegistry] Registered new sink. Total: ${this.sinks.length}`);
  }

  /**
   * Records telemetry data to all registered sinks.
   */
  static async record(data: Omit<TelemetryData, 'timestamp'>) {
    const fullData: TelemetryData = {
      ...data,
      timestamp: Date.now(),
    };

    for (const sink of this.sinks) {
      try {
        await sink.record(fullData);
      } catch (err) {
        logger.error('[TelemetrySinkRegistry] Error in sink record:', err);
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
