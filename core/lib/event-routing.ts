import { EventType, EventRoutingTable } from './types/agent';
import { logger } from './logger';

/**
 * Event types that are handled via EventBridge subscriptions instead of
 * the events.ts Lambda fallback handler.
 * This list must match the infrastructure configuration in infra/agents.ts.
 */
export const EVENTBRIDGE_ONLY_EVENTS: EventType[] = [
  EventType.CODER_TASK,
  EventType.RESEARCH_TASK,
  EventType.EVOLUTION_PLAN,
  EventType.REFLECT_TASK,
  EventType.MERGER_TASK,
  EventType.CRITIC_TASK,
  EventType.FACILITATOR_TASK,
  EventType.QA_TASK,
  EventType.STRATEGIC_PLANNER_TASK,
  EventType.COGNITION_REFLECTOR_TASK,
];

/**
 * Verifies that event types expected to be handled by EventBridge are not
 * present in the DEFAULT_EVENT_ROUTING (to prevent silent event loss).
 * Also checks for event types defined in EventType enum but missing handlers.
 * @returns Array of event types that have issues
 */
export function verifyEventRoutingConfiguration(): EventType[] {
  const mismatches: EventType[] = [];

  // Check 1: EventBridge-only events should not be in fallback routing
  for (const eventType of EVENTBRIDGE_ONLY_EVENTS) {
    if (eventType in DEFAULT_EVENT_ROUTING) {
      logger.error(
        `[EventRouting] CRITICAL: ${eventType} found in DEFAULT_EVENT_ROUTING but should only be handled via EventBridge. This will cause duplicate processing.`
      );
      mismatches.push(eventType);
    }
  }

  // Check 2: Log warning for unhandled event types (gap detection)
  // These events are defined but have no handler - they will be silently dropped
  const allDefinedEvents = Object.keys(EventType).filter((k) => isNaN(Number(k)));
  const handledEvents = new Set([
    ...Object.keys(DEFAULT_EVENT_ROUTING),
    ...EVENTBRIDGE_ONLY_EVENTS,
  ]);

  for (const eventType of allDefinedEvents) {
    if (!handledEvents.has(eventType)) {
      logger.warn(
        `[EventRouting] GAP: ${eventType} has no handler in DEFAULT_EVENT_ROUTING or EVENTBRIDGE_ONLY_EVENTS. Events will be silently dropped.`
      );
    }
  }

  if (mismatches.length > 0) {
    logger.error(
      `[EventRouting] Event routing mismatch detected. ${mismatches.length} event types have incorrect routing. Events may be silently lost or duplicated.`
    );
  } else {
    logger.info(
      '[EventRouting] Configuration verified - EventBridge-only events correctly excluded from fallback routing.'
    );
  }

  return mismatches;
}

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
  [EventType.DASHBOARD_FAILURE_DETECTED]: {
    module: './events/dashboard-failure-handler',
    function: 'handleDashboardFailure',
  },
  [EventType.DLQ_ROUTE]: {
    module: './events/dlq-handler',
    function: 'handleDlqRoute',
  },
} as const;
