// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: 'serverlessclaw',
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      protect: ['production'].includes(input?.stage),
      home: 'aws',
    };
  },
  async run() {
    // 1. Storage & Secrets
    const memoryTable = new sst.aws.DynamoDB('MemoryTable', {
      fields: {
        userId: 'string',
        timestamp: 'number',
      },
      primaryIndex: { hashKey: 'userId', rangeKey: 'timestamp' },
    });

    const secrets = {
      TELEGRAM_BOT_TOKEN: new sst.Secret('TelegramBotToken'),
      OPENAI_API_KEY: new sst.Secret('OpenAIApiKey'),
    };

    // 2. The Deployer (CodeBuild) - This is our "Sidecar Agent" for infra changes
    const deployer = new sst.aws.CodeBuild('Deployer', {
      buildspec: 'buildspec.yml',
      environment: {
        computeType: 'BUILD_GENERAL1_SMALL',
      },
    });

    // 3. Multi-Agent Orchestration (EventBridge)
    const bus = new sst.aws.Bus('AgentBus');

    // 4. Sub-Agents
    const coderAgent = new sst.aws.Function('CoderAgent', {
      handler: 'src/coder.handler',
      link: [memoryTable, ...Object.values(secrets)],
    });

    bus.subscribe('coder.task', coderAgent.arn);

    const buildMonitor = new sst.aws.Function('BuildMonitor', {
      handler: 'src/monitor.handler',
      link: [memoryTable, deployer, bus],
    });

    const eventHandler = new sst.aws.Function('EventHandler', {
      handler: 'src/events.handler',
      link: [memoryTable, ...Object.values(secrets), deployer, bus],
    });

    bus.subscribe('system.build.failed', eventHandler.arn);

    const deadMansSwitch = new sst.aws.Function('DeadMansSwitch', {
      handler: 'src/recovery.handler',
      link: [memoryTable, deployer, api],
    });

    // Schedule to run every 15 minutes
    new aws.scheduler.Schedule('RecoverySchedule', {
      scheduleExpression: 'rate(15 minutes)',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: deadMansSwitch.arn,
        roleArn: new aws.iam.Role('RecoveryScheduleRole', {
          assumeRolePolicy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Action: 'sts:AssumeRole',
                Effect: 'Allow',
                Principal: { Service: 'scheduler.amazonaws.com' },
              },
            ],
          }),
        }).arn,
      },
    });

    new aws.lambda.Permission('RecoveryPermission', {
      action: 'lambda:InvokeFunction',
      function: deadMansSwitch.name,
      principal: 'scheduler.amazonaws.com',
    });

    // Capture CodeBuild State Change Events from the default bus
    const buildRule = new aws.cloudwatch.EventRule('BuildRule', {
      eventPattern: JSON.stringify({
        source: ['aws.codebuild'],
        'detail-type': ['CodeBuild Build State Change'],
        detail: {
          'build-status': ['FAILED'],
          'project-name': [deployer.name],
        },
      }),
    });

    new aws.cloudwatch.EventTarget('BuildTarget', {
      rule: buildRule.name,
      arn: buildMonitor.arn,
    });

    new aws.lambda.Permission('BuildPermission', {
      action: 'lambda:InvokeFunction',
      function: buildMonitor.name,
      principal: 'events.amazonaws.com',
      sourceArn: buildRule.arn,
    });

    // 5. Webhook API (Main Agent entry point)
    const api = new sst.aws.ApiGatewayV2('WebhookApi');
    api.route('POST /webhook', {
      handler: 'src/webhook.handler',
      link: [memoryTable, ...Object.values(secrets), deployer, bus],
    });

    // Health probe endpoint for post-deployment validation
    api.route('GET /health', {
      handler: 'src/health.handler',
      link: [memoryTable],
    });

    // 6. Permissions
    // SST v3 'link' handles most of this.

    return {
      apiUrl: api.url,
      deployerName: deployer.name,
      busName: bus.name,
    };
  },
});
