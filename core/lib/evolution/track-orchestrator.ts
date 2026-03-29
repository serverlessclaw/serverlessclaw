/**
 * @module TrackOrchestrator
 * @description Multi-track evolution orchestration for Serverless Claw.
 * Manages parallel evolution tracks with track-aware budget allocation,
 * cross-track dependency detection, and lifecycle management.
 */

import { EvolutionTrack, GapStatus } from '../types/agent';
import { logger } from '../logger';
import { MEMORY_KEYS, TIME } from '../constants';
import type { BaseMemoryProvider } from '../memory/base';
import { acquireGapLock, releaseGapLock, getGapLock } from '../memory/gap-operations';

/**
 * Track lifecycle states.
 */
export enum TrackState {
  IDLE = 'idle',
  ACTIVE = 'active',
  PAUSED = 'paused',
  THROTTLED = 'throttled',
  COMPLETED = 'completed',
}

/**
 * Track execution context.
 */
export interface TrackContext {
  track: EvolutionTrack;
  state: TrackState;
  activeGaps: string[];
  completedGaps: string[];
  failedGaps: string[];
  startedAt: number;
  lastActivityAt: number;
  totalSpendUsd: number;
  budgetAllocatedUsd: number;
}

/**
 * Cross-track dependency.
 */
export interface TrackDependency {
  sourceTrack: EvolutionTrack;
  targetTrack: EvolutionTrack;
  gapId: string;
  reason: string;
  resolved: boolean;
}

/**
 * Track performance metrics.
 */
export interface TrackMetrics {
  track: EvolutionTrack;
  gapsProcessed: number;
  gapsSucceeded: number;
  gapsFailed: number;
  avgLatencyMs: number;
  totalSpendUsd: number;
  successRate: number;
}

/**
 * Configuration for the track orchestrator.
 */
export interface TrackOrchestratorConfig {
  /** Maximum total budget across all tracks. */
  maxTotalBudgetUsd: number;
  /** Budget allocation weights per track. */
  budgetWeights: Record<EvolutionTrack, number>;
  /** Maximum concurrent gaps per track. */
  maxConcurrentPerTrack: Record<EvolutionTrack, number>;
  /** Enable cross-track dependency detection. */
  enableCrossTrackDependencies: boolean;
}

const DEFAULT_CONFIG: TrackOrchestratorConfig = {
  maxTotalBudgetUsd: 10.0,
  budgetWeights: {
    [EvolutionTrack.SECURITY]: 0.3,
    [EvolutionTrack.PERFORMANCE]: 0.25,
    [EvolutionTrack.FEATURE]: 0.2,
    [EvolutionTrack.INFRASTRUCTURE]: 0.15,
    [EvolutionTrack.REFACTORING]: 0.1,
  },
  maxConcurrentPerTrack: {
    [EvolutionTrack.SECURITY]: 2,
    [EvolutionTrack.PERFORMANCE]: 3,
    [EvolutionTrack.FEATURE]: 3,
    [EvolutionTrack.INFRASTRUCTURE]: 2,
    [EvolutionTrack.REFACTORING]: 2,
  },
  enableCrossTrackDependencies: true,
};

/**
 * Orchestrates parallel evolution across multiple tracks.
 */
export class TrackOrchestrator {
  private base: BaseMemoryProvider;
  private config: TrackOrchestratorConfig;
  private tracks: Map<EvolutionTrack, TrackContext> = new Map();
  private dependencies: TrackDependency[] = [];
  private metrics: Map<EvolutionTrack, TrackMetrics> = new Map();

  constructor(base: BaseMemoryProvider, config?: Partial<TrackOrchestratorConfig>) {
    this.base = base;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize all tracks
    for (const track of Object.values(EvolutionTrack)) {
      this.tracks.set(track, {
        track,
        state: TrackState.IDLE,
        activeGaps: [],
        completedGaps: [],
        failedGaps: [],
        startedAt: 0,
        lastActivityAt: 0,
        totalSpendUsd: 0,
        budgetAllocatedUsd: this.config.maxTotalBudgetUsd * this.config.budgetWeights[track],
      });

      this.metrics.set(track, {
        track,
        gapsProcessed: 0,
        gapsSucceeded: 0,
        gapsFailed: 0,
        avgLatencyMs: 0,
        totalSpendUsd: 0,
        successRate: 1,
      });
    }

    logger.info('TrackOrchestrator initialized', {
      maxBudget: this.config.maxTotalBudgetUsd,
      tracks: Object.values(EvolutionTrack),
    });
  }

