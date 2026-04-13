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
      UserInsightIndex: { hashKey: 'userId', rangeKey: 'type' },
    },
    ttl: 'expiresAt',
  });

  const traceTable = new sst.aws.Dynamo('TraceTable', {
    fields: {
      traceId: 'string',
      nodeId: 'string',
      userId: 'string',
      timestamp: 'number',
      agentId: 'string',
    },
    primaryIndex: { hashKey: 'traceId', rangeKey: 'nodeId' },
    globalIndexes: {
      UserIndex: { hashKey: 'userId', rangeKey: 'timestamp' },
      // Support efficient one-row-per-trace listing by partitioning on nodeId
      // for the reserved summary rows (nodeId = '__summary__'). Query this
      // index with nodeId='__summary__' to retrieve trace summaries ordered
      // by timestamp.
      SummaryByNode: { hashKey: 'nodeId', rangeKey: 'timestamp' },
      // AgentIdIndex: Support efficient trace counting by agentId for
      // Silo 5 consistency probing. Query this index with agentId to get
      // all trace nodes for a specific agent within a time range.
      AgentIdIndex: { hashKey: 'agentId', rangeKey: 'timestamp' },
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

  const knowledgeBucket = new sst.aws.Bucket('KnowledgeBucket', {
    transform: {
      bucket: {
        lifecycleRules: [
          {
            id: 'expire-user-uploads',
            enabled: true,
            expiration: {
              days: 90,
            },
          },
        ],
      },
    },
  });

  // Base secrets (always required)
  const secrets: Record<string, sst.Secret> = {
    TelegramBotToken: new sst.Secret('TelegramBotToken'),
    MiniMaxApiKey: new sst.Secret('MiniMaxApiKey'),
    OpenAIApiKey: new sst.Secret('OpenAIApiKey'),
    OpenRouterApiKey: new sst.Secret('OpenRouterApiKey'),
    AwsRegion: new sst.Secret('AwsRegion'),
    ActiveProvider: new sst.Secret('ActiveProvider'),
    ActiveModel: new sst.Secret('ActiveModel'),
    GitHubToken: new sst.Secret('GitHubToken'),
    GitHubWebhookSecret: new sst.Secret('GitHubWebhookSecret'),
    JiraWebhookSecret: new sst.Secret('JiraWebhookSecret'),
    DashboardPassword: new sst.Secret('DashboardPassword'),
  };

  // Conditionally add optional secrets to avoid undefined values in link arrays
  if ($app.stage === 'prod' || process.env.SST_SECRET_DiscordBotToken) {
    secrets.DiscordBotToken = new sst.Secret('DiscordBotToken');
  }

  if ($app.stage === 'prod' || process.env.SST_SECRET_SlackBotToken) {
    secrets.SlackBotToken = new sst.Secret('SlackBotToken');
  }

  return { memoryTable, traceTable, stagingBucket, knowledgeBucket, secrets, configTable };
}

const STAGING_EXPIRATION_DAYS = 30;
