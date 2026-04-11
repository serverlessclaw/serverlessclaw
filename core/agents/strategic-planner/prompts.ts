import { GapStatus, InsightCategory } from '../../lib/types/index';
import type { IMemory } from '../../lib/types/index';
import { MEMORY_KEYS, TIME } from '../../lib/constants';
import { parseConfigInt } from '../../lib/providers/utils';
import { CONFIG_DEFAULTS } from '../../lib/config/config-defaults';
import type { PlannerPayload } from './types';

/**
 * Builds telemetry information about available agents and tools.
 *
 * @param toolsList - A formatted string list of available tools.
 * @returns A string containing the system telemetry.
 */
export function buildTelemetry(toolsList: string): string {
  return `
    [SYSTEM_TELEMETRY]:
    - ACTIVE_AGENTS: main, coder, strategic-planner, cognition-reflector, qa
    - AVAILABLE_TOOLS:
    ${toolsList}
  `;
}

/**
 * Checks if proactive review should run based on frequency and minimum gaps.
 *
 * @param memory - The DynamoDB memory instance.
 * @param isScheduledReview - Whether this is a system-triggered scheduled review.
 * @param baseUserId - The sanitized user ID.
 * @param frequencyHrs - The review frequency in hours.
 * @param minGaps - The minimum number of gaps required to trigger a review.
 * @returns A promise resolving to an object indicating if it should run and why.
 */
export async function shouldRunProactiveReview(
  memory: IMemory,
  isScheduledReview: boolean,
  baseUserId: string,
  frequencyHrs: number,
  minGaps: number
): Promise<{ shouldRun: boolean; reason?: string }> {
  try {
    const lastReviewStr = await memory.getDistilledMemory(
      `${MEMORY_KEYS.STRATEGIC_REVIEW}#${baseUserId}`
    );
    const lastReview = parseConfigInt(lastReviewStr, 0);
    const now = Date.now();

    // Only enforce strict interval for fully automated crons, proactive can be more flexible
    if (
      !isScheduledReview &&
      now - lastReview < (frequencyHrs / 2) * TIME.SECONDS_IN_HOUR * TIME.MS_PER_SECOND
    ) {
      return {
        shouldRun: false,
        reason: `SKIPPED_TOO_RECENT`,
      };
    }

    // Check min gaps or optimizations
    const allGaps = await memory.getAllGaps(GapStatus.OPEN);
    const allImprovements = await memory.searchInsights(
      baseUserId,
      '*',
      InsightCategory.SYSTEM_IMPROVEMENT
    );

    if (allGaps.length < minGaps && allImprovements.items.length === 0) {
      return {
        shouldRun: false,
        reason: 'INSUFFICIENT_GAPS_OR_OPTIMIZATIONS',
      };
    }

    return { shouldRun: true };
  } catch {
    return { shouldRun: true };
  }
}

/**
 * Fetches tool usage telemetry for auditing.
 */
export async function fetchToolUsageContext(): Promise<string> {
  try {
    const { TOOLS } = await import('../../tools/index');
    const { TokenTracker } = await import('../../lib/metrics/token-usage');

    const toolNames = Object.keys(TOOLS);
    const anomalies: Array<{ toolName: string; type: string; stats: Record<string, unknown> }> = [];

    for (const toolName of toolNames) {
      const rollups = await TokenTracker.getToolRollupRange(toolName, 7);
      if (!rollups || rollups.length === 0) continue;

      let invocations = 0;
      let successes = 0;
      let totalCost = 0;

      for (const r of rollups) {
        invocations += r.invocationCount || 0;
        successes += r.successCount || 0;
        totalCost += (r.totalInputTokens || 0) + (r.totalOutputTokens || 0);
      }

      if (invocations === 0) continue;
      const successRate = successes / invocations;

      // Anomaly criteria: < 80% success rate OR very high cost (> 100k tokens in 7 days)
      if (successRate < 0.8) {
        anomalies.push({
          toolName,
          type: 'LOW_SUCCESS_RATE',
          stats: {
            invocations,
            successRate: (successRate * 100).toFixed(1) + '%',
          },
        });
      } else if (totalCost > 100000) {
        anomalies.push({
          toolName,
          type: 'HIGH_COST_OUTLIER',
          stats: {
            invocations,
            totalCostTokens: totalCost,
          },
        });
      }
    }

    if (anomalies.length > 0) {
      return `\n[ANOMALOUS_TOOL_USAGE_TELEMETRY]:\n${JSON.stringify(anomalies, null, 2)}\n`;
    }
  } catch {
    // Silently return empty
  }
  return '';
}

/**
 * Fetches low utilization memory items for auditing.
 */
