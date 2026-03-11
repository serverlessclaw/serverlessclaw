import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { logger } from '../lib/logger';

const codebuild = new CodeBuildClient({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async () => {
  const healthUrl = `${Resource.WebhookApi.url}/health`;
  logger.info(`Dead Man's Switch checking health at: ${healthUrl}`);

  try {
    const response = await fetch(healthUrl);
    if (response.ok) {
      logger.info('System is healthy. No action needed.');
      return;
    }
    logger.error(`System health check FAILED with status: ${response.status}`);
  } catch (error) {
    logger.error(
      `System health check FAILED with error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // If we reach here, the health check failed or timed out.
  // CRITICAL: Triggering Emergency Recovery
  logger.info("CRITICAL: Initiating Dead Man's Switch Recovery Flow...");

  try {
    logger.info('Triggering CodeBuild Deployer for emergency recovery...');
    const command = new StartBuildCommand({
      projectName: (Resource as unknown as { Deployer: { name: string } }).Deployer.name,
      // We could pass an environment variable to the build to tell it to revert first
      environmentVariablesOverride: [{ name: 'EMERGENCY_ROLLBACK', value: 'true' }],
    });

    await codebuild.send(command);

    // 2. Log recovery event for Main Agent awareness
    await db.send(
      new PutCommand({
        TableName: Resource.MemoryTable.name,
        Item: {
          userId: 'DISTILLED#RECOVERY',
          timestamp: Date.now(),
          content: "Dead Man's Switch detected unhealthy system and triggered emergency rollback.",
        },
      })
    );

    logger.info('Emergency recovery initiated successfully.');
  } catch (recoveryError) {
    logger.error("FATAL: Dead Man's Switch recovery flow failed!", recoveryError);
  }
};
