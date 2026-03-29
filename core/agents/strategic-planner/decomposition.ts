/**
 * Plan Decomposition Module
 *
 * Breaks complex strategic plans into hierarchical sub-tasks that can be
 * dispatched independently to the Coder Agent. This prevents Coder Agent
 * logic overload from monolithic plans that exceed context windows.
 *
 * Each sub-task:
 * - Has a unique ID linked to a parent plan
 * - Can be dispatched independently via dispatchTask
 * - Is tracked via traceId DAG for parent-child relationships
 * - Carries the gapIds it addresses
 */

import { logger } from '../../lib/logger';

/** A single decomposed sub-task from a strategic plan. */
export interface PlanSubTask {
  /** Unique sub-task identifier. */
  subTaskId: string;
  /** The parent plan ID for traceability. */
  planId: string;
  /** The specific instruction for the Coder Agent. */
  task: string;
  /** Which gap IDs this sub-task addresses. */
  gapIds: string[];
  /** Execution order (0-based). */
  order: number;
  /** Sub-tasks that must complete before this one runs (order numbers). */
  dependencies: number[];
  /** Estimated complexity 1-10. */
  complexity: number;
}

/** Result of plan decomposition. */
export interface DecomposedPlan {
  /** Original full plan text. */
  originalPlan: string;
  /** Unique plan identifier. */
  planId: string;
  /** Decomposed sub-tasks. */
  subTasks: PlanSubTask[];
  /** Total sub-task count. */
  totalSubTasks: number;
  /** Whether decomposition was applied (false = plan dispatched as-is). */
  wasDecomposed: boolean;
}

/**
 * Keywords that indicate separate logical steps in a plan.
 * Used for heuristic decomposition.
 */
const STEP_MARKERS = [
  /^\d+\.\s+/m, // "1. Step"
  /^-\s+/m, // "- Step"
  /^Step\s+\d+/im, // "Step 1"
  /^First,/im, // "First, ..."
  /^Then,/im, // "Then, ..."
  /^Next,/im, // "Next, ..."
  /^Finally,/im, // "Finally, ..."
  /\n---+\n/m, // Horizontal rule separator
  /\n\*\*\*\n/m, // Bold separator
];

/**
 * Minimum plan length to attempt decomposition (characters).
 * Short plans don't benefit from decomposition.
 */
const MIN_PLAN_LENGTH_FOR_DECOMPOSITION = 500;

/**
 * Maximum number of sub-tasks to produce.
 */
const MAX_SUB_TASKS = 5;

/**
 * Decomposes a strategic plan into sub-tasks if it exceeds the complexity threshold.
 * Uses heuristic splitting based on common step markers in plan text.
 *
 * @param plan - The full plan text.
 * @param planId - Unique identifier for this plan.
 * @param gapIds - All gap IDs the plan addresses.
 * @returns A DecomposedPlan with sub-tasks or the original plan as a single task.
 */
export function decomposePlan(plan: string, planId: string, gapIds: string[]): DecomposedPlan {
  // Short plans: dispatch as-is
  if (plan.length < MIN_PLAN_LENGTH_FOR_DECOMPOSITION) {
    logger.info(
      `[PlanDecomposition] Plan too short (${plan.length} chars), dispatching as single task`
    );
    return {
      originalPlan: plan,
      planId,
      subTasks: [
        {
          subTaskId: `${planId}-sub-0`,
          planId,
          task: plan,
          gapIds,
          order: 0,
          dependencies: [],
          complexity: estimateComplexity(plan),
        },
      ],
      totalSubTasks: 1,
      wasDecomposed: false,
    };
  }

  // Try to split by step markers
  const segments = splitByStepMarkers(plan);

  if (segments.length <= 1) {
    logger.info('[PlanDecomposition] Could not identify sub-tasks, dispatching as single task');
    return {
      originalPlan: plan,
      planId,
      subTasks: [
        {
          subTaskId: `${planId}-sub-0`,
          planId,
          task: plan,
          gapIds,
          order: 0,
          dependencies: [],
          complexity: estimateComplexity(plan),
        },
      ],
      totalSubTasks: 1,
      wasDecomposed: false,
    };
  }

  // Cap at MAX_SUB_TASKS
  const cappedSegments = segments.slice(0, MAX_SUB_TASKS);

  // If last segment was capped, append remaining content to it
  if (segments.length > MAX_SUB_TASKS) {
    const remaining = segments.slice(MAX_SUB_TASKS).join('\n\n');
    cappedSegments[cappedSegments.length - 1] += `\n\n${remaining}`;
  }

  // Distribute gapIds across sub-tasks (round-robin)
  const subTasks: PlanSubTask[] = cappedSegments.map((segment, index) => ({
    subTaskId: `${planId}-sub-${index}`,
    planId,
    task:
      `You are working on sub-task ${index + 1} of ${cappedSegments.length} for plan ${planId}.\n\n` +
      `Full plan context:\n${plan.slice(0, 200)}...\n\n` +
      `YOUR SPECIFIC TASK:\n${segment.trim()}\n\n` +
      `Gap IDs for this sub-task: ${gapIds.join(', ')}`,
    gapIds: index < gapIds.length ? [gapIds[index % gapIds.length]] : gapIds.slice(0, 1),
    order: index,
    dependencies: index > 0 ? [index - 1] : [], // Sequential by default
    complexity: estimateComplexity(segment),
  }));

  logger.info(
    `[PlanDecomposition] Decomposed plan into ${subTasks.length} sub-tasks: ` +
      subTasks.map((s) => `#${s.order}(${s.complexity})`).join(', ')
  );

  return {
    originalPlan: plan,
    planId,
    subTasks,
    totalSubTasks: subTasks.length,
    wasDecomposed: true,
  };
}

/**
 * Splits a plan text into segments using common step markers.
 */
function splitByStepMarkers(plan: string): string[] {
  for (const marker of STEP_MARKERS) {
    const parts = plan.split(marker);
    if (parts.length > 1) {
      // Filter out empty parts
      const segments = parts.filter((s) => s.trim().length > 20);
      if (segments.length > 1) return segments;
    }
  }

  // Fallback: split by double newlines (paragraphs)
  const paragraphs = plan.split(/\n\n+/).filter((s) => s.trim().length > 30);
  if (paragraphs.length > 1) return paragraphs;

  return [plan];
}

/**
 * Estimates the complexity of a plan segment (1-10).
 * Based on length, code references, and technical keywords.
 */
function estimateComplexity(text: string): number {
  let score = 3; // base complexity

  // Length factor
  if (text.length > 500) score += 1;
  if (text.length > 1000) score += 1;
  if (text.length > 2000) score += 1;

  // Technical complexity indicators
  if (/refactor|migration|breaking.change/i.test(text)) score += 2;
  if (/test|spec|coverage/i.test(text)) score -= 1;
  if (/infra|sst|lambda|dynamodb/i.test(text)) score += 1;
  if (/security|auth|permission/i.test(text)) score += 1;

  return Math.max(1, Math.min(10, score));
}
