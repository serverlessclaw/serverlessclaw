import { EventType } from '../core/lib/types/agent';
import {
  SharedContext,
  getValidSecrets,
  AGENT_CONFIG,
  LAMBDA_ARCHITECTURE,
  NODEJS_LOADERS,
  LOG_RETENTION_PERIOD,
} from './shared';
import { MCPServerResources } from './mcp-servers';

const RECOVERY_SCHEDULE_RATE = 'rate(15 minutes)';
const CONCURRENCY_MONITOR_RATE = 'rate(1 hour)';

/**
 * Create an IAM role for EventBridge Scheduler to invoke a Lambda function.
 * Eliminates the repeated scheduler role pattern across agents.
 */
function createSchedulerRole(name: string, targetArn: $util.Input<string>): aws.iam.Role {
  const role = new aws.iam.Role(`${name}SchedulerRole`, {
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

  new aws.iam.RolePolicy(`${name}SchedulerPolicy`, {
    role: role.name,
    policy: $util.jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'lambda:InvokeFunction',
          Effect: 'Allow',
          Resource: [targetArn],
        },
      ],
    }),
  });

  return role;
}

/**
 * Create an EventBridge Scheduler schedule that invokes a Lambda function.
 * Combines schedule, role, and permission creation into one call.
 */
function createScheduledInvocation(
  name: string,
  rate: string,
  targetFn: sst.aws.Function,
  description?: string
): void {
  new aws.scheduler.Schedule(`${name}Schedule`, {
    name: `${$app.name}-${$app.stage}-${name}`,
    ...(description ? { description } : {}),
    scheduleExpression: rate,
    state: 'DISABLED',
    flexibleTimeWindow: { mode: 'OFF' },
    target: {
      arn: targetFn.arn,
      roleArn: createSchedulerRole(name, targetFn.arn).arn,
    },
  });

  new aws.lambda.Permission(`${name}Permission`, {
    action: 'lambda:InvokeFunction',
    function: targetFn.name,
    principal: 'scheduler.amazonaws.com',
  });
}

/**
 * Deploys the full set of autonomous agents as Lambda functions and sets up their event subscriptions.
 *
 * @param ctx - The shared context containing system resources.
 * @param mcpServers - Optional MCP server resources to link.
 * @returns A record of the created agent function resources.
 */