export async function fetchStaleMemoryContext(memory: IMemory): Promise<string> {
  try {
    const staleItems = await memory.getLowUtilizationMemory(10);
    if (staleItems && staleItems.length > 0) {
      return `\n[LOW_UTILIZATION_MEMORY]:\nThese dynamic memory items have not been recalled recently. Consider recommending pruning them if they are no longer relevant to system goals.\n${JSON.stringify(
        staleItems.map((i: Record<string, unknown>) => ({
          id: i.userId,
          timestamp: i.timestamp,
          content: i.content,
          hitCount: (i.metadata as Record<string, unknown>)?.hitCount,
          lastAccessed: (i.metadata as Record<string, unknown>)?.lastAccessed,
        })),
        null,
        2
      )}\n`;
    }
  } catch {
    // Silently return empty
  }
  return '';
}

/**
 * Fetches previously failed plans to warn the planner about anti-patterns.
 */
async function fetchFailedPlansContext(memory: IMemory): Promise<string> {
  try {
    const failedPlans = await memory.getFailedPlans(5);
    if (failedPlans.length > 0) {
      return `\n[FAILED_PLANS_ANTI_PATTERNS]:\nThese strategic plans have previously FAILED. Do NOT repeat these approaches:\n${failedPlans
        .map((fp) => {
          try {
            const data = JSON.parse(fp.content);
            return `- [${data.gapIds?.join(', ') ?? 'unknown gaps'}] ${data.planSummary} (Reason: ${data.failureReason})`;
          } catch {
            return `- ${fp.content.substring(0, 200)}`;
          }
        })
        .join('\n')}\n`;
    }
  } catch {
    // Silently return empty
  }
  return '';
}

/**
 * Builds the proactive strategic review prompt.
 *
 * @param memory - The DynamoDB memory instance.
 * @param baseUserId - The sanitized user ID.
 * @param telemetry - System telemetry string.
 * @param isScheduledReview - Whether this is a system-triggered scheduled review.
 * @returns A promise resolving to the prompt and run status.
 */
export async function buildProactiveReviewPrompt(
  memory: IMemory,
  baseUserId: string,
  telemetry: string,
  isScheduledReview: boolean,
  failurePatterns: Array<{ content: string }> = []
): Promise<{ prompt: string; shouldRun: boolean; status?: string }> {
  // Check Frequency and Min Gaps
  try {
    const { AgentRegistry } = await import('../../lib/registry');
    const customFreq = await AgentRegistry.getRawConfig('strategic_review_frequency');
    const customMinGaps = await AgentRegistry.getRawConfig('min_gaps_for_review');

    const frequencyHrs = parseConfigInt(
      customFreq,
      CONFIG_DEFAULTS.STRATEGIC_REVIEW_FREQUENCY_HOURS.code
    );
    const minGaps = parseConfigInt(customMinGaps, CONFIG_DEFAULTS.MIN_GAPS_FOR_REVIEW.code);

    const check = await shouldRunProactiveReview(
      memory,
      isScheduledReview,
      baseUserId,
      frequencyHrs,
      minGaps
    );
    if (!check.shouldRun) {
      return { prompt: '', shouldRun: false, status: check.reason };
    }

    // Archive stale gaps older than configured days
    try {
      const customStale = await AgentRegistry.getRawConfig('stale_gap_days');
      const staleDays = parseConfigInt(customStale, CONFIG_DEFAULTS.STALE_GAP_DAYS.code);
      const archivedCount = await memory.archiveStaleGaps(staleDays);
      if (archivedCount > 0) {
        // Log but continue
      }
    } catch {
      // Continue anyway
    }
  } catch {
    // Continue anyway
  }

  // Fetch Tool Usage Telemetry
  const toolUsageContext = await fetchToolUsageContext();

  // Fetch Stale Memory Context
  const staleMemoryContext = await fetchStaleMemoryContext(memory);

  // Deterministic Review of Gaps
  const allGaps = await memory.getAllGaps(GapStatus.OPEN);
  if (allGaps.length === 0) {
    return { prompt: '', shouldRun: false, status: 'NO_GAPS' };
  }

  // Sort gaps by impact descending and take Top 3
  const sortedGaps = [...allGaps].sort(
    (a, b) => (b.metadata.impact || 0) - (a.metadata.impact || 0)
  );
  const topGaps = sortedGaps.slice(0, 3);
  const remainingCount = sortedGaps.length - topGaps.length;
  const backlogSummaryContext =
    remainingCount > 0
      ? `
    [BACKLOG_SUMMARY]:
    - There are ${remainingCount} additional open gaps in the backlog.
    - ACTION: Use 'manageGap(action: "list")' to retrieve the full backlog for comprehensive analysis if the top priority items are insufficient.
    `
      : '';

  // Fetch Improvements
  const allImprovements = await memory.searchInsights(
    baseUserId,
    '*',
    InsightCategory.SYSTEM_IMPROVEMENT
  );
  const improvementSummary = allImprovements.items
    .map((i) => `- [Impact: ${i.metadata.impact}/10] ${i.content}`)
    .join('\n');

  const failureContext =
    failurePatterns.length > 0
      ? `\n[KNOWN_FAILURE_PATTERNS]:\nAvoid repeating these mistakes:\n${failurePatterns.map((f) => `- ${f.content}`).join('\n')}\n`
      : '';

  // Fetch Failed Plans anti-patterns
  const failedPlansContext = await fetchFailedPlansContext(memory);

  const prompt = `
    [PROACTIVE_STRATEGIC_REVIEW]
    I have woken up for a scheduled self-audit. I have detected ${allGaps.length} total capability gaps.
    
    TOP_PRIORITY_GAPS (Top 3 by Impact):
    ${topGaps.map((g) => `- [Impact: ${g.metadata.impact}/10] ${g.content}`).join('\n')}
    ${backlogSummaryContext}

    [SYSTEM_IMPROVEMENTS_IDENTIFIED]:
    ${improvementSummary || 'No specific improvements logged yet.'}
    ${telemetry}
    ${toolUsageContext}
    ${staleMemoryContext}
    ${failureContext}
    ${failedPlansContext}

    Please analyze these gaps, the tool usage telemetry, and the memory utilization audit. Prioritize based on ROI (Impact vs Complexity), and design a STRATEGIC_PLAN.
    
    If low-utilization memory is no longer relevant, recommend pruning it via 'pruneMemory'.
    If tools are failing or overlapping, provide 'toolOptimizations' recommendations in your JSON output.
    
    [METABOLISM_SPECIAL_INSTRUCTIONS]:
    - Look for 'Failing Tools' in telemetry; if a tool is consistently failing, it may be dead weight.
    - Review 'Prune Proposals' in the improvement summary; these represent tools that haven't been used in a long time.
    - Aim for "Capability Density": maximize functionality while minimizing tool surface area.
  `;

  // Update last review timestamp
  await memory.updateDistilledMemory(
    `${MEMORY_KEYS.STRATEGIC_REVIEW}#${baseUserId}`,
    Date.now().toString()
  );

  return { prompt, shouldRun: true };
}

