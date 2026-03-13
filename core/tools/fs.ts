import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Resource } from 'sst';
import { toolDefinitions } from './definitions';
import { logger } from '../lib/logger';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const s3 = new S3Client({});

interface ToolsResource {
  StagingBucket: { name: string };
}

/**
 * Reads the content of a file from S3 storage.
 */
export const fileRead = {
  ...toolDefinitions.fileRead,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { fileName, userId } = args as { fileName: string; userId?: string };

    const typedResource = Resource as unknown as ToolsResource;
    const bucketName = typedResource.StagingBucket.name;

    // Try multiple possible paths:
    // 1. Direct path (if provided as a full S3 key or relative to chat-attachments)
    // 2. User-specific path
    const possibleKeys = [fileName, `chat-attachments/${fileName}`];

    if (userId) {
      possibleKeys.push(`users/${userId}/files/${fileName}`);
    }

    for (const key of possibleKeys) {
      try {
        const response = await s3.send(
          new GetObjectCommand({
            Bucket: bucketName,
            Key: key,
          })
        );

        const content = await response.Body?.transformToString();
        return content || 'FAILED: File is empty.';
      } catch {
        // Continue to next possible key
      }
    }

    return `FAILED: Could not find or read file ${fileName} in S3.`;
  },
};

/**
 * Stages modified files to S3 for a new deployment.
...
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
            `Failed to upload staged changes: ${error instanceof Error ? error.message : String(error)}`
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
      return `Execution FAILED:\n${error instanceof Error ? error.message : String(error)}`;
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
      return `Tests FAILED:\n${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
