import { describe, it, expect, vi } from 'vitest';
import { isProtectedPath, checkFileSecurity, checkArgumentsForSecurity } from './fs-security';

// Mock the entire constants module
vi.mock('../constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../constants')>();
  return {
    ...actual,
    PROTECTED_FILES: [
      '.git',
      '.env',
      'package-lock.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'node_modules',
      'src/secret/',
    ],
  };
});

describe('fs-security', () => {
  describe('isProtectedPath', () => {
    it('returns false for empty path', () => {
      expect(isProtectedPath('')).toBe(false);
      expect(isProtectedPath(null as any)).toBe(false);
    });

    it('returns true for CRITICAL files', () => {
      expect(isProtectedPath('sst.config.ts')).toBe(true);
      expect(isProtectedPath('core/lib/constants.ts')).toBe(true);
      expect(isProtectedPath('.env')).toBe(true);
      expect(isProtectedPath('package.json')).toBe(true);
    });

    it('returns true for paths starting with infra/', () => {
      expect(isProtectedPath('infra/api.ts')).toBe(true);
      expect(isProtectedPath('infra/storage.ts')).toBe(true);
    });

    it('returns true for files in PROTECTED_FILES', () => {
      expect(isProtectedPath('.git')).toBe(true);
      expect(isProtectedPath('pnpm-lock.yaml')).toBe(true);
    });

    it('returns true for directories in PROTECTED_FILES (ending with /)', () => {
      expect(isProtectedPath('src/secret/myfile.txt')).toBe(true);
      expect(isProtectedPath('src/secret/')).toBe(true);
    });

    it('returns true for AUTHORITATIVE directories (core, docs/governance, .github)', () => {
      expect(isProtectedPath('core/lib/utils/fs-security.ts')).toBe(true);
      expect(isProtectedPath('docs/governance/AUDIT.md')).toBe(true);
      expect(isProtectedPath('.github/workflows/deploy.yml')).toBe(true);
      expect(isProtectedPath('.antigravity/brain/session.md')).toBe(true);
    });

    it('returns false for non-protected paths (src, README)', () => {
      expect(isProtectedPath('src/index.ts')).toBe(false);
      expect(isProtectedPath('README.md')).toBe(false);
      expect(isProtectedPath('public/favicon.ico')).toBe(false);
    });

    it('normalizes backslashes to forward slashes', () => {
      expect(isProtectedPath('infra\\api.ts')).toBe(true);
      expect(isProtectedPath('src\\secret\\file.ts')).toBe(true);
    });
  });

  describe('checkFileSecurity', () => {
    it('returns null for non-protected paths', () => {
      expect(checkFileSecurity('src/index.ts', false)).toBeNull();
    });

    it('returns error message for protected paths without manual approval', () => {
      const result = checkFileSecurity('.env', false);
      expect(result).toContain('PERMISSION_DENIED');
      expect(result).toContain('.env');
    });

    it('returns null for protected paths with manual approval', () => {
      expect(checkFileSecurity('.env', true)).toBeNull();
    });

    it('uses the specified operation in the error message', () => {
      const result = checkFileSecurity('.env', false, 'deletes');
      expect(result).toContain("deletes to '.env'");
    });

    it('defaults to "writes" for operation if not specified', () => {
      const result = checkFileSecurity('.env', false);
      expect(result).toContain("writes to '.env'");
    });
  });

  describe('checkArgumentsForSecurity', () => {
    it('returns null if no paths are provided', () => {
      const args = { name: 'test', count: 1 };
      expect(checkArgumentsForSecurity(args, 'testOp')).toBeNull();
    });

    it('returns error if explicit path key targets protected file', () => {
      const args = { path: 'core/lib/utils/fs-security.ts' };
      const result = checkArgumentsForSecurity(args, 'testOp');
      expect(result).toContain('PERMISSION_DENIED');
    });

    it('returns error if hidden path targets protected file (Heuristic Scan)', () => {
      const args = {
        deeply: {
          nested: {
            unknown_key: 'infra/deployment.ts',
          },
        },
      };
      const result = checkArgumentsForSecurity(args, 'testOp');
      expect(result).toContain('PERMISSION_DENIED');
      expect(result).toContain('discovered path in arg: unknown_key');
    });

    it('respects manuallyApproved flag in deep scan', () => {
      const args = {
        secret: 'core/secret.ts',
        manuallyApproved: true,
      };
      expect(checkArgumentsForSecurity(args, 'testOp')).toBeNull();
    });
  });
});
