import { z } from 'zod';
import { BASE_EVENT_SCHEMA } from './base';

/** Schema for consensus request events. */
export const CONSENSUS_REQUEST_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** The proposal text to be voted on. */
  proposal: z.string(),
  /** The voting mode (majority, unanimous, weighted). */
  mode: z.enum(['majority', 'unanimous', 'weighted']).default('majority'),
  /** Array of participant agent IDs. */
  voterIds: z.array(z.string()).min(1),
  /** Time limit for the consensus process. */
  timeoutMs: z.number().default(60000),
  /** Additional protocol-specific metadata. */
  metadata: z.record(z.string(), z.unknown()).default({}),
});

/** Schema for individual consensus vote events. */
export const CONSENSUS_VOTE_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** Identifier of the consensus session. */
  consensusId: z.string(),
  /** Identifier of the voter. */
  voterId: z.string(),
  /** The vote value. */
  vote: z.enum(['approve', 'reject', 'abstain']),
  /** Optional reasoning for the vote. */
  reasoning: z.string().optional(),
  /** Voting weight. */
  weight: z.number().default(1.0),
});

/** Schema for consensus result events. */
export const CONSENSUS_REACHED_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** Identifier of the consensus session. */
  consensusId: z.string(),
  /** The proposal that was voted on. */
  proposal: z.string(),
  /** The final outcome. */
  result: z.enum(['approved', 'rejected', 'timeout']),
  /** The voting mode used. */
  mode: z.enum(['majority', 'unanimous', 'weighted']),
  /** Final count of approval votes. */
  approveCount: z.number(),
  /** Final count of rejection votes. */
  rejectCount: z.number(),
  /** Final count of abstention votes. */
  abstainCount: z.number(),
  /** Total number of eligible voters. */
  totalVoters: z.number(),
  /** List of all recorded votes. */
  votes: z.array(
    z.object({
      voterId: z.string(),
      vote: z.enum(['approve', 'reject', 'abstain']),
      reasoning: z.string().optional(),
      weight: z.number(),
    })
  ),
});

/** Schema for reputation update events. */
export const REPUTATION_UPDATE_SCHEMA = BASE_EVENT_SCHEMA.extend({
  /** Identifier of the agent whose reputation is changing. */
  agentId: z.string(),
  /** Whether the associated task was successful. */
  success: z.boolean(),
  /** Time taken to complete the task. */
  durationMs: z.number(),
  /** Optional error message if failed. */
  error: z.string().optional(),
  /** Complexity score of the task. */
  taskComplexity: z.number().optional(),
});