  /**
   * Activate a track for evolution.
   */
  async activateTrack(track: EvolutionTrack): Promise<boolean> {
    const context = this.tracks.get(track);
    if (!context) {
      logger.error(`Track ${track} not found`);
      return false;
    }

    if (context.state === TrackState.ACTIVE) {
      logger.info(`Track ${track} is already active`);
      return true;
    }

    // Check budget availability
    if (!this.hasBudgetAvailable(track)) {
      logger.warn(`Track ${track} has no budget available`);
      context.state = TrackState.THROTTLED;
      return false;
    }

    context.state = TrackState.ACTIVE;
    context.startedAt = Date.now();
    context.lastActivityAt = Date.now();

    await this.saveTrackState(track, context);
    logger.info(`Track ${track} activated`);
    return true;
  }

  /**
   * Pause a track.
   */
  async pauseTrack(track: EvolutionTrack): Promise<void> {
    const context = this.tracks.get(track);
    if (!context) return;

    context.state = TrackState.PAUSED;
    await this.saveTrackState(track, context);
    logger.info(`Track ${track} paused`);
  }

  /**
   * Resume a paused track.
   */
  async resumeTrack(track: EvolutionTrack): Promise<boolean> {
    const context = this.tracks.get(track);
    if (!context || context.state !== TrackState.PAUSED) {
      return false;
    }

    return this.activateTrack(track);
  }

  /**
   * Check if a gap can be dispatched to a track.
   */
  async canDispatchToTrack(track: EvolutionTrack, gapId: string): Promise<boolean> {
    const context = this.tracks.get(track);
    if (!context) return false;

    // Check track state
    if (context.state !== TrackState.ACTIVE && context.state !== TrackState.IDLE) {
      return false;
    }

    // Check concurrent limit
    if (context.activeGaps.length >= this.config.maxConcurrentPerTrack[track]) {
      logger.info(`Track ${track} at concurrent limit (${context.activeGaps.length})`);
      return false;
    }

    // Check budget
    if (!this.hasBudgetAvailable(track)) {
      return false;
    }

    // Check gap lock
    const lock = await getGapLock(this.base, gapId);
    if (lock) {
      logger.info(`Gap ${gapId} is locked by ${lock.content}`);
      return false;
    }

    // Check cross-track dependencies
    if (this.config.enableCrossTrackDependencies) {
      const blocked = this.dependencies.some(
        (dep) => dep.gapId === gapId && dep.targetTrack === track && !dep.resolved
      );
      if (blocked) {
        logger.info(`Gap ${gapId} blocked by cross-track dependency`);
        return false;
      }
    }

    return true;
  }

  /**
   * Dispatch a gap to a track.
   */
  async dispatchGap(track: EvolutionTrack, gapId: string, agentId: string): Promise<boolean> {
    const canDispatch = await this.canDispatchToTrack(track, gapId);
    if (!canDispatch) {
      return false;
    }

    // Acquire gap lock
    const locked = await acquireGapLock(this.base, gapId, agentId);
    if (!locked) {
      return false;
    }

    const context = this.tracks.get(track)!;
    context.activeGaps.push(gapId);
    context.lastActivityAt = Date.now();
    context.state = TrackState.ACTIVE;

    await this.saveTrackState(track, context);
    logger.info(`Gap ${gapId} dispatched to track ${track} by ${agentId}`);
    return true;
  }

