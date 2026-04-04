/**
 * Creates and configures the storage resources for the application.
 *
 * @returns An object containing the created DynamoDB tables, S3 buckets, and secrets.
 */
import { DYNAMO_KEYS } from '../core/lib/constants';

export function createStorage() {
  const { FIELDS } = DYNAMO_KEYS;

  const memoryTable = new sst.aws.Dynamo('MemoryTable', {
    fields: {
      [FIELDS.USER_ID]: FIELDS.STRING,
      [FIELDS.TIMESTAMP]: FIELDS.NUMBER,
      [FIELDS.TYPE]: FIELDS.STRING,
    },
    primaryIndex: { hashKey: FIELDS.USER_ID, rangeKey: FIELDS.TIMESTAMP },
    globalIndexes: {
      TypeTimestampIndex: { hashKey: FIELDS.TYPE, rangeKey: FIELDS.TIMESTAMP },
      UserInsightIndex: { hashKey: FIELDS.USER_ID, rangeKey: FIELDS.TYPE },
    },
    ttl: 'expiresAt',
  });

  const traceTable = new sst.aws.Dynamo('TraceTable', {
    fields: {
      [FIELDS.TRACE_ID]: FIELDS.STRING,
      [FIELDS.NODE_ID]: FIELDS.STRING,
      [FIELDS.USER_ID]: FIELDS.STRING,
      [FIELDS.TIMESTAMP]: FIELDS.NUMBER,
    },
    primaryIndex: { hashKey: FIELDS.TRACE_ID, rangeKey: FIELDS.NODE_ID },
    globalIndexes: {
      UserIndex: { hashKey: FIELDS.USER_ID, rangeKey: FIELDS.TIMESTAMP },
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
      [FIELDS.KEY]: FIELDS.STRING,
    },
    primaryIndex: { hashKey: FIELDS.KEY },
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
