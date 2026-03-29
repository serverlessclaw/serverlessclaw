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
  execute: async (): Promise<string> => {
    try {
      logger.info('Running code validation...');
      // Use npx to ensure we use the project's locally installed tools
      const { stdout: tscOut } = await execAsync('npx tsc --noEmit');
      const { stdout: lintOut } = await execAsync('npx eslint . --fix-dry-run');

      return `TYPE_CHECK_PASSED: Codebase is type-safe.\nLINT_PASSED: No critical lint errors.\n\nDetails:\n${tscOut}\n${lintOut}`;
    } catch (error) {
      return `VALIDATION_FAILED: ${formatErrorMessage(error)}`;
    }
  },
};
