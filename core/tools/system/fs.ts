import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { systemSchema as schema } from './schema';
import { logger } from '../../lib/logger';
import { formatErrorMessage } from '../../lib/utils/error';
import { isProtectedPath } from '../../lib/utils/fs-security';

const execAsync = promisify(exec);

/**
 * Commands allowed to be executed via shell.
 */
const ALLOWED_COMMANDS = [
  'ls',
  'cat',
  'grep',
  'find',
  'npm',
  'pnpm',
  'make',
  'git',
  'sst',
  'tsc',
  'mkdir',
  'cp',
  'mv',
  'rm',
  'touch',
  'echo',
  'pwd',
  'date',
  'diff',
  'patch',
  'vi', // for basic edits if needed
  'head',
  'tail',
  'sort',
  'uniq',
  'wc',
  'du',
  'df',
  'ps',
  'lsof',
  'node',
];

/**
 * Dangerous patterns that are explicitly blocked even if the command is allowed.
 */
const BLOCKED_PATTERNS = [
  'rm -rf /', // Block root deletion
  'rm -rf .', // Block current directory deletion
  'rm -rf *', // Block all files deletion
  'rm -rf ~', // Block home directory deletion
  'rm -rf node_modules', // Block dependencies deletion
  'curl',
  'wget',
  '| bash',
  '| sh',
  '> /dev/sda', // Block raw disk access
  'sudo',
  'chmod 777',
  'chown',
];

/**
 * Validates if a command is safe to execute.
 */
function isCommandSafe(
  command: string,
  manuallyApproved: boolean = false
): { safe: boolean; reason?: string } {
  const trimmed = command.trim();
  if (!trimmed) return { safe: false, reason: 'Empty command' };

  // 1. Check blocked patterns first
  for (const pattern of BLOCKED_PATTERNS) {
    if (trimmed.includes(pattern)) {
      logger.warn(`Blocked dangerous pattern: "${pattern}" in command: "${trimmed}"`);
      return { safe: false, reason: `Dangerous pattern detected: ${pattern}` };
    }
  }

  // 2. Check if the primary command is in the allowlist
  const baseCommand = trimmed.split(' ')[0].split('/').pop(); // Get 'ls' from '/bin/ls' or 'ls -la'
  if (!baseCommand || !ALLOWED_COMMANDS.includes(baseCommand)) {
    logger.warn(`Command not in allowlist: "${baseCommand}"`);
    return { safe: false, reason: `Command "${baseCommand}" is not in the allowlist` };
  }

  // 3. Centralized Protected Path Check (G2)
  // Check if any word in the command looks like a protected path
  const parts = trimmed.split(/\s+/);
  for (const part of parts) {
    // Simple heuristic for paths: contains dot or slash, doesn't start with dash
    if ((part.includes('.') || part.includes('/')) && !part.startsWith('-')) {
      if (isProtectedPath(part) && !manuallyApproved) {
        logger.warn(`Protected path detected in command: "${part}"`);
        return {
          safe: false,
          reason: `PERMISSION_DENIED: Command targets a protected system file (${part}). This requires 'manuallyApproved: true'.`,
        };
      }
    }
  }

  return { safe: true };
}

/**
 * Executes an arbitrary shell command in a given directory.
 */
export const runShellCommand = {
  ...schema.runShellCommand,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { command, dir_path, manuallyApproved } = args as {
      command: string;
      dir_path?: string;
      manuallyApproved?: boolean;
    };

    const safety = isCommandSafe(command, manuallyApproved);
    if (!safety.safe) {
      return `Execution BLOCKED: ${safety.reason}`;
    }

    try {
      const projectRoot = process.cwd();
      const targetDir = dir_path ? path.resolve(projectRoot, dir_path) : projectRoot;

      // Constrain execution to project directory
      if (!targetDir.startsWith(projectRoot)) {
        return `Execution BLOCKED: Directory path "${dir_path}" is outside of the project root.`;
      }

      logger.info(`Executing shell command: ${command} in ${targetDir}`);
      const { stdout, stderr } = await execAsync(command, {
        cwd: targetDir,
        env: {
          ...process.env,
          PATH: process.env.PATH, // Ensure PATH is preserved for allowlisted commands
        },
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
  execute: async (args: Record<string, unknown> = {}): Promise<string> => {
    try {
      const { dir_path } = (args || {}) as { dir_path?: string };
      const projectRoot = process.cwd();
      const targetDir = dir_path ? path.resolve(projectRoot, dir_path) : projectRoot;

      logger.info(`Running autonomous test suite in ${targetDir}...`);

      // Link node_modules if missing (remediation for /tmp workspaces)
      const targetNodeModules = path.join(targetDir, 'node_modules');
      const rootNodeModules = path.join(projectRoot, 'node_modules');

      if (!fs.existsSync(targetNodeModules) && fs.existsSync(rootNodeModules)) {
        try {
          fs.symlinkSync(rootNodeModules, targetNodeModules, 'dir');
        } catch (e) {
          logger.warn(`Failed to symlink node_modules: ${formatErrorMessage(e)}`);
        }
      }

      const { stdout, stderr } = await execAsync('npm test', { cwd: targetDir });
      return `Test Results:\n${stdout}\n${stderr}`;
    } catch (error) {
      return `Tests FAILED:\n${formatErrorMessage(error)}`;
    }
  },
};
