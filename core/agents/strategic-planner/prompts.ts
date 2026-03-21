import { GapStatus } from '../../lib/types/index';
import type { DynamoMemory } from '../../lib/memory';
import { MEMORY_KEYS, TIME } from '../../lib/constants';
import { parseConfigInt } from '../../lib/providers/utils';
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
  memory: DynamoMemory,
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

    // Check min gaps
    const allGaps = await memory.getAllGaps(GapStatus.OPEN);
    if (allGaps.length < minGaps) {
      return {
        shouldRun: false,
        reason: 'INSUFFICIENT_GAPS',
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
    const { AgentRegistry } = await import('../../lib/registry');
    const toolUsage = await AgentRegistry.getRawConfig('tool_usage');
    if (toolUsage) {
      return `\n[TOOL_USAGE_TELEMETRY]:\n${JSON.stringify(toolUsage, null, 2)}\n`;
    }
  } catch {
    // Silently return empty
  }
  return '';
}

/**
 * Fetches low utilization memory items for auditing.
 */
export async function fetchStaleMemoryContext(memory: DynamoMemory): Promise<string> {
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
 * Builds the proactive strategic review prompt.
 *
 * @param memory - The DynamoDB memory instance.
 * @param baseUserId - The sanitized user ID.
 * @param telemetry - System telemetry string.
 * @param isScheduledReview - Whether this is a system-triggered scheduled review.
 * @returns A promise resolving to the prompt and run status.
 */
export async function buildProactiveReviewPrompt(
  memory: DynamoMemory,
  baseUserId: string,
  telemetry: string,
  isScheduledReview: boolean
): Promise<{ prompt: string; shouldRun: boolean; status?: string }> {
  // Check Frequency and Min Gaps
  try {
    const { AgentRegistry } = await import('../../lib/registry');
    const customFreq = await AgentRegistry.getRawConfig('strategic_review_frequency');
    const customMinGaps = await AgentRegistry.getRawConfig('min_gaps_for_review');

    const frequencyHrs = parseConfigInt(customFreq, 48);
    const minGaps = parseConfigInt(customMinGaps, 5);

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

    // Archive stale gaps older than 30 days
    try {
      const archivedCount = await memory.archiveStaleGaps(30);
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

  // Deterministic Review of all Gaps
  const allGaps = await memory.getAllGaps(GapStatus.OPEN);
  if (allGaps.length === 0) {
    return { prompt: '', shouldRun: false, status: 'NO_GAPS' };
  }

  const gapSummary = allGaps
    .map(
      (g) => `- [Impact: ${g.metadata.impact}/10] ${g.content} (Priority: ${g.metadata.priority})`
    )
    .join('\n');

  const prompt = `
    [PROACTIVE_STRATEGIC_REVIEW]
    I have woken up for a scheduled self-audit. I have detected the following ${allGaps.length} capability gaps:
    ${gapSummary}
    ${telemetry}
    ${toolUsageContext}
    ${staleMemoryContext}

    Please analyze these gaps, the tool usage telemetry, and the memory utilization audit. Prioritize the most critical needs based on ROI (Impact vs Complexity), and design a STRATEGIC_PLAN to either address the MOST IMPORTANT evolution or prune redundant/inefficient tools and stale memories.
    
    If low-utilization memory is no longer relevant, recommend pruning it by suggesting the use of 'pruneMemory' tool or explaining why it should be archived.
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
export function buildReactivePrompt(payload: PlannerPayload, telemetry: string): string {
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

  const context = payload.gapId
    ? `CAPABILITY GAP IDENTIFIED: ${task}`
    : `ARCHITECTURAL TASK/INQUIRY: ${task}`;

  return `
    ${context}
    ${signals}
    ${telemetry}

    USER CONTEXT: Please analyze the request for user ${payload.userId}.
    
    INSTRUCTIONS:
    1. If this is a capability gap (gapId present), design a STRATEGIC_PLAN to fix it.
    2. If this is an architectural inquiry or system question, use your tools (listAgents, inspectTopology) to provide a deep, accurate answer.
    3. Always return your response in the specified JSON format.
    4. If you are just answering a question and no code changes are required, set 'coveredGapIds' to an empty array.
  `;
}
