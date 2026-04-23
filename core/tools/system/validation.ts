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
      } catch (error: any) {
        tscOut = error.stdout || error.message;
        const stderr = error.stderr ? `\nSTDERR:\n${error.stderr}` : '';
        return `VALIDATION_FAILED (TypeScript): Codebase has type errors.\n\nDETAILS:\n${tscOut}${stderr}`;
      }

      try {
        const { stdout } = await execAsync('npx eslint . --fix-dry-run', { cwd: targetDir });
        lintOut = stdout;
      } catch (error: any) {
        lintOut = error.stdout || error.message;
        const stderr = error.stderr ? `\nSTDERR:\n${error.stderr}` : '';
        return `VALIDATION_FAILED (ESLint): Codebase has linting errors.\n\nDETAILS:\n${lintOut}${stderr}`;
      }

      return `TYPE_CHECK_PASSED: Codebase is type-safe.\nLINT_PASSED: No critical lint errors.\n\nDetails:\n${tscOut}\n${lintOut}`;
    } catch (error) {
      return `VALIDATION_FAILED: ${formatErrorMessage(error)}`;
    }
  },
};