export function createAgents(
  ctx: SharedContext,
  mcpServers?: MCPServerResources
): {
  coderAgent: sst.aws.Function;
  buildMonitor: sst.aws.Function;
  eventHandler: sst.aws.Function;
  deadMansSwitch: sst.aws.Function;
  plannerAgent: sst.aws.Function;
  reflectorAgent: sst.aws.Function;
  criticAgent: sst.aws.Function;
  notifier: sst.aws.Function;
  agentRunner: sst.aws.Function;
  bridge: sst.aws.Function;
  heartbeatHandler: sst.aws.Function;
  concurrencyMonitor: sst.aws.Function;
  mergerAgent: sst.aws.Function;
  qaAgent: sst.aws.Function;
  researcherAgent: sst.aws.Function;
  schedulerRole: aws.iam.Role;
  dlqHandler?: sst.aws.Function;
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
    dlq,
  } = ctx;

  const validSecrets = getValidSecrets(secrets);
  const liveInLocalOnly = $app.stage === 'local' ? undefined : false;

  /**
   * BASE RESOURCE POLICY:
   * All autonomous agents require access to the Bus, Memory, and Tracing for baseline coordination.
   * New agents should inherit this baseLink array.
   */
  const baseLink = [
    bus,
    memoryTable,
    traceTable,
    configTable,
    knowledgeBucket,
    ...validSecrets,
    ...(ctx.realtime ? [ctx.realtime] : []),
  ];

  const basePermissions = [
    {
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    },
    ...(mcpServers
      ? [
          {
            actions: ['lambda:InvokeFunction'],
            resources: [mcpServers.multiplexer.arn],
          },
        ]
      : []),
  ];

  // --- Start of WARMUP & SCHEDULER INFRA ---

  // 4.5 Proactive Heartbeat Handler (Target for Dynamic Scheduler)
  const heartbeatHandler = new sst.aws.Function('HeartbeatHandler', {
    handler: 'core/handlers/heartbeat.handler',
    dev: liveInLocalOnly,
    link: baseLink,
    permissions: basePermissions,
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
    memory: AGENT_CONFIG.memory.SMALL,
    timeout: AGENT_CONFIG.timeout.SHORT,
    logging: {
      retention: LOG_RETENTION_PERIOD,
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

  // --- End of WARMUP & SCHEDULER INFRA ---

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
      resources: ['*'],
    },
    {
      actions: ['iam:PassRole'],
      resources: [schedulerRole.arn],
    },
  ];

  const agentEnv = {
    SCHEDULER_ROLE_ARN: schedulerRole.arn,
    HEARTBEAT_HANDLER_ARN: heartbeatHandler.arn,
    ...(mcpServers
      ? {
          MCP_SERVER_ARNS: $util.jsonStringify(
            Object.fromEntries(
              [
                'git',
                'filesystem',
                'google-search',
                'puppeteer',
                'fetch',
                'aws',
                'aws-s3',
                'ast',
              ].map((name) => [name, mcpServers.multiplexer.arn])
            )
          ),
        }
      : {}),
  };

  // --- AGENT MULTIPLEXER (3-TIER CONSOLIDATION) ---

  // 1. High-Power Multiplexer (Coder, Researcher, Strategic Planner)
  const highPowerMultiplexer = new sst.aws.Function('HighPowerMultiplexer', {
    handler: 'core/handlers/agent-multiplexer.handler',
    dev: liveInLocalOnly,
    link: [...baseLink, stagingBucket],
    permissions: [...basePermissions, ...schedulerPermissions],
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
    environment: { ...agentEnv, MULTIPLEXER_TIER: 'high' },
    memory: AGENT_CONFIG.memory.LARGE,
    timeout: AGENT_CONFIG.timeout.MAX,
    logging: { retention: LOG_RETENTION_PERIOD },
  });

  bus.subscribe('HighPowerSubscriber', highPowerMultiplexer.arn, {
    pattern: {
      detailType: [
        EventType.CODER_TASK,
        EventType.RESEARCH_TASK,
        EventType.EVOLUTION_PLAN,
        EventType.STRATEGIC_PLANNER_TASK,
      ],
    },
    transform: { target: { deadLetterConfig: dlq ? { arn: dlq.arn } : undefined } },
  });

  // 2. Standard Multiplexer (QA, Facilitator)
  const standardMultiplexer = new sst.aws.Function('StandardMultiplexer', {
    handler: 'core/handlers/agent-multiplexer.handler',
    dev: liveInLocalOnly,
    link: baseLink,
    permissions: [...basePermissions, ...schedulerPermissions],
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
    environment: { ...agentEnv, MULTIPLEXER_TIER: 'standard' },
    memory: AGENT_CONFIG.memory.MEDIUM_LARGE,
    timeout: AGENT_CONFIG.timeout.MAX,
    logging: { retention: LOG_RETENTION_PERIOD },
  });

  bus.subscribe('StandardSubscriber', standardMultiplexer.arn, {
    pattern: {
      detailType: [
        EventType.CODER_TASK_COMPLETED, // QA trigger
        EventType.SYSTEM_BUILD_SUCCESS, // QA trigger
        EventType.QA_TASK,
        EventType.FACILITATOR_TASK,
      ],
    },
    transform: { target: { deadLetterConfig: dlq ? { arn: dlq.arn } : undefined } },
  });

  // 3. Light Multiplexer (Critic, Reflector, Merger)
  const lightMultiplexer = new sst.aws.Function('LightMultiplexer', {
    handler: 'core/handlers/agent-multiplexer.handler',
    dev: liveInLocalOnly,
    link: [...baseLink, stagingBucket], // Merger needs staging
    permissions: [...basePermissions, ...schedulerPermissions],
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
    environment: { ...agentEnv, MULTIPLEXER_TIER: 'light' },
    memory: AGENT_CONFIG.memory.MEDIUM,
    timeout: AGENT_CONFIG.timeout.LONG,
    logging: { retention: LOG_RETENTION_PERIOD },
  });

  bus.subscribe('LightSubscriber', lightMultiplexer.arn, {
    pattern: {
      detailType: [
        EventType.REFLECT_TASK,
        EventType.CRITIC_TASK,
        EventType.MERGER_TASK,
        EventType.COGNITION_REFLECTOR_TASK,
      ],
    },
    transform: { target: { deadLetterConfig: dlq ? { arn: dlq.arn } : undefined } },
  });

  // Exported references (aliased to multiplexers for backward compatibility in the return object)
  const coderAgent = highPowerMultiplexer;
  const researcherAgent = highPowerMultiplexer;
  const plannerAgent = highPowerMultiplexer;
  const qaAgent = standardMultiplexer;
  const criticAgent = lightMultiplexer;
  const reflectorAgent = lightMultiplexer;
  const mergerAgent = lightMultiplexer;

  // 2. Build Monitor
  const buildMonitor = new sst.aws.Function('BuildMonitor', {
    handler: 'core/handlers/monitor.handler',
    dev: liveInLocalOnly,
    link: [...baseLink, stagingBucket, deployer, ...(ctx.multiplexer ? [ctx.multiplexer] : [])],
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
    permissions: [
      ...basePermissions,
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
      retention: LOG_RETENTION_PERIOD,
    },
  });

  // 4. Dead Man's Switch
  const deadMansSwitch = new sst.aws.Function('DeadMansSwitch', {
    handler: 'core/handlers/recovery.handler',
    dev: liveInLocalOnly,
    link: [...baseLink, deployer, ctx.api],
    permissions: [
      ...basePermissions,
      {
        actions: ['codebuild:StartBuild'],
        resources: [deployer.arn],
      },
    ],
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
    memory: AGENT_CONFIG.memory.SMALL,
    timeout: AGENT_CONFIG.timeout.MEDIUM,
    logging: {
      retention: LOG_RETENTION_PERIOD,
    },
  });

  // 15-min Schedule (Dead Man's Switch)
  new aws.scheduler.Schedule('RecoverySchedule', {
    name: `${$app.name}-${$app.stage}-Recovery`,
    description: "Dead man's switch — deep health checks and emergency rollback",
    scheduleExpression: RECOVERY_SCHEDULE_RATE,
    state: 'ENABLED',
    flexibleTimeWindow: { mode: 'OFF' },
    target: {
      arn: deadMansSwitch.arn,
      roleArn: createSchedulerRole('Recovery', deadMansSwitch.arn).arn,
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
        'build-status': ['FAILED', 'SUCCEEDED', 'STOPPED', 'TIMED_OUT', 'FAULT'],
        'project-name': [deployer.name],
      },
    }),
  });

  new aws.cloudwatch.EventTarget('BuildTarget', {
    rule: buildRule.name,
    arn: buildMonitor.arn,
    deadLetterConfig: dlq ? { arn: dlq.arn } : undefined,
  });

  new aws.lambda.Permission('BuildPermission', {
    action: 'lambda:InvokeFunction',
    function: buildMonitor.name,
    principal: 'events.amazonaws.com',
    sourceArn: buildRule.arn,
  });

  // Subscriptions for consolidated agents are handled by AgentMultiplexer above

  // 3. Event Handler (System errors)
  const eventHandler = new sst.aws.Function('EventHandler', {
    handler: 'core/handlers/events.handler',
    dev: liveInLocalOnly,
    link: baseLink,
    permissions: basePermissions,
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
    memory: AGENT_CONFIG.memory.MEDIUM,
    timeout: AGENT_CONFIG.timeout.MEDIUM,
    logging: {
      retention: LOG_RETENTION_PERIOD,
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
        EventType.PARALLEL_TASK_COMPLETED,
        EventType.PARALLEL_BARRIER_TIMEOUT,
        EventType.CLARIFICATION_REQUEST,
        EventType.CLARIFICATION_TIMEOUT,
      ],
    },
    transform: {
      target: {
        deadLetterConfig: dlq ? { arn: dlq.arn } : undefined,
      },
    },
  });

  // Reflector Subscriptions handled by Multiplexer

  // QA Subscriptions handled by Multiplexer

  // Critic Subscriptions handled by Multiplexer

  // 8. Notifier
  const notifier = new sst.aws.Function('Notifier', {
    handler: 'core/handlers/notifier.handler',
    dev: liveInLocalOnly,
    link: baseLink,
    permissions: basePermissions,
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
    memory: AGENT_CONFIG.memory.SMALL,
    timeout: AGENT_CONFIG.timeout.SHORT,
    logging: {
      retention: LOG_RETENTION_PERIOD,
    },
  });
  bus.subscribe('OutboundMessageSubscriber', notifier.arn, {
    pattern: { detailType: [EventType.OUTBOUND_MESSAGE] },
    transform: {
      target: {
        deadLetterConfig: dlq ? { arn: dlq.arn } : undefined,
      },
    },
  });

  // 8. Generic Agent Runner (Handles dynamic user-defined agents)
  const agentRunner = new sst.aws.Function('AgentRunner', {
    handler: 'core/handlers/agent-runner.handler',
    dev: liveInLocalOnly,
    link: baseLink,
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
    permissions: [...basePermissions, ...schedulerPermissions],
    environment: agentEnv,
    memory: AGENT_CONFIG.memory.LARGE,
    timeout: AGENT_CONFIG.timeout.MAX,
    logging: {
      retention: LOG_RETENTION_PERIOD,
    },
  });
  // Subscribe to dynamic agent tasks (positive match instead of massive exclusion list)
  bus.subscribe('AgentRunnerSubscriber', agentRunner.arn, {
    pattern: {
      detailType: [{ prefix: 'dynamic_' }],
    },
    transform: {
      target: {
        deadLetterConfig: dlq ? { arn: dlq.arn } : undefined,
      },
    },
  });

  // 9. Realtime Bridge (EventBridge -> IoT Core)
  const bridge = new sst.aws.Function('RealtimeBridge', {
    handler: 'core/handlers/bridge.handler',
    dev: liveInLocalOnly,
    link: [ctx.realtime!, bus],
    permissions: basePermissions,
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
    memory: '128 MB',
    timeout: AGENT_CONFIG.timeout.SHORT,
    logging: {
      retention: LOG_RETENTION_PERIOD,
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
        EventType.RECOVERY_LOG,
        EventType.SYSTEM_HEALTH_REPORT,
      ],
    },
    transform: {
      target: {
        deadLetterConfig: dlq ? { arn: dlq.arn } : undefined,
      },
    },
  });

  // 10. Concurrency Monitor (System health)
  const concurrencyMonitor = new sst.aws.Function('ConcurrencyMonitor', {
    handler: 'core/handlers/concurrency-monitor.handler',
    dev: liveInLocalOnly,
    link: [memoryTable, bus],
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
    permissions: [...basePermissions, { actions: ['lambda:GetAccountSettings'], resources: ['*'] }],
    memory: AGENT_CONFIG.memory.SMALL,
    timeout: AGENT_CONFIG.timeout.SHORT,
    logging: {
      retention: LOG_RETENTION_PERIOD,
    },
  });

  // 1-hour Schedule (Concurrency Monitor)
  createScheduledInvocation(
    'Concurrency',
    CONCURRENCY_MONITOR_RATE,
    concurrencyMonitor,
    'Monitors Lambda concurrent execution usage — alerts at 80% utilization'
  );

  // Merger Subscriptions handled by Multiplexer

  // B3: DLQ Handler for failed EventBridge events
  let dlqHandler: sst.aws.Function | undefined;
  if (dlq) {
    dlqHandler = new sst.aws.Function('DLQHandler', {
      handler: 'core/handlers/dlq-handler.handler',
      dev: liveInLocalOnly,
      link: [...baseLink, dlq],
      architecture: LAMBDA_ARCHITECTURE,
      nodejs: { loader: NODEJS_LOADERS },
      permissions: basePermissions,
      memory: AGENT_CONFIG.memory.SMALL,
      timeout: AGENT_CONFIG.timeout.MEDIUM,
      logging: {
        retention: LOG_RETENTION_PERIOD,
      },
    });

    // Subscribe DLQ handler to process failed events
    dlq.subscribe(dlqHandler.arn);
  }

  // Researcher Subscriptions handled by Multiplexer

  return {
    coderAgent,
    buildMonitor,
    eventHandler,
    deadMansSwitch,
    plannerAgent,
    reflectorAgent,
    criticAgent,
    notifier,
    agentRunner,
    bridge,
    heartbeatHandler,
    concurrencyMonitor,
    mergerAgent,
    qaAgent,
    researcherAgent,
    schedulerRole,
    dlqHandler,
  };
}
