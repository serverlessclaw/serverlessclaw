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

import { logger } from '../logger';
import { AgentType } from '../types/agent';

/** Options for plan decomposition. */
export interface DecompositionOptions {
  /** The default agent to assign if no specific intent is detected. */
  defaultAgentId?: string;
  /** Minimum length to attempt decomposition. */
  minLength?: number;
  /** Maximum number of sub-tasks. */
  maxSubTasks?: number;
  /** Whether to force decomposition even if short. */
  force?: boolean;
}

/** A single decomposed sub-task from a strategic plan. */
export interface PlanSubTask {
  /** Unique sub-task identifier. */
  subTaskId: string;
  /** The parent plan ID for traceability. */
  planId: string;
  /** The specific instruction for the Agent. */
  task: string;
  /** Which gap IDs this sub-task addresses. */
  gapIds: string[];
  /** Execution order (0-based). */
  order: number;
  /** Sub-tasks that must complete before this one runs (order numbers). */
  dependencies: number[];
  /** Estimated complexity 1-10. */
  complexity: number;
  /** The type of agent to handle this sub-task. */
  agentId: string;
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
  /(?:^|\n)\s*###\s+Goal:\s+/i, // "### Goal: CODER" (Highest priority for deterministic splits)
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
const DEFAULT_MIN_PLAN_LENGTH = 500;

/**
 * Maximum number of sub-tasks to produce.
 */
const DEFAULT_MAX_SUB_TASKS = 5;

/**
 * Decomposes a strategic plan into sub-tasks if it exceeds the complexity threshold.
 * Uses heuristic splitting based on common step markers in plan text.
 *
 * @param plan - The full plan text.
 * @param planId - Unique identifier for this plan.
 * @param gapIds - All gap IDs the plan addresses.
 * @param options - Optional decomposition controls.
 * @returns A DecomposedPlan with sub-tasks or the original plan as a single task.
 */
export function decomposePlan(
  plan: string,
  planId: string,
  gapIds: string[],
  options: DecompositionOptions = {}
): DecomposedPlan {
  const minLength = options.minLength ?? DEFAULT_MIN_PLAN_LENGTH;
  const maxTasks = options.maxSubTasks ?? DEFAULT_MAX_SUB_TASKS;
  const defaultAgent = options.defaultAgentId ?? AgentType.CODER;

  // Bypass length check if plan uses explicit ### Goal: headers (structured missions)
  // but still require minimum content per header to avoid fragmenting trivial plans
  const hasGoalHeaders = (plan.match(/(?:^|\n)\s*###\s+Goal:\s+/gi) ?? []).length >= 2;
  const avgCharsPerHeader = hasGoalHeaders
    ? plan.length / (plan.match(/(?:^|\n)\s*###\s+Goal:\s+/gi) ?? []).length
    : 0;
  const hasSubstantiveHeaders = hasGoalHeaders && avgCharsPerHeader >= 50;

  // Short plans: dispatch as-is unless forced or structured with substantive content
  if (plan.length < minLength && !options.force && !hasSubstantiveHeaders) {
    logger.info(
      `[Decomposer] Plan too short (${plan.length} chars), dispatching as single task to ${defaultAgent}`
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
          agentId: determineAgent(plan, defaultAgent),
        },
      ],
      totalSubTasks: 1,
      wasDecomposed: false,
    };
  }

  // Try to split by step markers
  const segments = splitByStepMarkers(plan);

  if (segments.length <= 1 && !options.force) {
    logger.info('[Decomposer] Could not identify sub-tasks, dispatching as single task');
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
          agentId: determineAgent(plan, defaultAgent),
        },
      ],
      totalSubTasks: 1,
      wasDecomposed: false,
    };
  }

  // Cap at maxTasks
  const cappedSegments = segments.slice(0, maxTasks);

  // If last segment was capped, append remaining content to it
  if (segments.length > maxTasks) {
    const remaining = segments.slice(maxTasks).join('\n\n');
    cappedSegments[cappedSegments.length - 1] += `\n\n${remaining}`;
  }

  // Distribute gapIds across sub-tasks (round-robin)
  const subTasks: PlanSubTask[] = cappedSegments.map((segment, index) => ({
    subTaskId: `${planId}-sub-${index}`,
    planId,
    task: segment.trim(),
    gapIds: index < gapIds.length ? [gapIds[index % gapIds.length]] : gapIds.slice(0, 1),
    order: index,
    dependencies: [], // Enable parallel execution by default for Swarm
    complexity: estimateComplexity(segment),
    agentId: determineAgent(segment, defaultAgent),
  }));

  logger.info(
    `[Decomposer] Decomposed plan into ${subTasks.length} sub-tasks: ` +
      subTasks.map((s) => `#${s.order}(${s.complexity} -> ${s.agentId})`).join(', ')
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
 * For the ### Goal: header format, uses a lookahead split to preserve the header text.
 * For other markers, falls back to line-based splitting.
 */
function splitByStepMarkers(plan: string): string[] {
  // Priority 1: ### Goal: headers – split on the start of each header line, preserving it
  const goalHeaderPattern = /(?=(?:^|\n)\s*###\s+Goal:\s+)/i;
  const goalParts = plan
    .split(goalHeaderPattern)
    .filter((s) => /###\s+Goal:\s+/i.test(s) && s.trim().length > 10);
  if (goalParts.length > 1) return goalParts;

  // Priority 2: Numbered list – split line-by-line collecting runs starting with "N."
  const numberedLines = plan.split('\n');
  const numbered: string[] = [];
  let currentSection = '';
  for (const line of numberedLines) {
    if (/^\s*\d+\.\s+/.test(line)) {
      if (currentSection.trim().length > 20) numbered.push(currentSection.trim());
      currentSection = line;
    } else {
      currentSection += '\n' + line;
    }
  }
  if (currentSection.trim().length > 20) numbered.push(currentSection.trim());
  if (numbered.length > 1) return numbered;

  // Priority 3: Other structural markers (horizontal rules, etc.)
  for (const marker of STEP_MARKERS.slice(2)) {
    const parts = plan.split(marker);
    if (parts.length > 1) {
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

/**
 * Heuristically determines the best agent for a plan segment.
 * Prioritizes explicit ### Goal: [AgentType] headers over keyword matching.
 */
function determineAgent(text: string, defaultAgent: string): string {
  // Priority 1: explicit goal header declaration
  const goalHeader = text.match(/(?:^|\n)\s*###\s+Goal:\s+(RESEARCHER|CODER)\b/i);
  if (goalHeader) {
    const declared = goalHeader[1].toUpperCase();
    if (declared === 'RESEARCHER') return AgentType.RESEARCHER;
    if (declared === 'CODER') return AgentType.CODER;
  }

  const researchKeywords = [
    /research/i,
    /investigate/i,
    /explore/i,
    /bench[ ]*mark/i,
    /compare/i,
    /audit/i,
    /analyze (the )?(docs|documentation|repo|codebase)/i,
    /search (the )?(web|internet|google)/i,
    /look into/i,
    /find (a )?pattern/i,
  ];

  const coderKeywords = [
    /implement/i,
    /create (a )?(file|function|module|api)/i,
    /refactor/i,
    /fix/i,
    /update/i,
    /deploy/i,
    /write (a )?(test|spec|docs)/i,
  ];

  const isResearch = researchKeywords.some((p) => p.test(text));
  const isCoding = coderKeywords.some((p) => p.test(text));

  if (isResearch && !isCoding) {
    return AgentType.RESEARCHER;
  }
  if (isCoding && !isResearch) {
    return AgentType.CODER;
  }

  return defaultAgent;
}
