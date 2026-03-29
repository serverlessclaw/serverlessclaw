import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { systemSchema as schema } from './schema';
import { logger } from '../../lib/logger';
import { formatErrorMessage } from '../../lib/utils/error';

const execAsync = promisify(exec);

/**
 * Executes an arbitrary shell command in a given directory.
 */
export const runShellCommand = {
  ...schema.runShellCommand,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { command, dir_path } = args as { command: string; dir_path?: string };
    try {
      logger.info(`Executing shell command: ${command} in ${dir_path ?? 'root'}`);
      const { stdout, stderr } = await execAsync(command, {
        cwd: dir_path ? path.resolve(process.cwd(), dir_path) : process.cwd(),
      });
      return `Output:\n${stdout}\n${stderr}`;
    } catch (error) {
      return `Execution FAILED:\n${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Runs the project unit tests using 'npm test'.
 */
export const runTests = {
  ...schema.runTests,
  execute: async (): Promise<string> => {
    try {
      logger.info('Running autonomous test suite...');
      const { stdout, stderr } = await execAsync('npm test');
      return `Test Results:\n${stdout}\n${stderr}`;
    } catch (error) {
      return `Tests FAILED:\n${formatErrorMessage(error)}`;
    }
  },
};
