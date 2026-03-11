import { EventType } from '../core/lib/types/agent';

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
  const { memoryTable, traceTable, configTable, stagingBucket, secrets, bus, deployer } = ctx;

  const validSecrets = Object.values(secrets).filter((s) => s !== undefined);
  const liveInLocalOnly = $app.stage === 'local' ? undefined : false;

  // 1. Coder Agent
  const coderAgent = new sst.aws.Function('CoderAgent', {
    handler: 'core/agents/coder.handler',
    dev: liveInLocalOnly,
    link: [memoryTable, traceTable, configTable, stagingBucket, ...validSecrets],
    memory: '1024 MB',
    timeout: '900 seconds',
  });
  bus.subscribe('CoderTaskSubscriber', coderAgent.arn, {
    pattern: { detailType: [EventType.CODER_TASK] },
  });

  // 2. Build Monitor
  const buildMonitor = new sst.aws.Function('BuildMonitor', {
    handler: 'core/handlers/monitor.handler',
    dev: liveInLocalOnly,
    link: [memoryTable, bus],
    memory: '256 MB',
    timeout: '60 seconds',
  });

  // 4. Dead Man's Switch (Recovery Agent)
  const deadMansSwitch = new sst.aws.Function('DeadMansSwitch', {
    handler: 'core/handlers/recovery.handler',
    dev: liveInLocalOnly,
    link: [memoryTable, deployer],
    memory: '256 MB',
    timeout: '60 seconds',
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

  // 5. CodeBuild Event Rule (Monitor both success and failure for gap lifecycle)
  const buildRule = new aws.cloudwatch.EventRule('BuildRule', {
    eventPattern: JSON.stringify({
      source: ['aws.codebuild'],
      'detail-type': ['CodeBuild Build State Change'],
      detail: {
        'build-status': ['FAILED', 'SUCCEEDED'],
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

  // 5. Planner Agent
  const plannerAgent = new sst.aws.Function('PlannerAgent', {
    handler: 'core/agents/planner.handler',
    dev: liveInLocalOnly,
    link: [memoryTable, traceTable, configTable, ...validSecrets, bus],
    memory: '1024 MB',
    timeout: '900 seconds',
  });
  bus.subscribe('EvolutionPlanSubscriber', plannerAgent.arn, {
    pattern: { detailType: [EventType.EVOLUTION_PLAN] },
  });

  // Strategic Review Schedule (Runs hourly to check ConfigTable frequency)
  new aws.scheduler.Schedule('StrategicReviewSchedule', {
    scheduleExpression: 'rate(1 hour)',
    flexibleTimeWindow: { mode: 'OFF' },
    target: {
      arn: plannerAgent.arn,
      input: JSON.stringify({
        isScheduledReview: true,
        userId: 'SYSTEM',
      }),
      roleArn: new aws.iam.Role('StrategicReviewRole', {
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

  new aws.lambda.Permission('StrategicReviewPermission', {
    action: 'lambda:InvokeFunction',
    function: plannerAgent.name,
    principal: 'scheduler.amazonaws.com',
  });

  // 3. Event Handler (System errors)
  const eventHandler = new sst.aws.Function('EventHandler', {
    handler: 'core/handlers/events.handler',
    dev: liveInLocalOnly,
    link: [memoryTable, traceTable, configTable, ...validSecrets, bus],
    memory: '512 MB',
    timeout: '600 seconds',
  });
  bus.subscribe('SystemBuildFailedSubscriber', eventHandler.arn, {
    pattern: { detailType: [EventType.SYSTEM_BUILD_FAILED, EventType.SYSTEM_BUILD_SUCCESS] },
  });

  // 6. Reflector Agent
  const reflectorAgent = new sst.aws.Function('ReflectorAgent', {
    handler: 'core/agents/reflector.handler',
    dev: liveInLocalOnly,
    link: [memoryTable, traceTable, configTable, ...validSecrets, bus],
    memory: '512 MB',
    timeout: '900 seconds',
  });
  bus.subscribe('ReflectTaskSubscriber', reflectorAgent.arn, {
    pattern: { detailType: [EventType.REFLECT_TASK] },
  });

  // 7. Notifier
  const notifier = new sst.aws.Function('Notifier', {
    handler: 'core/handlers/notifier.handler',
    dev: liveInLocalOnly,
    link: [configTable, secrets.TelegramBotToken],
    memory: '256 MB',
    timeout: '30 seconds',
  });
  bus.subscribe('OutboundMessageSubscriber', notifier.arn, {
    pattern: { detailType: [EventType.OUTBOUND_MESSAGE] },
  });

  // 8. Generic Worker Agent (Handles dynamic user-defined agents)
  const workerAgent = new sst.aws.Function('WorkerAgent', {
    handler: 'core/agents/worker.handler',
    dev: liveInLocalOnly,
    link: [memoryTable, traceTable, configTable, ...validSecrets, bus],
    memory: '1024 MB',
    timeout: '900 seconds',
  });
  // Subscribe to all agent tasks that don't have a specific handler
  bus.subscribe('WorkerAgentSubscriber', workerAgent.arn, {
    pattern: {
      detailType: [
        {
          'anything-but': [
            EventType.CODER_TASK,
            EventType.REFLECT_TASK,
            EventType.EVOLUTION_PLAN,
            EventType.SYSTEM_BUILD_FAILED,
          ],
        },
      ],
    },
  });

  return {
    coderAgent,
    buildMonitor,
    eventHandler,
    deadMansSwitch,
    plannerAgent,
    reflectorAgent,
    notifier,
    workerAgent,
  };
}
