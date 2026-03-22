import { EventType, AgentType } from '../core/lib/types/agent';
import { SharedContext, getValidSecrets, AGENT_CONFIG } from './shared';

const RECOVERY_SCHEDULE_RATE = 'rate(15 minutes)';

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
  heartbeatHandler: sst.aws.Function;
  concurrencyMonitor: sst.aws.Function;
  schedulerRole: aws.iam.Role;
} {
  const {
    memoryTable,
    traceTable,
    configTable,
    stagingBucket,
    knowledgeBucket,
    secrets,
    bus,
    deployer,
  } = ctx;

  const validSecrets = getValidSecrets(secrets);
  const liveInLocalOnly = $app.stage === 'local' ? undefined : false;

  /**
   * BASE RESOURCE POLICY:
   * All autonomous agents require access to the Bus, Memory, and Tracing for baseline coordination.
   * New agents should inherit this baseLink array.
   */
  const baseLink = [bus, memoryTable, traceTable, configTable, knowledgeBucket, ...validSecrets];

  // 1. Coder Agent
  const coderAgent = new sst.aws.Function('CoderAgent', {
    handler: 'core/agents/coder.handler',
    dev: liveInLocalOnly,
    link: [...baseLink, stagingBucket],
    nodejs: { loader: { '.md': 'text' } },
    memory: AGENT_CONFIG.memory.LARGE,
    timeout: AGENT_CONFIG.timeout.MAX,
    logging: {
      retention: '1 month',
    },
  });
  bus.subscribe('CoderTaskSubscriber', coderAgent.arn, {
    pattern: { detailType: [EventType.CODER_TASK] },
  });

  // 2. Build Monitor
  const buildMonitor = new sst.aws.Function('BuildMonitor', {
    handler: 'core/handlers/monitor.handler',
    dev: liveInLocalOnly,
    link: baseLink,
    nodejs: { loader: { '.md': 'text' } },
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
    logging: {
      retention: '1 month',
    },
  });

  // 4. Dead Man's Switch
  const deadMansSwitch = new sst.aws.Function('DeadMansSwitch', {
    handler: 'core/handlers/recovery.handler',
    dev: liveInLocalOnly,
    link: [...baseLink, deployer],
    nodejs: { loader: { '.md': 'text' } },
    memory: AGENT_CONFIG.memory.SMALL,
    timeout: AGENT_CONFIG.timeout.MEDIUM,
    logging: {
      retention: '1 month',
    },
  });

  // 4.5 Proactive Heartbeat Handler (Target for Dynamic Scheduler)
  const heartbeatHandler = new sst.aws.Function('HeartbeatHandler', {
    handler: 'core/handlers/heartbeat.handler',
    dev: liveInLocalOnly,
    link: baseLink,
    nodejs: { loader: { '.md': 'text' } },
    memory: AGENT_CONFIG.memory.SMALL,
    timeout: AGENT_CONFIG.timeout.SHORT,
    logging: {
      retention: '1 month',
    },
  });

  // Role for AWS Scheduler to invoke HeartbeatHandler
  const schedulerRole = new aws.iam.Role('DynamicSchedulerRole', {
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
  });

  new aws.iam.RolePolicy('DynamicSchedulerPolicy', {
    role: schedulerRole.name,
    policy: $util.jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'lambda:InvokeFunction',
          Effect: 'Allow',
          Resource: [heartbeatHandler.arn],
        },
      ],
    }),
  });

  // Grant agents permission to manage schedules
  const schedulerPermissions = [
    {
      actions: [
        'scheduler:CreateSchedule',
        'scheduler:DeleteSchedule',
        'scheduler:GetSchedule',
        'scheduler:ListSchedules',
        'scheduler:UpdateSchedule',
      ],
      resources: ['*'], // Namespaced by agentId usually, but '*' for simplicity in this implementation
    },
    {
      actions: ['iam:PassRole'],
      resources: [schedulerRole.arn],
    },
  ];

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
    eventPattern: $util.jsonStringify({
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
    link: baseLink,
    nodejs: { loader: { '.md': 'text' } },
    permissions: schedulerPermissions,
    environment: {
      SCHEDULER_ROLE_ARN: schedulerRole.arn,
      HEARTBEAT_HANDLER_ARN: heartbeatHandler.arn,
    },
    memory: AGENT_CONFIG.memory.LARGE,
    timeout: AGENT_CONFIG.timeout.MAX,
    logging: {
      retention: '1 month',
    },
  });
  bus.subscribe('EvolutionPlanSubscriber', plannerAgent.arn, {
    pattern: {
      detailType: [EventType.EVOLUTION_PLAN, `${AgentType.STRATEGIC_PLANNER}_task`],
    },
  });

  // 3. Event Handler (System errors)
  const eventHandler = new sst.aws.Function('EventHandler', {
    handler: 'core/handlers/events.handler',
    dev: liveInLocalOnly,
    link: baseLink,
    nodejs: { loader: { '.md': 'text' } },
    memory: AGENT_CONFIG.memory.MEDIUM,
    timeout: AGENT_CONFIG.timeout.LONG,
    logging: {
      retention: '1 month',
    },
  });
  bus.subscribe('SystemBuildFailedSubscriber', eventHandler.arn, {
    pattern: {
      detailType: [
        EventType.SYSTEM_BUILD_FAILED,
        EventType.SYSTEM_BUILD_SUCCESS,
        EventType.TASK_COMPLETED,
        EventType.TASK_FAILED,
        EventType.SYSTEM_HEALTH_REPORT,
        EventType.HEARTBEAT_PROACTIVE,
        EventType.CONTINUATION_TASK,
        EventType.TASK_CANCELLED,
        EventType.PARALLEL_TASK_DISPATCH,
      ],
    },
  });

  // 6. Reflector Agent
  const reflectorAgent = new sst.aws.Function('ReflectorAgent', {
    handler: 'core/agents/cognition-reflector.handler',
    dev: liveInLocalOnly,
    link: baseLink,
    nodejs: { loader: { '.md': 'text' } },
    permissions: schedulerPermissions,
    environment: {
      SCHEDULER_ROLE_ARN: schedulerRole.arn,
      HEARTBEAT_HANDLER_ARN: heartbeatHandler.arn,
    },
    memory: AGENT_CONFIG.memory.MEDIUM,
    timeout: AGENT_CONFIG.timeout.MAX,
    logging: {
      retention: '1 month',
    },
  });
  bus.subscribe('ReflectTaskSubscriber', reflectorAgent.arn, {
    pattern: {
      detailType: [EventType.REFLECT_TASK, `${AgentType.COGNITION_REFLECTOR}_task`],
    },
  });

  // 7. QA Agent (Verifies satisfaction after deploy)
  const qaAgent = new sst.aws.Function('QaAgent', {
    handler: 'core/agents/qa.handler',
    dev: liveInLocalOnly,
    link: baseLink,
    nodejs: { loader: { '.md': 'text' } },
    permissions: schedulerPermissions,
    environment: {
      SCHEDULER_ROLE_ARN: schedulerRole.arn,
      HEARTBEAT_HANDLER_ARN: heartbeatHandler.arn,
    },
    memory: AGENT_CONFIG.memory.LARGE,
    timeout: AGENT_CONFIG.timeout.MAX,
    logging: {
      retention: '1 month',
    },
  });
  bus.subscribe('QaVerificationSubscriber', qaAgent.arn, {
    pattern: {
      detailType: [
        EventType.SYSTEM_BUILD_SUCCESS,
        EventType.CODER_TASK_COMPLETED,
        `${AgentType.QA}_task`,
      ],
    },
  });

  // 8. Notifier
  const notifier = new sst.aws.Function('Notifier', {
    handler: 'core/handlers/notifier.handler',
    dev: liveInLocalOnly,
    link: baseLink,
    nodejs: { loader: { '.md': 'text' } },
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
    link: baseLink,
    nodejs: { loader: { '.md': 'text' } },
    permissions: schedulerPermissions,
    environment: {
      SCHEDULER_ROLE_ARN: schedulerRole.arn,
      HEARTBEAT_HANDLER_ARN: heartbeatHandler.arn,
    },
    memory: AGENT_CONFIG.memory.LARGE,
    timeout: AGENT_CONFIG.timeout.MAX,
    logging: {
      retention: '1 month',
    },
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
            EventType.SYSTEM_BUILD_SUCCESS,
            EventType.TASK_COMPLETED,
            EventType.TASK_FAILED,
            EventType.SYSTEM_HEALTH_REPORT,
            EventType.HEARTBEAT_PROACTIVE,
            EventType.CONTINUATION_TASK,
            EventType.OUTBOUND_MESSAGE,
            `${AgentType.STRATEGIC_PLANNER}_task`,
            `${AgentType.COGNITION_REFLECTOR}_task`,
            `${AgentType.QA}_task`,
          ],
        },
      ],
    },
  });

  // 9. Realtime Bridge (EventBridge -> IoT Core)
  const bridge = new sst.aws.Function('RealtimeBridge', {
    handler: 'core/handlers/bridge.handler',
    dev: liveInLocalOnly,
    link: [ctx.realtime!, bus],
    nodejs: { loader: { '.md': 'text' } },
    logging: {
      retention: '1 month',
    },
  });
  bus.subscribe('RealtimeBridgeSubscriber', bridge.arn, {
    pattern: {
      detailType: [
        EventType.OUTBOUND_MESSAGE,
        EventType.CODER_TASK_COMPLETED,
        EventType.SYSTEM_BUILD_SUCCESS,
        EventType.SYSTEM_BUILD_FAILED,
        EventType.TASK_COMPLETED,
        EventType.TASK_FAILED,
      ],
    },
  });

  // 10. Concurrency Monitor (System health)
  const concurrencyMonitor = new sst.aws.Function('ConcurrencyMonitor', {
    handler: 'core/handlers/concurrency-monitor.handler',
    dev: liveInLocalOnly,
    link: [memoryTable, bus],
    nodejs: { loader: { '.md': 'text' } },
    permissions: [{ actions: ['lambda:GetAccountSettings'], resources: ['*'] }],
    memory: AGENT_CONFIG.memory.SMALL,
    timeout: AGENT_CONFIG.timeout.SHORT,
    logging: {
      retention: '1 month',
    },
  });

  new aws.scheduler.Schedule('ConcurrencySchedule', {
    scheduleExpression: 'rate(1 hour)',
    flexibleTimeWindow: { mode: 'OFF' },
    target: {
      arn: concurrencyMonitor.arn,
      roleArn: new aws.iam.Role('ConcurrencyScheduleRole', {
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

  new aws.lambda.Permission('ConcurrencyPermission', {
    action: 'lambda:InvokeFunction',
    function: concurrencyMonitor.name,
    principal: 'scheduler.amazonaws.com',
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
    heartbeatHandler,
    concurrencyMonitor,
    schedulerRole,
  };
}
