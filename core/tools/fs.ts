import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Resource } from 'sst';
import { toolDefinitions } from './definitions';
import { logger } from '../lib/logger';
import { STORAGE } from '../lib/constants';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import archiver from 'archiver';
import { formatErrorMessage } from '../lib/utils/error';

const execAsync = promisify(exec);
const s3 = new S3Client({});

interface ToolsResource {
  StagingBucket: { name: string };
  Deployer: { name: string };
}

/**
 * Stages modified files to S3 for a new deployment.
 */
export const stageChanges = {
  ...toolDefinitions.stageChanges,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { modifiedFiles } = args as { modifiedFiles: string[] };
    if (!modifiedFiles || modifiedFiles.length === 0) {
      return 'No files to stage.';
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
          resolve(`Successfully staged ${modifiedFiles.length} files to S3.`);
        } catch (error) {
          resolve(
            `Failed to upload staged changes: ${formatErrorMessage(error)}`
          );
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
export const runShellCommand = {
  ...toolDefinitions.runShellCommand,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { command, dir_path } = args as { command: string; dir_path?: string };
    try {
      logger.info(`Executing shell command: ${command} in ${dir_path || 'root'}`);
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
export const runTests = {
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
