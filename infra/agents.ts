import { EventType } from '../core/lib/types/agent';
import { SharedContext, getValidSecrets, AGENT_CONFIG } from './shared';

const RECOVERY_SCHEDULE_RATE = 'rate(15 minutes)';
const STRATEGIC_REVIEW_RATE = 'rate(1 hour)';

/**
 * Deploys the full set of autonomous agents as Lambda functions and sets up their event subscriptions.
 *
 * @param ctx - The shared context containing system resources.
 * @returns A record of the created agent function resources.
 */
export function createAgents(ctx: SharedContext): {
  coderAgent: sst.aws.Function;
  buildMonitor: sst.aws.Function;
  eventHandler: sst.aws.Function;
  deadMansSwitch: sst.aws.Function;
  plannerAgent: sst.aws.Function;
  reflectorAgent: sst.aws.Function;
  notifier: sst.aws.Function;
  workerAgent: sst.aws.Function;
  bridge: sst.aws.Function;
} {
  const { memoryTable, traceTable, configTable, stagingBucket, secrets, bus, deployer } = ctx;

  const validSecrets = getValidSecrets(secrets);
  const liveInLocalOnly = $app.stage === 'local' ? undefined : false;

  // 1. Coder Agent
  const coderAgent = new sst.aws.Function('CoderAgent', {
    handler: 'core/agents/coder.handler',
    dev: liveInLocalOnly,
    link: [memoryTable, traceTable, configTable, stagingBucket, ...validSecrets],
    memory: AGENT_CONFIG.memory.LARGE,
    timeout: AGENT_CONFIG.timeout.MAX,
  });
  bus.subscribe('CoderTaskSubscriber', coderAgent.arn, {
    pattern: { detailType: [EventType.CODER_TASK] },
  });

  // 2. Build Monitor
  const buildMonitor = new sst.aws.Function('BuildMonitor', {
    handler: 'core/handlers/monitor.handler',
    dev: liveInLocalOnly,
    link: [memoryTable, configTable, bus],
    permissions: [
      {
        actions: ['codebuild:BatchGetBuilds'],
        resources: [deployer.arn],
      },
      {
        actions: ['logs:GetLogEvents'],
        resources: [
          $util.interpolate`arn:aws:logs:${aws.getRegionOutput().name}:${aws.getCallerIdentityOutput().accountId}:log-group:/aws/codebuild/${deployer.name}:*`,
        ],
      },
    ],
    memory: AGENT_CONFIG.memory.SMALL,
    timeout: AGENT_CONFIG.timeout.MEDIUM,
  });

  // 4. Dead Man's Switch
  const deadMansSwitch = new sst.aws.Function('DeadMansSwitch', {
    handler: 'core/handlers/recovery.handler',
    dev: liveInLocalOnly,
    link: [memoryTable, deployer],
    memory: AGENT_CONFIG.memory.SMALL,
    timeout: AGENT_CONFIG.timeout.MEDIUM,
  });

  // 15-min Schedule
  new aws.scheduler.Schedule('RecoverySchedule', {
    scheduleExpression: RECOVERY_SCHEDULE_RATE,
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
    handler: 'core/agents/strategic-planner.handler',
    dev: liveInLocalOnly,
    link: [memoryTable, traceTable, configTable, ...validSecrets, bus],
    memory: AGENT_CONFIG.memory.LARGE,
    timeout: AGENT_CONFIG.timeout.MAX,
  });
  bus.subscribe('EvolutionPlanSubscriber', plannerAgent.arn, {
    pattern: { detailType: [EventType.EVOLUTION_PLAN] },
  });

  // Strategic Review Schedule (Runs hourly to check ConfigTable frequency)
  new aws.scheduler.Schedule('StrategicReviewSchedule', {
    scheduleExpression: STRATEGIC_REVIEW_RATE,
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
    memory: AGENT_CONFIG.memory.MEDIUM,
    timeout: AGENT_CONFIG.timeout.LONG,
  });
  bus.subscribe('SystemBuildFailedSubscriber', eventHandler.arn, {
    pattern: { detailType: [EventType.SYSTEM_BUILD_FAILED, EventType.SYSTEM_BUILD_SUCCESS] },
  });

  // 6. Reflector Agent
  const reflectorAgent = new sst.aws.Function('ReflectorAgent', {
    handler: 'core/agents/cognition-reflector.handler',
    dev: liveInLocalOnly,
    link: [memoryTable, traceTable, configTable, ...validSecrets, bus],
    memory: AGENT_CONFIG.memory.MEDIUM,
    timeout: AGENT_CONFIG.timeout.MAX,
  });
  bus.subscribe('ReflectTaskSubscriber', reflectorAgent.arn, {
    pattern: { detailType: [EventType.REFLECT_TASK] },
  });

  // 7. QA Agent (Verifies satisfaction after deploy)
  const qaAgent = new sst.aws.Function('QaAgent', {
    handler: 'core/agents/qa.handler',
    dev: liveInLocalOnly,
    link: [memoryTable, traceTable, configTable, ...validSecrets, bus],
    memory: AGENT_CONFIG.memory.LARGE,
    timeout: AGENT_CONFIG.timeout.MAX,
  });
  bus.subscribe('QaVerificationSubscriber', qaAgent.arn, {
    pattern: {
      detailType: [EventType.SYSTEM_BUILD_SUCCESS, EventType.CODER_TASK_COMPLETED],
    },
  });

  // 8. Notifier
  const notifier = new sst.aws.Function('Notifier', {
    handler: 'core/handlers/notifier.handler',
    dev: liveInLocalOnly,
    link: [configTable, secrets.TelegramBotToken],
    memory: AGENT_CONFIG.memory.SMALL,
    timeout: AGENT_CONFIG.timeout.SHORT,
  });
  bus.subscribe('OutboundMessageSubscriber', notifier.arn, {
    pattern: { detailType: [EventType.OUTBOUND_MESSAGE] },
  });

  // 8. Generic Worker Agent (Handles dynamic user-defined agents)
  const workerAgent = new sst.aws.Function('WorkerAgent', {
    handler: 'core/agents/worker.handler',
    dev: liveInLocalOnly,
    link: [memoryTable, traceTable, configTable, ...validSecrets, bus],
    memory: AGENT_CONFIG.memory.LARGE,
    timeout: AGENT_CONFIG.timeout.MAX,
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

  // 9. Realtime Bridge (EventBridge -> IoT Core)
  const bridge = new sst.aws.Function('RealtimeBridge', {
    handler: 'core/handlers/bridge.handler',
    dev: liveInLocalOnly,
    link: [ctx.realtime!],
  });
  bus.subscribe('RealtimeBridgeSubscriber', bridge.arn, {
    pattern: {
      detailType: [
        EventType.OUTBOUND_MESSAGE,
        EventType.CODER_TASK_COMPLETED,
        EventType.SYSTEM_BUILD_SUCCESS,
        EventType.SYSTEM_BUILD_FAILED,
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
    bridge,
  };
}
