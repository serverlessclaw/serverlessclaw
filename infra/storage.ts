/**
 * Creates and configures the storage resources for the application.
 *
 * @returns An object containing the created DynamoDB tables, S3 buckets, and secrets.
 */
export function createStorage() {
  const memoryTable = new sst.aws.Dynamo('MemoryTable', {
    fields: {
      userId: 'string',
      timestamp: 'number',
      type: 'string',
    },
    primaryIndex: { hashKey: 'userId', rangeKey: 'timestamp' },
    globalIndexes: {
      TypeTimestampIndex: { hashKey: 'type', rangeKey: 'timestamp' },
    },
    ttl: 'expiresAt',
  });

  const traceTable = new sst.aws.Dynamo('TraceTable', {
    fields: {
      traceId: 'string',
      nodeId: 'string',
      userId: 'string',
      timestamp: 'number',
    },
    primaryIndex: { hashKey: 'traceId', rangeKey: 'nodeId' },
    globalIndexes: {
      UserIndex: { hashKey: 'userId', rangeKey: 'timestamp' },
    },
    ttl: 'expiresAt',
  });

  const stagingBucket = new sst.aws.Bucket('StagingBucket', {
    transform: {
      bucket: {
        lifecycleRules: [
          {
            id: 'expire-rubbish',
            enabled: true,
            expiration: {
              days: STAGING_EXPIRATION_DAYS,
            },
          },
        ],
      },
    },
  });

  const configTable = new sst.aws.Dynamo('ConfigTable', {
    fields: {
      key: 'string',
    },
    primaryIndex: { hashKey: 'key' },
  });

  const knowledgeBucket = new sst.aws.Bucket('KnowledgeBucket');

  const secrets = {
    TelegramBotToken: new sst.Secret('TelegramBotToken'),
    OpenAIApiKey: new sst.Secret('OpenAIApiKey'),
    OpenRouterApiKey: new sst.Secret('OpenRouterApiKey'),
    AwsRegion: new sst.Secret('AwsRegion'),
    ActiveProvider: new sst.Secret('ActiveProvider'),
    ActiveModel: new sst.Secret('ActiveModel'),
    GitHubToken: new sst.Secret('GitHubToken'),
    DashboardPassword: new sst.Secret('DashboardPassword'),
  };

  return { memoryTable, traceTable, stagingBucket, knowledgeBucket, secrets, configTable };
}

const STAGING_EXPIRATION_DAYS = 30;
