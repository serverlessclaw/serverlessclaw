import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Resource } from 'sst';
import { toolDefinitions } from './definitions/index';
import { logger } from '../lib/logger';
import { STORAGE } from '../lib/constants';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import archiver from 'archiver';
import { formatErrorMessage } from '../lib/utils/error';
import { Message } from '../lib/types';

const execAsync = promisify(exec);

// Default client for backward compatibility - can be overridden for testing
const defaultS3 = new S3Client({});

// Allow tests to inject a custom S3 client
let injectedS3: S3Client | undefined;

/**
 * Sets a custom S3 client for testing purposes.
 * @param s3 - The S3 client to use
 */
export function setS3Client(s3: S3Client): void {
  injectedS3 = s3;
}

function getS3Client(): S3Client {
  return injectedS3 ?? defaultS3;
}

interface ToolsResource {
  StagingBucket: { name: string };
  Deployer: { name: string };
}

/**
 * Stages modified files to S3 for a new deployment.
 */
export const STAGE_CHANGES = {
  ...toolDefinitions.stageChanges,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const s3 = getS3Client();
    const {
      modifiedFiles,
      sessionId,
      skipValidation = false,
    } = args as {
      modifiedFiles: string[];
      sessionId?: string;
      skipValidation?: boolean;
    };
    if (!modifiedFiles || modifiedFiles.length === 0) {
      return 'No files to stage.';
    }

    // 1. HARDENED GATE: Validation Check
    if (!skipValidation && sessionId) {
      try {
        const { getAgentContext } = await import('../lib/utils/agent-helpers');
        const { memory } = await getAgentContext();
        const history = await memory.getHistory(sessionId);

        const hasValidated = history.some((m: Message) =>
          m.content?.includes('Validation Successful')
        );
        const hasTestsRun = history.some((m: Message) => m.content?.includes('Test Results:'));

        if (!hasValidated || !hasTestsRun) {
          return 'DEFINITION_OF_DONE_VIOLATION: You must run "validateCode" and "runTests" successfully before staging changes for deployment. Ensure you have verified your changes in the current session.';
        }
      } catch (e) {
        logger.warn('Failed to verify session history for validation, proceeding with caution.', e);
      }
    }

    // 2. HARDENED GATE: Completeness Check (DoD)
    const hasLogicChanges = modifiedFiles.some(
      (f) =>
        (f.startsWith('core/') || f.startsWith('infra/')) &&
        f.endsWith('.ts') &&
        !f.endsWith('.test.ts')
    );

    if (hasLogicChanges) {
      const hasTests = modifiedFiles.some((f) => f.endsWith('.test.ts') || f.startsWith('e2e/'));
      const hasDocs = modifiedFiles.some(
        (f) => f.startsWith('docs/') || f.endsWith('.md') || f === 'INDEX.md' || f === 'README.md'
      );

      if (!hasTests) {
        return 'DEFINITION_OF_DONE_VIOLATION: Logic changes detected but no corresponding test files were modified or created. Please add tests to verify your implementation.';
      }
      if (!hasDocs) {
        return 'DEFINITION_OF_DONE_VIOLATION: Logic changes detected but no documentation was updated. Please update relevant docs or README to reflect your changes.';
      }
    }

    const typedResource = Resource as unknown as ToolsResource;
    const zipPath = STORAGE.TMP_STAGING_ZIP;
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    return new Promise((resolve) => {
      output.on('close', async () => {
        try {
          const fileBuffer = await fs.readFile(zipPath);
          await s3.send(
            new PutObjectCommand({
              Bucket: typedResource.StagingBucket.name,
              Key: STORAGE.STAGING_ZIP,
              Body: fileBuffer,
            })
          );
          resolve(`Successfully staged ${modifiedFiles.length} files to S3 (DoD Verified).`);
        } catch (error) {
          resolve(`Failed to upload staged changes: ${formatErrorMessage(error)}`);
        }
      });

      archive.on('error', (err: Error) => {
        resolve(`Failed to create zip: ${err.message}`);
      });

      archive.pipe(output);
      for (const file of modifiedFiles as string[]) {
        const fullPath = path.resolve(process.cwd(), file);
        archive.file(fullPath, { name: file });
      }
      archive.finalize();
    });
  },
};

/**
 * Executes an arbitrary shell command in a given directory.
 */
export const RUN_SHELL_COMMAND = {
  ...toolDefinitions.runShellCommand,
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
 * Runs the autonomous test suite using 'npm test'.
 */
export const RUN_TESTS = {
  ...toolDefinitions.runTests,
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