  /**
   * Complete a gap in a track.
   */
  async completeGap(
    track: EvolutionTrack,
    gapId: string,
    agentId: string,
    success: boolean,
    spendUsd: number = 0
  ): Promise<void> {
    const context = this.tracks.get(track);
    if (!context) return;

    // Release gap lock
    await releaseGapLock(this.base, gapId, agentId);

    // Update context
    context.activeGaps = context.activeGaps.filter((id) => id !== gapId);
    if (success) {
      context.completedGaps.push(gapId);
    } else {
      context.failedGaps.push(gapId);
    }
    context.totalSpendUsd += spendUsd;
    context.lastActivityAt = Date.now();

    // Update metrics
    const trackMetrics = this.metrics.get(track)!;
    trackMetrics.gapsProcessed++;
    if (success) {
      trackMetrics.gapsSucceeded++;
    } else {
      trackMetrics.gapsFailed++;
    }
    trackMetrics.totalSpendUsd += spendUsd;
    trackMetrics.successRate =
      trackMetrics.gapsProcessed > 0 ? trackMetrics.gapsSucceeded / trackMetrics.gapsProcessed : 1;

    // Check if track is complete
    if (context.activeGaps.length === 0 && context.state === TrackState.ACTIVE) {
      // Check if there are more gaps to process
      const pendingGaps = await this.getPendingGapsForTrack(track);
      if (pendingGaps.length === 0) {
        context.state = TrackState.COMPLETED;
        logger.info(`Track ${track} completed`);
      }
    }

    await this.saveTrackState(track, context);
    logger.info(`Gap ${gapId} ${success ? 'completed' : 'failed'} in track ${track}`);
  }

  /**
   * Add a cross-track dependency.
   */
  async addDependency(
    sourceTrack: EvolutionTrack,
    targetTrack: EvolutionTrack,
    gapId: string,
    reason: string
  ): Promise<void> {
    const dependency: TrackDependency = {
      sourceTrack,
      targetTrack,
      gapId,
      reason,
      resolved: false,
    };

    this.dependencies.push(dependency);
    await this.saveDependency(dependency);
    logger.info(`Cross-track dependency added: ${gapId} (${sourceTrack} -> ${targetTrack})`);
  }

  /**
   * Resolve a cross-track dependency.
   */
  async resolveDependency(gapId: string, sourceTrack: EvolutionTrack): Promise<void> {
    const dep = this.dependencies.find(
      (d) => d.gapId === gapId && d.sourceTrack === sourceTrack && !d.resolved
    );
    if (dep) {
      dep.resolved = true;
      await this.saveDependency(dep);
      logger.info(`Cross-track dependency resolved: ${gapId}`);
    }
  }

  /**
   * Check if a track has budget available.
   */
  hasBudgetAvailable(track: EvolutionTrack): boolean {
    const context = this.tracks.get(track);
    if (!context) return false;

    return context.totalSpendUsd < context.budgetAllocatedUsd;
  }

  /**
   * Get track context.
   */
  getTrackContext(track: EvolutionTrack): TrackContext | undefined {
    return this.tracks.get(track);
  }

  /**
   * Get all track contexts.
   */
  getAllTrackContexts(): TrackContext[] {
    return Array.from(this.tracks.values());
  }

  /**
   * Get track metrics.
   */
  getTrackMetrics(track: EvolutionTrack): TrackMetrics | undefined {
    return this.metrics.get(track);
  }

