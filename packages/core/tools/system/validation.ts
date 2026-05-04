import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { systemSchema as schema } from './schema';
import { logger } from '../../lib/logger';
import { formatErrorMessage } from '../../lib/utils/error';

const execAsync = promisify(exec);

/**
 * Validates the current codebase using type checking and linting.
 */
export const validateCode = {
  ...schema.validateCode,
  execute: async (args: Record<string, unknown> = {}): Promise<string> => {
    try {
      const { dir_path } = (args || {}) as { dir_path?: string };
      const projectRoot = process.cwd();
      const targetDir = dir_path ? path.resolve(projectRoot, dir_path) : projectRoot;

      logger.info(`Running code validation in ${targetDir}...`);

      // Remediate workspace issue: if running in a temp directory (like /tmp),
      // we might need to link node_modules from the project root.
      const targetNodeModules = path.join(targetDir, 'node_modules');
      const rootNodeModules = path.join(projectRoot, 'node_modules');

      if (!fs.existsSync(targetNodeModules) && fs.existsSync(rootNodeModules)) {
        try {
          logger.info(`Symlinking node_modules from ${rootNodeModules} to ${targetNodeModules}`);
          fs.symlinkSync(rootNodeModules, targetNodeModules, 'dir');
        } catch (linkError) {
          logger.warn(`Failed to symlink node_modules: ${formatErrorMessage(linkError)}`);
        }
      }

      // Use npx to ensure we use the project's locally installed tools
      let tscOut = '';
      let lintOut = '';

      try {
        const { stdout } = await execAsync('npx tsc --noEmit', { cwd: targetDir });
        tscOut = stdout;
      } catch (error: unknown) {
        const err = error as { stdout?: string; stderr?: string; message: string };
        tscOut = err.stdout || err.message;
        const stderr = err.stderr ? `\nSTDERR:\n${err.stderr}` : '';
        return `VALIDATION_FAILED (TypeScript): Codebase has type errors.\n\nDETAILS:\n${tscOut}${stderr}`;
      }

      try {
        const { stdout } = await execAsync('npx eslint . --fix-dry-run', { cwd: targetDir });
        lintOut = stdout;
      } catch (error: unknown) {
        const err = error as { stdout?: string; stderr?: string; message: string };
        lintOut = err.stdout || err.message;
        const stderr = err.stderr ? `\nSTDERR:\n${err.stderr}` : '';
        return `VALIDATION_FAILED (ESLint): Codebase has linting errors.\n\nDETAILS:\n${lintOut}${stderr}`;
      }

      return `TYPE_CHECK_PASSED: Codebase is type-safe.\nLINT_PASSED: No critical lint errors.\n\nDetails:\n${tscOut}\n${lintOut}`;
    } catch (error) {
      return `VALIDATION_FAILED: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Runs the full verification suite (check + test).
 */
export const verifyChanges = {
  ...schema.verifyChanges,
  execute: async (args: Record<string, unknown> = {}): Promise<string> => {
    try {
      const { fast, scope } = (args || {}) as { fast?: boolean; scope?: string };
      const projectRoot = process.cwd();

      logger.info(`Running full verification in ${projectRoot}...`);

      let command = 'make check && make test';
      if (fast) {
        command = 'make check && pnpm test -- --run'; // Faster run mode
      }

      if (scope) {
        // If scope is provided, use turbo filters or pnpm filters
        command = `turbo run check test --filter=${scope}`;
      }

      const startTime = Date.now();
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: projectRoot,
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large test outputs
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        return `VERIFICATION_SUCCESSFUL: All checks and tests passed in ${duration}s.\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;
      } catch (error: unknown) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const errObj = error as { stdout?: string; stderr?: string; message: string };
        const out = errObj.stdout || '';
        const err = errObj.stderr || errObj.message;

        return `VERIFICATION_FAILED: Suite failed after ${duration}s.\n\nSTDOUT:\n${out}\n\nSTDERR:\n${err}`;
      }
    } catch (error) {
      return `VERIFICATION_ERROR: ${formatErrorMessage(error)}`;
    }
  },
};
