import { EventType } from '../lib/types';

interface AgentContext {
  memoryTable: sst.aws.Dynamo;
  traceTable: sst.aws.Dynamo;
  configTable: sst.aws.Dynamo;
  stagingBucket: sst.aws.Bucket;
  secrets: Record<string, sst.Secret>;
  bus: sst.aws.Bus;
  deployer: aws.codebuild.Project;
  api: sst.aws.ApiGatewayV2;
}

export function createAgents(ctx: AgentContext) {
  const { memoryTable, traceTable, configTable, stagingBucket, secrets, bus, deployer, api } = ctx;

  // 1. Coder Agent
  const coderAgent = new sst.aws.Function('CoderAgent', {
    handler: 'src/agents/coder.handler',
    link: [memoryTable, traceTable, configTable, stagingBucket, ...Object.values(secrets)],
    memory: '1024 MB',
    timeout: '300 seconds',
  });
  bus.subscribe(EventType.CODER_TASK, coderAgent.arn);

  // 2. Build Monitor
  const buildMonitor = new sst.aws.Function('BuildMonitor', {
    handler: 'src/agents/monitor.handler',
    link: [memoryTable, traceTable, configTable, stagingBucket, deployer, bus],
    memory: '512 MB',
    timeout: '120 seconds',
  });

  // 3. Event Handler
  const eventHandler = new sst.aws.Function('EventHandler', {
    handler: 'src/agents/events.handler',
    link: [
      memoryTable,
      traceTable,
      configTable,
      stagingBucket,
      ...Object.values(secrets),
      deployer,
      bus,
    ],
    memory: '512 MB',
    timeout: '120 seconds',
  });
  bus.subscribe(EventType.SYSTEM_BUILD_FAILED, eventHandler.arn);

  // 4. Dead Man's Switch
  const deadMansSwitch = new sst.aws.Function('DeadMansSwitch', {
    handler: 'src/agents/recovery.handler',
    link: [memoryTable, traceTable, configTable, deployer, api],
    memory: '512 MB',
    timeout: '120 seconds',
  });

  // 15-min Schedule
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

  // 5. CodeBuild Event Rule
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

  return { coderAgent, buildMonitor, eventHandler, deadMansSwitch };
}
