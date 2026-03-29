import { Resource } from 'sst';
import { infraSchema as schema } from './schema';
import { formatErrorMessage } from '../../lib/utils/error';

/**
 * Trigger an emergency rollback by reverting the last commit and redeploying.
 */
export const rollbackDeployment = {
  ...schema.triggerRollback,
  name: 'rollbackDeployment',
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { reason } = args as { reason: string };
    try {
      const { StartBuildCommand, CodeBuildClient } = await import('@aws-sdk/client-codebuild');
      const client = new CodeBuildClient({});

      const buildProject = (Resource as any).RollbackProject?.name;
      if (!buildProject) return 'FAILED: RollbackProject not linked.';

      const build = await client.send(
        new StartBuildCommand({
          projectName: buildProject,
          environmentVariablesOverride: [{ name: 'ROLLBACK_REASON', value: reason }],
        })
      );

      return `SUCCESS: Rollback triggered. Build ID: ${build.build?.id}. Reasoning: ${reason}`;
    } catch (error) {
      return `FAILED_TO_ROLLBACK: ${formatErrorMessage(error)}`;
    }
  },
};
