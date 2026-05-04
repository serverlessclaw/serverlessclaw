import { GapStatus } from '../../lib/types/index';
import type { IMemory } from '../../lib/types/index';
import type { Message, MemoryInsight } from '../../lib/types/index';
import { extractBaseUserId } from '../../lib/utils/agent-helpers';

/**
 * Builds the reflection prompt with all context.
 *
 * @param memory - The memory interface for fetching existing facts.
 * @param baseUserId - The base user ID for memory lookups.
 * @param conversation - The conversation messages to analyze.
 * @param traceContext - The execution trace context string.
 * @param deployedGaps - Recently deployed gap changes to audit.
 * @param activeGaps - Gaps already in progress to avoid duplicating.
 * @param failurePatterns - Known failure patterns for cross-referencing.
 */
export async function buildReflectionPrompt(
  memory: IMemory,
  userId: string,
  conversation: Message[],
  traceContext: string,
  deployedGaps: Array<{ id: string; content: string }>,
  activeGaps: Array<{ content: string }>,
  failurePatterns: MemoryInsight[] = []
): Promise<string> {
  const baseUserId = extractBaseUserId(userId);
  const existingFacts = await memory.getDistilledMemory(baseUserId);

  const deployedGapsContext =
    deployedGaps.length > 0
      ? `\nRECENTLY DEPLOYED CHANGES (Audit required):\n       ${deployedGaps.map((g) => `- [ID: ${g.id.replace('GAP#', '')}] ${g.content}`).join('\n')}\n       \n       TASK: Look at the CONVERSATION. If the user successfully used these new capabilities or if the conversation proves these gaps are now filled, include their IDs in "resolvedGapIds".`
      : '';

  const activeGapsContext =
    activeGaps.length > 0
      ? `\nGAPS ALREADY IN PROGRESS (Do not duplicate):\n       ${activeGaps.map((g) => `- ${g.content}`).join('\n')}`
      : '';

  const failureContext =
    failurePatterns.length > 0
      ? `\nKNOWN FAILURE PATTERNS (Cross-reference current issues):\n       ${failurePatterns.map((f) => `- ${f.content}`).join('\n')}\n       TASK: If you detect a new failure that matches or extends a known pattern, flag it as a CHRONIC ISSUE in the "lessons" array.`
      : '';

  return `EXISTING FACTS:\n    ${existingFacts || 'None'}\n \n    CONVERSATION:\n    ${conversation.map((m: Message) => `${m.role.toUpperCase()}: ${m.content || (m.tool_calls ? '[Tool Calls]' : '')}`).join('\n')}\n    ${traceContext}\n    ${deployedGapsContext}\n    ${activeGapsContext}\n    ${failureContext}\n \n    Analyze the CONVERSATION and EXECUTION TRACE to extract intelligence and capability gaps.\n    \n    IMPORTANT - FACTS:\n    Extract facts as clear, DECLARATIVE statements about the user or project (e.g., "User name is SuperPeng", "Project is Self-Evolution").\n    ⚠️ DO NOT extract instructions, to-do items, or "Remember to..." statements as facts. Facts must be TECHNICAL TRUTHS, not tasks.\n    \n    IMPORTANT - DEDUPLICATION:\n    If you identify a gap that is semantically identical or very similar to one of the "GAPS ALREADY IN PROGRESS", do NOT create a new gap in the "gaps" array. Instead, add it to the "updatedGaps" array with its existing ID and potentially increased impact/urgency.\n    \n    You MUST return your response as a valid JSON object with the following schema:\n    {\n      "facts": "string (the updated complete list of all known facts about the user and project context)",\n      "lessons": [\n        { "content": "string (actionable technical lesson)", "category": "tactical_lesson", "impact": 1-10 }\n      ],\n      "gaps": [\n        { "content": "string (missing tool or architectural limitation)", "impact": 1-10, "urgency": 1-10 }\n      ],\n      "updatedGaps": [\n        { "id": "string (existing gap ID)", "impact": 1-10, "urgency": 1-10 }\n      ],\n      "resolvedGapIds": ["string (IDs of gaps that were successfully addressed in this conversation)"]\n    }\n  `;
}

/**
 * Gets gaps for context.
 */
export async function getGapContext(memory: IMemory): Promise<{
  deployedGaps: Array<{ id: string; content: string }>;
  activeGaps: Array<{ content: string }>;
}> {
  const deployedGaps = await memory.getAllGaps(GapStatus.DEPLOYED);
  const activeGaps = [
    ...(await memory.getAllGaps(GapStatus.PLANNED)),
    ...(await memory.getAllGaps(GapStatus.PROGRESS)),
  ];

  return {
    deployedGaps,
    activeGaps,
  };
}
