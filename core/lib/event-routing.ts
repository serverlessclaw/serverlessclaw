import { EventType, EventRoutingTable } from './types/agent';

/**
 * Hardcoded fallback for event routing if DynamoDB is unavailable or key is missing.
 *
 * NOTE: Agent task events (CODER_TASK, RESEARCH_TASK, EVOLUTION_PLAN, REFLECT_TASK,
 * MERGER_TASK, CRITIC_TASK, facilitator_task, qa_task) are intentionally excluded here.
 * These events are routed directly to their respective multiplexer Lambdas via
 * EventBridge subscriptions (infra/agents.ts), not through the events.ts Lambda.
 * Including them here would create a confusing fallback path with no handler.
 */
export const DEFAULT_EVENT_ROUTING: EventRoutingTable = {
  [EventType.SYSTEM_BUILD_FAILED]: {
    module: './events/build-handler',
    function: 'handleBuildFailure',
    passContext: true,
  },
  [EventType.SYSTEM_BUILD_SUCCESS]: {
    module: './events/build-handler',
    function: 'handleBuildSuccess',
  },
  [EventType.CONTINUATION_TASK]: {
    module: './events/continuation-handler',
    function: 'handleContinuationTask',
    passContext: true,
  },
  [EventType.SYSTEM_HEALTH_REPORT]: {
    module: './events/health-handler',
    function: 'handleHealthReport',
    passContext: true,
  },
  [EventType.TASK_COMPLETED]: {
    module: './events/task-result-handler',
    function: 'handleTaskResult',
  },
  [EventType.TASK_FAILED]: {
    module: './events/task-result-handler',
    function: 'handleTaskResult',
  },
  [EventType.CLARIFICATION_REQUEST]: {
    module: './events/clarification-handler',
    function: 'handleClarificationRequest',
  },
  [EventType.CLARIFICATION_TIMEOUT]: {
    module: './events/clarification-timeout-handler',
    function: 'handleClarificationTimeout',
  },
  [EventType.PARALLEL_TASK_DISPATCH]: {
    module: './events/parallel-handler',
    function: 'handleParallelDispatch',
  },
  [EventType.PARALLEL_BARRIER_TIMEOUT]: {
    module: './events/parallel-barrier-timeout-handler',
    function: 'handleParallelBarrierTimeout',
  },
  [EventType.PARALLEL_TASK_COMPLETED]: {
    module: './events/parallel-task-completed-handler',
    function: 'handleParallelTaskCompleted',
  },
  [EventType.DAG_TASK_COMPLETED]: {
    module: './events/dag-supervisor-handler',
    function: 'handleDagStep',
  },
  [EventType.DAG_TASK_FAILED]: {
    module: './events/dag-supervisor-handler',
    function: 'handleDagStep',
  },
  [EventType.TASK_CANCELLED]: {
    module: './events/cancellation-handler',
    function: 'handleTaskCancellation',
  },
  [EventType.HEARTBEAT_PROACTIVE]: {
    module: './events/proactive-handler',
    function: 'handleProactiveHeartbeat',
    passContext: true,
  },
  [EventType.ESCALATION_LEVEL_TIMEOUT]: {
    module: './events/escalation-handler',
    function: 'handleEscalationLevelTimeout',
  },
  [EventType.CONSENSUS_REQUEST]: {
    module: './events/consensus-handler',
    function: 'handleConsensus',
  },
  [EventType.CONSENSUS_VOTE]: {
    module: './events/consensus-handler',
    function: 'handleConsensus',
  },
  [EventType.COGNITIVE_HEALTH_CHECK]: {
    module: './events/cognitive-health-handler',
    function: 'handleCognitiveHealthCheck',
  },
  [EventType.STRATEGIC_TIE_BREAK]: {
    module: './events/strategic-tie-break-handler',
    function: 'handleStrategicTieBreak',
  },
  [EventType.REPORT_BACK]: {
    module: './events/report-back-handler',
    function: 'handleReportBack',
  },
  [EventType.SYSTEM_AUDIT_TRIGGER]: {
    module: './events/audit-handler',
    function: 'handleSystemAuditTrigger',
  },
};
