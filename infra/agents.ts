import { EventType, AgentType } from '../core/lib/types/agent';
import { SharedContext, getValidSecrets, AGENT_CONFIG } from './shared';
import { MCPServerResources } from './mcp-servers';

const RECOVERY_SCHEDULE_RATE = 'rate(15 minutes)';
const CONCURRENCY_MONITOR_RATE = 'rate(1 hour)';

/** Lambda runtime architecture for all agent functions */
const LAMBDA_ARCHITECTURE = 'arm64';

/** Node.js loader configuration for markdown files */
const NODEJS_LOADERS = { '.md': 'text' } as const;

/** Default log retention period for Lambda functions */
const LOG_RETENTION_PERIOD = '1 month';

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
  notifier: sst.aws.Function;
  agentRunner: sst.aws.Function;
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
            resources: Object.values(mcpServers.servers).map((s) => s.arn),
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

  const agentEnv = {
    SCHEDULER_ROLE_ARN: schedulerRole.arn,
    HEARTBEAT_HANDLER_ARN: heartbeatHandler.arn,
    ...(mcpServers
      ? {
          MCP_SERVER_ARNS: $util.jsonStringify(
            Object.fromEntries(
              Object.entries(mcpServers.servers).map(([name, fn]) => [name, fn.arn])
            )
          ),
        }
      : {}),
  };

  // 1. Coder Agent
  const coderAgent = new sst.aws.Function('CoderAgent', {
    handler: 'core/agents/coder.handler',
    dev: liveInLocalOnly,
    link: [...baseLink, stagingBucket],
    permissions: basePermissions,
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
    environment: agentEnv,
    memory: AGENT_CONFIG.memory.LARGE,
    timeout: AGENT_CONFIG.timeout.MAX,
    logging: {
      retention: LOG_RETENTION_PERIOD,
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
    permissions: basePermissions,
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
    memory: AGENT_CONFIG.memory.SMALL,
    timeout: AGENT_CONFIG.timeout.MEDIUM,
    logging: {
      retention: LOG_RETENTION_PERIOD,
    },
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

  // 15-min Schedule (Dead Man's Switch)
  createScheduledInvocation(
    'Recovery',
    RECOVERY_SCHEDULE_RATE,
    deadMansSwitch,
    "Dead man's switch — deep health checks and emergency rollback"
  );

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
    permissions: basePermissions,
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
    memory: AGENT_CONFIG.memory.MEDIUM,
    timeout: AGENT_CONFIG.timeout.LONG,
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
  });

  // 6. Reflector Agent
  const reflectorAgent = new sst.aws.Function('ReflectorAgent', {
    handler: 'core/agents/cognition-reflector.handler',
    dev: liveInLocalOnly,
    link: baseLink,
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
    permissions: [...basePermissions, ...schedulerPermissions],
    environment: agentEnv,
    memory: AGENT_CONFIG.memory.MEDIUM,
    timeout: AGENT_CONFIG.timeout.MAX,
    logging: {
      retention: LOG_RETENTION_PERIOD,
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
  bus.subscribe('QaVerificationSubscriber', qaAgent.arn, {
    pattern: {
      detailType: [
        EventType.SYSTEM_BUILD_SUCCESS,
        EventType.CODER_TASK_COMPLETED,
        `${AgentType.QA}_task`,
      ],
    },
  });

  // 7.5 Critic Agent (Council of Agents peer review)
  const criticAgent = new sst.aws.Function('CriticAgent', {
    handler: 'core/agents/critic.handler',
    dev: liveInLocalOnly,
    link: baseLink,
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
    permissions: [...basePermissions],
    environment: agentEnv,
    memory: AGENT_CONFIG.memory.MEDIUM,
    timeout: AGENT_CONFIG.timeout.LONG,
    logging: {
      retention: LOG_RETENTION_PERIOD,
    },
  });
  bus.subscribe('CriticTaskSubscriber', criticAgent.arn, {
    pattern: {
      detailType: [EventType.CRITIC_TASK, `${AgentType.CRITIC}_task`],
    },
  });

  // 7.6 Optimizer Agent (Efficiency audit)
  const optimizerAgent = new sst.aws.Function('OptimizerAgent', {
    handler: 'core/agents/optimizer.handler',
    dev: liveInLocalOnly,
    link: baseLink,
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
    permissions: [...basePermissions, ...schedulerPermissions],
    environment: agentEnv,
    memory: AGENT_CONFIG.memory.MEDIUM,
    timeout: AGENT_CONFIG.timeout.LONG,
    logging: {
      retention: LOG_RETENTION_PERIOD,
    },
  });
  bus.subscribe('OptimizerTaskSubscriber', optimizerAgent.arn, {
    pattern: {
      detailType: [`${AgentType.OPTIMIZER}_task`],
    },
  });

  // 48-hour Schedule (Optimizer Proactive Review)
  createScheduledInvocation(
    'OptimizerProactive',
    'rate(48 hours)',
    optimizerAgent,
    'Performs periodic efficiency and cost audit of the agent swarm'
  );

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
  // Subscribe to all agent tasks that don't have a specific handler
  bus.subscribe('AgentRunnerSubscriber', agentRunner.arn, {
    pattern: {
      detailType: [
        {
          'anything-but': [
            EventType.CHUNK,
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
            EventType.CLARIFICATION_REQUEST,
            EventType.CLARIFICATION_TIMEOUT,
            EventType.PARALLEL_TASK_DISPATCH,
            EventType.PARALLEL_TASK_COMPLETED,
            `${AgentType.STRATEGIC_PLANNER}_task`,
            `${AgentType.COGNITION_REFLECTOR}_task`,
            `${AgentType.QA}_task`,
            `${AgentType.CRITIC}_task`,
            `${AgentType.OPTIMIZER}_task`,
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
    permissions: basePermissions,
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
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

  return {
    coderAgent,
    buildMonitor,
    eventHandler,
    deadMansSwitch,
    plannerAgent,
    reflectorAgent,
    criticAgent,
    optimizerAgent,
    notifier,
    agentRunner,
    bridge,
    heartbeatHandler,
    concurrencyMonitor,
    schedulerRole,
  };
}
