/**
 * Core interface for repository synchronization (Subtree/Fork).
 * This abstraction allows sensors (GitHub, Jira, etc.) to trigger syncs
 * through a unified platform-agnostic interface.
 */
export interface SyncOrchestrator {
  /**
   * Performs a pull from the Mother Hub.
   * @param options - Configuration for the pull operation.
   */
  pull(options: SyncOptions): Promise<SyncResult>;

  /**
   * Performs a push back to the Mother Hub (typically for verified contributions).
   * @param options - Configuration for the push operation.
   */
  push(options: SyncOptions): Promise<SyncResult>;

  /**
   * Checks for synchronization health and potential conflicts.
   */
  verify(options: SyncOptions): Promise<SyncVerification>;
}

/**
 * Interface for concurrency locking to prevent repository corruption.
 */
export interface SyncLock {
  acquire(resourceId: string, ttlMs?: number): Promise<boolean>;
  release(resourceId: string): Promise<void>;
  isLocked(resourceId: string): Promise<boolean>;
}

export type SyncMethod = 'subtree' | 'fork';

export interface SyncPolicy {
  /** Mode for conflict resolution: deterministic or agentic (swarm). */
  conflictResolution: 'deterministic' | 'agentic';
  /** Whether to require human approval for pushes (Hub side). */
  requireApproval: boolean;
  /** Files or patterns to exclude/abstract during sync (PII/Proprietary). */
  abstractionFilters?: string[];
}

export interface SyncOptions {
  hubUrl: string;
  prefix?: string;
  method: SyncMethod;
  commitMessage: string;
  gapIds?: string[];
  traceId?: string;
  /** Whether to dry-run the sync for validation. */
  dryRun?: boolean;
  /** Optional lock implementation. */
  lock?: SyncLock;
  /** Policy for sync behavior. */
  policy?: SyncPolicy;
}

export interface SyncResult {
  success: boolean;
  message: string;
  commitHash?: string;
  conflicts?: SyncConflict[];
  buildId?: string;
  locked?: boolean;
}

export interface SyncVerification {
  ok: boolean;
  reachable: boolean;
  canSyncWithoutConflict: boolean;
  message?: string;
}

export interface SyncConflict {
  file: string;
  type: 'content' | 'delete' | 'permission';
  description: string;
}
