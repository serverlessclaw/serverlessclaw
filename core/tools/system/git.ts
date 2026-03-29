import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { Resource } from 'sst';
import { systemSchema as schema } from './schema';
import { logger } from '../../lib/logger';
import { formatErrorMessage } from '../../lib/utils/error';

const codebuild = new CodeBuildClient({});

/**
 * Triggers a CI/CD job to sync with the origin main branch.
 */
export const triggerTrunkSync = {
  ...schema.triggerTrunkSync,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    try {
      const { commitMessage } = args as { commitMessage: string };
      const buildProject =
        (Resource as any).DeployProject?.name || (Resource as any).Deployer?.name;

      if (!buildProject) return 'FAILED: Deploy project not linked.';

      logger.info(`Triggering Trunk Sync via CodeBuild: ${commitMessage}`);

      const command = new StartBuildCommand({
        projectName: buildProject,
        environmentVariablesOverride: [
          { name: 'SYNC_ONLY', value: 'true' },
          { name: 'COMMIT_MESSAGE', value: commitMessage },
        ],
      });

      const response = await codebuild.send(command);
      return `Trunk Sync triggered successfully. Build ID: ${response.build?.id}. Reasoning: ${commitMessage}`;
    } catch (error) {
      return `Failed to trigger Trunk Sync: ${formatErrorMessage(error)}`;
    }
  },
};
