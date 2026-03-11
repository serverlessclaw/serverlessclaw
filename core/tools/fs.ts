import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Resource } from 'sst';
import { toolDefinitions } from './definitions';
import { logger } from '../lib/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { STORAGE, PROTECTED_FILES } from '../lib/constants';

const execAsync = promisify(exec);
const s3 = new S3Client({});

interface ToolsResource {
  StagingBucket: { name: string };
}

/**
 * Stages modified files to S3 for a new deployment.
 */
export const stage_changes = {
  ...toolDefinitions.stage_changes,
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
 * Writes content to a file, with protection for critical system files.
 */
export const file_write = {
  ...toolDefinitions.file_write,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { filePath, content } = args as { filePath: string; content: string };

    let protectedList: string[] = [...PROTECTED_FILES];
    try {
      const { AgentRegistry } = await import('../lib/registry');
      const ddbProtected = (await AgentRegistry.getRawConfig('protected_resources')) as string[];
      if (ddbProtected && Array.isArray(ddbProtected)) {
        protectedList = ddbProtected;
      }
    } catch {
      logger.warn('Failed to fetch protected_resources from DDB, using hardcoded defaults.');
    }

    const isProtected =
      protectedList.some((f) => (filePath as string).endsWith(f)) ||
      (filePath as string).includes('infra/');

    if (isProtected) {
      return `PERMISSION_DENIED: The file '${filePath}' is labeled as [PROTECTED]. Autonomous modification is blocked. Please present the proposed changes to the user and request a 'MANUAL_APPROVAL'.`;
    }

    try {
      const fullPath = path.resolve(process.cwd(), filePath as string);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content as string, 'utf8');
      return `Successfully wrote to ${filePath}`;
    } catch (error) {
      return `Failed to write file: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Reads the content of a file from the local file system.
 */
export const file_read = {
  ...toolDefinitions.file_read,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { filePath } = args as { filePath: string };
    try {
      const fullPath = path.resolve(process.cwd(), filePath);
      const content = await fs.readFile(fullPath, 'utf8');
      return content;
    } catch (error) {
      return `Failed to read file: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Lists all files in a specific directory.
 */
export const list_files = {
  ...toolDefinitions.list_files,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { dirPath } = args as { dirPath?: string };
    try {
      const targetDir = dirPath ? path.resolve(process.cwd(), dirPath) : process.cwd();
      const files = await fs.readdir(targetDir);
      return files.join('\n');
    } catch (error) {
      return `Failed to list files: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Executes an arbitrary shell command in a given directory.
 */
export const run_shell_command = {
  ...toolDefinitions.run_shell_command,
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
export const run_tests = {
  ...toolDefinitions.run_tests,
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
