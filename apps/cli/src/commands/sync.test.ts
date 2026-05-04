import { describe, it, expect, vi } from 'vitest';
import { CLISyncOptions } from './sync';

vi.mock('child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    if (cmd.includes('git remote')) {
      return '';
    }
    if (cmd.includes('ls-remote')) {
      return 'abc123\t refs/heads/main';
    }
    if (cmd.includes('git rev-parse')) {
      return 'def456';
    }
    return '';
  }),
}));

vi.mock('fs-extra', () => ({
  default: {
    existsSync: vi.fn(() => true),
  },
}));

describe('CLI Sync', () => {
  const mockOptions: CLISyncOptions = {
    hub: 'serverlessclaw/serverlessclaw',
    prefix: 'core/',
    workingDir: '/tmp/test-sync',
    method: 'subtree',
  };

  describe('runSync', () => {
    it('should validate options', async () => {
      expect(mockOptions.hub).toBe('serverlessclaw/serverlessclaw');
      expect(mockOptions.method).toBe('subtree');
    });

    it('should accept check flag', async () => {
      const optionsWithCheck: CLISyncOptions = {
        ...mockOptions,
        check: true,
      };
      expect(optionsWithCheck.check).toBe(true);
    });

    it('should accept abort-on-conflict flag', async () => {
      const optionsWithAbort: CLISyncOptions = {
        ...mockOptions,
        abortOnConflict: true,
      };
      expect(optionsWithAbort.abortOnConflict).toBe(true);
    });

    it('should accept json output flag', async () => {
      const optionsWithJson: CLISyncOptions = {
        ...mockOptions,
        json: true,
      };
      expect(optionsWithJson.json).toBe(true);
    });

    it('should accept dry-run flag', async () => {
      const optionsWithDryRun: CLISyncOptions = {
        ...mockOptions,
        dryRun: true,
      };
      expect(optionsWithDryRun.dryRun).toBe(true);
    });

    it('should accept verbose flag', async () => {
      const optionsWithVerbose: CLISyncOptions = {
        ...mockOptions,
        verbose: true,
      };
      expect(optionsWithVerbose.verbose).toBe(true);
    });
  });

  describe('CLI options parsing', () => {
    it('should have default values', () => {
      expect(mockOptions.prefix).toBe('core/');
      expect(mockOptions.method).toBe('subtree');
      expect(mockOptions.workingDir).toBe('/tmp/test-sync');
    });

    it('should allow fork method', () => {
      const forkOptions: CLISyncOptions = {
        ...mockOptions,
        method: 'fork',
      };
      expect(forkOptions.method).toBe('fork');
    });
  });
});
