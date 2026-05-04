import { z } from 'zod';
import { AgentStatus, AGENT_TYPES } from '../types/agent';

/**
 * Standardized Orchestration Signal Schema.
 * Used by Initiator agents (SuperClaw, Planner) to communicate high-level
 * decisions after being consulted by sub-agents or system events.
 */
export const OrchestrationSignalSchema = z
  .object({
    /**
     * High-level operational decision.
     * - SUCCESS: Goal achieved.
     * - FAILED: Goal unreachable.
     * - RETRY: Re-dispatch to the same agent with refinements.
     * - PIVOT: Delegate to a different agent/strategy.
     * - ESCALATE: Stop and wait for human input.
     */
    status: z.nativeEnum(AgentStatus),

    /** Inner monologue or reasoning steps explaining the decision. */
    reasoning: z.string().min(1, 'Reasoning is required for all orchestration decisions.'),

    /**
     * Clear, actionable instructions for the next step.
     * If status is RETRY or PIVOT, this is the task for the next agent.
     * If status is ESCALATE, this is the question for the human.
     */
    nextStep: z.string().optional(),

    /**
     * The ID of the agent to delegate to.
     * Required if status is PIVOT.
     */
    targetAgentId: z.nativeEnum(AGENT_TYPES).optional(),

    /**
     * Additional data to pass to the next agent or human.
     */
    metadata: z.record(z.string(), z.any()).optional(),
  })
  .strict();

/** Type inference for the Orchestration Signal. */
export type OrchestrationSignal = z.infer<typeof OrchestrationSignalSchema>;

/**
 * QA Failure Issue Schema.
 * Validates individual issues in the structured feedback JSON returned by QA Auditor on REOPEN.
 */
export const QAFailureIssueSchema = z.object({
  file: z.string().min(1, 'File path is required.'),
  line: z.number().int().positive('Line number must be a positive integer.'),
  description: z.string().min(1, 'Description is required.'),
  expected: z.string().min(1, 'Expected behavior is required.'),
  actual: z.string().min(1, 'Actual behavior is required.'),
});

/**
 * QA Failure Feedback Schema.
 * Validates the structured feedback block returned by QA Auditor when status is REOPEN.
 */
export const QAFailureFeedbackSchema = z.object({
  failureType: z.enum(['LOGIC_ERROR', 'MISSING_TEST', 'DOCS_DRIFT', 'SECURITY_RISK']),
  issues: z.array(QAFailureIssueSchema).min(1, 'At least one issue is required.'),
});

/** Type inference for QA Failure Feedback. */
export type QAFailureFeedback = z.infer<typeof QAFailureFeedbackSchema>;
