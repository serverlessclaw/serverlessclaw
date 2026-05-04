/**
 * Handler Loaders Map
 *
 * To optimize AI context budget and metabolic efficiency, we use a dynamic loader pattern.
 * This prevents the central multiplexer from transitively importing the entire handler
 * graph into its top-level context, which would exceed AI reasoning limits.
 */

export const HANDLER_LOADERS: Record<string, () => Promise<unknown>> = {
  'build-handler': () => import('./build-handler'),
  'continuation-handler': () => import('./continuation-handler'),
  'health-handler': () => import('./health-handler'),
  'task-result-handler': () => import('./task-result-handler'),
  'clarification-handler': () => import('./clarification-handler'),
  'clarification-timeout-handler': () => import('./clarification-timeout-handler'),
  'parallel-handler': () => import('./parallel-handler'),
  'parallel-barrier-timeout-handler': () => import('./parallel-barrier-timeout-handler'),
  'parallel-task-completed-handler': () => import('./parallel-task-completed-handler'),
  'dag-supervisor-handler': () => import('./dag-supervisor-handler'),
  'cancellation-handler': () => import('./cancellation-handler'),
  'proactive-handler': () => import('./proactive-handler'),
  'escalation-handler': () => import('./escalation-handler'),
  'consensus-handler': () => import('./consensus-handler'),
  'cognitive-health-handler': () => import('./cognitive-health-handler'),
  'strategic-tie-break-handler': () => import('./strategic-tie-break-handler'),
  'report-back-handler': () => import('./report-back-handler'),
  'audit-handler': () => import('./audit-handler'),
  'recovery-handler': () => import('./recovery-handler'),
  'dashboard-failure-handler': () => import('./dashboard-failure-handler'),
  'dlq-handler': () => import('./dlq-handler'),
  'reputation-handler': () => import('./reputation-handler'),
};

/**
 * @deprecated Use HANDLER_LOADERS with await instead.
 * This is kept temporarily to prevent immediate build breakages if used elsewhere.
 */
export const STATIC_HANDLERS = HANDLER_LOADERS;