/**
 * Builds the reactive prompt for a specific task or gap.
 *
 * @param payload - The planner payload containing task/gap details.
 * @param telemetry - System telemetry string.
 * @returns The formatted prompt string.
 */
export function buildReactivePrompt(
  payload: PlannerPayload,
  telemetry: string,
  failurePatterns: Array<{ content: string }> = []
): string {
  const { details, metadata } = payload;
  const task = payload.task || details || 'Strategic Review';

  const signals = metadata
    ? `
      [EVOLUTIONARY_SIGNALS]:
      - IMPACT: ${metadata.impact}/10
      - URGENCY: ${metadata.urgency}/10
      - RISK: ${metadata.risk}/10
    `
    : '';

  const failureContext =
    failurePatterns.length > 0
      ? `
      [KNOWN_FAILURE_PATTERNS]:
      Avoid repeating these past mistakes during planning:
      ${failurePatterns.map((f) => `- ${f.content}`).join('\n')}
      `
      : '';

  const context = payload.gapId
    ? `CAPABILITY GAP IDENTIFIED: ${task}`
    : `ARCHITECTURAL TASK/INQUIRY: ${task}`;

  return `
    ${context}
    ${signals}
    ${telemetry}
    ${failureContext}

    USER CONTEXT: Please analyze the request for user ${payload.userId}.
    
    INSTRUCTIONS:
    1. If this is a capability gap (gapId present), design a STRATEGIC_PLAN as a Mission Commander. 
       - For multi-step missions, you MUST use deterministic headers: ### Goal: [AgentType] - [Mission Summary].
       - Ensure you do not repeat any KNOWN_FAILURE_PATTERNS.
    2. If this is an architectural inquiry or system question, use your tools (listAgents, inspectTopology) to provide a deep, accurate answer. You MAY use Rich Markdown (tables, diagrams) instead of the JSON format for these consultations to provide a better user experience.
    3. If you are just answering a question and no code changes are required, set 'coveredGapIds' to an empty array (if using JSON) or simply provide the markdown answer.
    4. **CRITICAL**: Speak DIRECTLY to the human user as a Senior Software Architect. Provide only the factual report or plan.
  `;
}
