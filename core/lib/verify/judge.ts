import { ReasoningProfile } from '../types/llm';
import { AgentType, TraceSource } from '../types/agent';
import { initAgent } from '../utils/agent-helpers';
import { logger } from '../logger';

/**
 * Result of a semantic evaluation by the LLM-as-a-Judge.
 */
export interface JudgeResult {
  /** Whether the evaluation passed. */
  satisfied: boolean;
  /** Numerical score (0-10) for the quality of the implementation. */
  score: number;
  /** Detailed reasoning for the verdict. */
  reasoning: string;
  /** Specific issues or gaps identified during evaluation. */
  issues?: string[];
  /** Suggested improvements for the next iteration. */
  suggestions?: string[];
  /** Whether the evaluation failed due to a system error (vs. quality issues). */
  systemError?: boolean;
}

/**
 * LLM-as-a-Judge Engine
 *
 * Provides systematic semantic evaluation of agent tasks, code implementations,
 * and system state using high-reasoning LLMs.
 */
export class LLMJudge {
  private static readonly DEFAULT_TIMEOUT_MS = 60000; // 60 seconds

  /**
   * Evaluates a task implementation against a set of criteria.
   *
   * @param task - The original task description.
   * @param implementation - The implementation or response to evaluate.
   * @param criteria - Specific evaluation criteria or "rubric".
   * @param context - Optional additional context (e.g., related files, traces).
   * @param timeoutMs - Optional timeout in milliseconds (default: 60000ms).
   * @returns A promise resolving to the judge's verdict.
   */
  static async evaluate(
    task: string,
    implementation: string,
    criteria: string[],
    context?: Record<string, unknown> & { workspaceId?: string },
    timeoutMs: number = LLMJudge.DEFAULT_TIMEOUT_MS
  ): Promise<JudgeResult> {
    const { agent } = await initAgent(AgentType.JUDGE, { workspaceId: context?.workspaceId });

    const prompt = `
# LLM-as-a-Judge: Semantic Evaluation

You are an impartial judge evaluating the quality of a task implementation within the Serverless Claw system.
Your goal is to determine if the implementation matches the architectural spirit (Stateless, AI-Native, Event-Driven) and satisfies the specific requirements.

## Original Task
${task}

## Implementation to Evaluate
${implementation}

## Evaluation Criteria
${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

${context ? `## Additional Context\n${JSON.stringify(context, null, 2)}` : ''}

## Output Format
Return your evaluation in strict JSON format:
{
  "satisfied": boolean,
  "score": number (0-10),
  "reasoning": "string",
  "issues": ["string"],
  "suggestions": ["string"]
}
    `.trim();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`LLM-as-a-Judge evaluation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const { responseText } = await Promise.race([
        agent.process('SYSTEM#JUDGE', prompt, {
          profile: ReasoningProfile.THINKING,
          isIsolated: true,
          source: TraceSource.SYSTEM,
        }),
        timeoutPromise,
      ]);

      const jsonContent = responseText.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(jsonContent);

      return {
        satisfied: !!parsed.satisfied,
        score: typeof parsed.score === 'number' ? parsed.score : 0,
        reasoning: parsed.reasoning || responseText,
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      };
    } catch (error) {
      logger.error('LLM-as-a-Judge evaluation failed:', error);
      return {
        satisfied: false,
        score: 5,
        reasoning: `Evaluation failed due to an internal error: ${error instanceof Error ? error.message : String(error)}. Defaulting to neutral score.`,
        issues: ['INTERNAL_ERROR'],
        suggestions: ['Review system health and retry evaluation'],
        systemError: true,
      };
    }
  }
}
