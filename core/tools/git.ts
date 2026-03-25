import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { Resource } from 'sst';
import { gitTools } from './definitions/git';
import { logger } from '../lib/logger';
import { formatErrorMessage } from '../lib/utils/error';

const codebuild = new CodeBuildClient({});

interface ToolsResource {
  Deployer: { name: string };
}

/**
 * Triggers a CodeBuild job specifically to sync the repository back to Git.
 * This is the secure "CI/CD Bridge" for the self-evolution lifecycle.
 */
export const TRIGGER_TRUNK_SYNC = {
  ...gitTools.triggerTrunkSync,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    try {
      const { commitMessage } = args as { commitMessage: string };
      const typedResource = Resource as unknown as ToolsResource;

      logger.info(`Triggering Trunk Sync via CodeBuild (SYNC_ONLY=true): ${commitMessage}`);

      const command = new StartBuildCommand({
        projectName: typedResource.Deployer.name,
        environmentVariablesOverride: [
          { name: 'SYNC_ONLY', value: 'true', type: 'PLAINTEXT' },
          { name: 'COMMIT_MESSAGE', value: commitMessage, type: 'PLAINTEXT' },
        ],
      });

      const response = await codebuild.send(command);
      return `Trunk Sync triggered successfully. Build ID: ${response.build?.id}. Changes will land in the main branch shortly.`;
    } catch (error) {
      return `Failed to trigger Trunk Sync: ${formatErrorMessage(error)}`;
    }
  },
};
