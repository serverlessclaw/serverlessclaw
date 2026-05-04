import { AGENT_ERRORS } from '../../lib/constants';
import { PlanValidationResult } from './types';

/**
 * Validates a strategic plan before dispatching to Coder Agent.
 * Rejects plans that are too short, contain only meta-commentary, or are clearly invalid.
 *
 * @param plan - The raw plan text from the LLM.
 * @param _gapIds - The gap IDs this plan should address.
 * @returns An object with isValid flag and optional reason for rejection.
 */
export function validatePlan(plan: string, _gapIds: string[]): PlanValidationResult {
  // 1. Minimum length check (500 chars) — matches decomposer threshold and documentation
  if (plan.length < 500) {
    return { isValid: false, reason: `Plan too short (${plan.length} chars, minimum 500)` };
  }

  // 2. Check for empty response markers
  if (plan === 'Empty response from OpenAI.' || plan.startsWith('Empty response from')) {
    return { isValid: false, reason: 'Plan is an empty response marker' };
  }

  // 3. Check for system error markers
  if (plan === AGENT_ERRORS.PROCESS_FAILURE || plan.startsWith('I encountered an internal error')) {
    return { isValid: false, reason: 'Plan is a system error marker' };
  }

  // 4. Check for meta-commentary only (no actionable steps)
  const metaPatterns = [
    /^I (think|believe|feel|suggest|recommend)/i,
    /^(Let me|I'll|I will) (think|consider|analyze)/i,
    /^(Based on|After|Upon) (my|the) (analysis|review|assessment)/i,
  ];

  const hasMetaOnly = metaPatterns.some((p) => p.test(plan.trim()));
  const hasActionableSteps =
    /\d+\.\s/.test(plan) || // Numbered list
    /[-*]\s/.test(plan) || // Bullet points
    /```[\s\S]*```/.test(plan) || // Code blocks
    /\.(ts|js|py|json|yaml|yml|md)/i.test(plan); // File references

  if (hasMetaOnly && !hasActionableSteps) {
    return {
      isValid: false,
      reason: 'Plan contains only meta-commentary without actionable steps',
    };
  }

  return { isValid: true };
}
