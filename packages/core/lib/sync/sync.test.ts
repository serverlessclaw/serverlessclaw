import { describe, it, expect } from 'vitest';
import {
  SyncOrchestrator,
  SyncOptions,
  SyncResult,
  SyncVerification,
  SyncMethod,
  SyncConflict,
} from '../types/sync';

describe('Sync Types', () => {
  describe('SyncOrchestrator interface', () => {
    it('should define pull method signature', () => {
      const orchestrator: SyncOrchestrator = {
        pull: async (_options: SyncOptions): Promise<SyncResult> => {
          return { success: true, message: 'ok' };
        },
        push: async (_options: SyncOptions): Promise<SyncResult> => {
          return { success: true, message: 'ok' };
        },
        verify: async (_options: SyncOptions): Promise<SyncVerification> => {
          return { ok: true, reachable: true, canSyncWithoutConflict: true };
        },
      };
      expect(orchestrator).toBeDefined();
    });
  });

  describe('SyncOptions', () => {
    it('should accept all required fields', () => {
      const options: SyncOptions = {
        hubUrl: 'https://github.com/test/hub.git',
        method: 'subtree',
        commitMessage: 'test commit',
      };
      expect(options.hubUrl).toBe('https://github.com/test/hub.git');
      expect(options.method).toBe('subtree');
      expect(options.commitMessage).toBe('test commit');
    });

    it('should accept optional fields', () => {
      const options: SyncOptions = {
        hubUrl: 'https://github.com/test/hub.git',
        prefix: 'core/',
        method: 'fork',
        commitMessage: 'test commit',
        gapIds: ['gap-1', 'gap-2'],
        traceId: 'trace-123',
        dryRun: true,
      };
      expect(options.prefix).toBe('core/');
      expect(options.gapIds).toEqual(['gap-1', 'gap-2']);
      expect(options.traceId).toBe('trace-123');
      expect(options.dryRun).toBe(true);
    });
  });

  describe('SyncResult', () => {
    it('should define success result structure', () => {
      const result: SyncResult = {
        success: true,
        message: 'Sync completed',
        commitHash: 'abc123',
      };
      expect(result.success).toBe(true);
      expect(result.commitHash).toBe('abc123');
    });

    it('should define failure result structure', () => {
      const result: SyncResult = {
        success: false,
        message: 'Sync failed',
        conflicts: [{ file: 'src/main.ts', type: 'content', description: 'Merge conflict' }],
      };
      expect(result.success).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts?.[0].file).toBe('src/main.ts');
    });
  });

  describe('SyncVerification', () => {
    it('should define verification result structure', () => {
      const verification: SyncVerification = {
        ok: true,
        reachable: true,
        canSyncWithoutConflict: true,
        message: 'All checks passed',
      };
      expect(verification.ok).toBe(true);
      expect(verification.canSyncWithoutConflict).toBe(true);
    });

    it('should handle verification failure', () => {
      const verification: SyncVerification = {
        ok: false,
        reachable: false,
        canSyncWithoutConflict: false,
        message: 'Remote not reachable',
      };
      expect(verification.ok).toBe(false);
      expect(verification.reachable).toBe(false);
    });
  });

  describe('SyncMethod', () => {
    it('should accept subtree method', () => {
      const method: SyncMethod = 'subtree';
      expect(method).toBe('subtree');
    });

    it('should accept fork method', () => {
      const method: SyncMethod = 'fork';
      expect(method).toBe('fork');
    });
  });

  describe('SyncConflict', () => {
    it('should define content conflict type', () => {
      const conflict: SyncConflict = {
        file: 'src/index.ts',
        type: 'content',
        description: 'Merge conflict in file',
      };
      expect(conflict.type).toBe('content');
    });

    it('should define delete conflict type', () => {
      const conflict: SyncConflict = {
        file: 'src/deleted.ts',
        type: 'delete',
        description: 'File deleted in both branches',
      };
      expect(conflict.type).toBe('delete');
    });

    it('should define permission conflict type', () => {
      const conflict: SyncConflict = {
        file: 'src/script.sh',
        type: 'permission',
        description: 'Permission changed',
      };
      expect(conflict.type).toBe('permission');
    });
  });
});