  /**
   * Get all track metrics.
   */
  getAllTrackMetrics(): TrackMetrics[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Get pending gaps for a track.
   */
  private async getPendingGapsForTrack(track: EvolutionTrack): Promise<string[]> {
    try {
      const items = await this.base.queryItems({
        IndexName: 'TypeTimestampIndex',
        KeyConditionExpression: '#type = :type',
        FilterExpression: '#status = :status AND #track = :track',
        ExpressionAttributeNames: {
          '#type': 'type',
          '#status': 'status',
          '#track': 'track',
        },
        ExpressionAttributeValues: {
          ':type': 'GAP',
          ':status': GapStatus.OPEN,
          ':track': track,
        },
      });

      return items.map((item) => item.userId as string);
    } catch (error) {
      logger.error(`Failed to get pending gaps for track ${track}:`, error);
      return [];
    }
  }

  /**
   * Save track state to DynamoDB.
   */
  private async saveTrackState(track: EvolutionTrack, context: TrackContext): Promise<void> {
    try {
      await this.base.putItem({
        userId: `${MEMORY_KEYS.TRACK_PREFIX}STATE#${track}`,
        timestamp: 0,
        type: 'TRACK_STATE',
        track,
        state: context.state,
        activeGaps: context.activeGaps,
        completedGaps: context.completedGaps,
        failedGaps: context.failedGaps,
        startedAt: context.startedAt,
        lastActivityAt: context.lastActivityAt,
        totalSpendUsd: context.totalSpendUsd,
        budgetAllocatedUsd: context.budgetAllocatedUsd,
        updatedAt: Date.now(),
      });
    } catch (error) {
      logger.error(`Failed to save track state for ${track}:`, error);
    }
  }

  /**
   * Save dependency to DynamoDB.
   */
  private async saveDependency(dep: TrackDependency): Promise<void> {
    try {
      await this.base.putItem({
        userId: `${MEMORY_KEYS.TRACK_PREFIX}DEP#${dep.gapId}`,
        timestamp: Date.now(),
        type: 'TRACK_DEPENDENCY',
        sourceTrack: dep.sourceTrack,
        targetTrack: dep.targetTrack,
        gapId: dep.gapId,
        reason: dep.reason,
        resolved: dep.resolved,
        expiresAt: Math.floor((Date.now() + 30 * TIME.MS_PER_DAY) / 1000),
      });
    } catch (error) {
      logger.error('Failed to save track dependency:', error);
    }
  }

  /**
   * Reset all tracks (useful for testing).
   */
  async resetAllTracks(): Promise<void> {
    for (const track of Object.values(EvolutionTrack)) {
      const context = this.tracks.get(track)!;
      context.state = TrackState.IDLE;
      context.activeGaps = [];
      context.completedGaps = [];
      context.failedGaps = [];
      context.startedAt = 0;
      context.lastActivityAt = 0;
      context.totalSpendUsd = 0;
      await this.saveTrackState(track, context);
    }
    this.dependencies = [];
    logger.info('All tracks reset');
  }

  /**
   * Load persisted track state from DynamoDB.
   * Call this after construction to restore state from a previous invocation.
   */
  async loadState(): Promise<void> {
    for (const track of Object.values(EvolutionTrack)) {
      try {
        const items = await this.base.queryItems({
          KeyConditionExpression: 'userId = :pk',
          ExpressionAttributeValues: {
            ':pk': `${MEMORY_KEYS.TRACK_PREFIX}STATE#${track}`,
          },
        });

        if (items.length > 0) {
          const item = items[0];
          const ctx = this.tracks.get(track)!;
          ctx.state = (item.state as TrackState) ?? TrackState.IDLE;
          ctx.activeGaps = (item.activeGaps as string[]) ?? [];
          ctx.completedGaps = (item.completedGaps as string[]) ?? [];
          ctx.failedGaps = (item.failedGaps as string[]) ?? [];
          ctx.totalSpendUsd = (item.totalSpendUsd as number) ?? 0;
          ctx.startedAt = (item.startedAt as number) ?? 0;
          ctx.lastActivityAt = (item.lastActivityAt as number) ?? 0;
          ctx.budgetAllocatedUsd = (item.budgetAllocatedUsd as number) ?? ctx.budgetAllocatedUsd;
        }
      } catch (error) {
        logger.error(`Failed to load state for track ${track}:`, error);
      }
    }
    logger.info('TrackOrchestrator state loaded from DynamoDB');
  }
}

/**
 * Get or create a singleton TrackOrchestrator for Lambda warm starts.
 * Uses global scope to persist across invocations within the same container.
 */
export function getTrackOrchestrator(memory: BaseMemoryProvider): TrackOrchestrator {
  const g = global as Record<string, unknown>;
  if (!g._trackOrchestrator) {
    g._trackOrchestrator = new TrackOrchestrator(memory);
  }
  return g._trackOrchestrator as TrackOrchestrator;
}
