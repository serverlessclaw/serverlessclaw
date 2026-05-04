import { SessionStateManager } from '../session/session-state';
import { logger } from '../logger';

export class HeartbeatMonitor {
  private interval: ReturnType<typeof setInterval> | undefined;
  private isRunning = false;

  constructor(
    private sessionId: string,
    private agentId: string,
    private sessionStateManager: SessionStateManager,
    private onLockLost: (err: Error) => void
  ) {}

  public start(initialInterval = 15000) {
    if (this.isRunning) return;
    this.isRunning = true;

    this.interval = setInterval(async () => {
      try {
        const renewed = await this.sessionStateManager.renewProcessing(
          this.sessionId,
          this.agentId
        );
        if (!renewed) {
          logger.warn(`[HeartbeatMonitor] Lock lost for ${this.sessionId}`);
          this.stop();
          this.onLockLost(new Error('LockLostError: Session lock lost'));
        }
      } catch (err) {
        logger.error(`[HeartbeatMonitor] Error renewing lock:`, err);
      }
    }, initialInterval);
  }

  public stop() {
    if (this.interval) clearInterval(this.interval);
    this.isRunning = false;
  }
}
