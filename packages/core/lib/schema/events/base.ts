import { z } from 'zod';
import { AttachmentType } from '../../types/llm';
import { UserRole } from '../../types/index';
import { generateId } from '../../utils/id-generator';

/**
 * Schema for file or data attachments in events.
 */
export const ATTACHMENT_SCHEMA = z
  .object({
    /** Type of attachment (text, image, etc). */
    type: z.nativeEnum(AttachmentType),
    /** Publicly accessible URL. */
    url: z.string().optional(),
    /** Base64 encoded payload. */
    base64: z.string().optional(),
    /** Original filename. */
    name: z.string().optional(),
    /** MIME type of the content. */
    mimeType: z.string().optional(),
  })
  .refine((attachment) => Boolean(attachment.url || attachment.base64), {
    message: 'Attachment must include either url or base64 payload',
  });

/**
 * Base schema for all event payloads.
 * Includes common trace, identity, and budgeting fields.
 */
export const BASE_EVENT_SCHEMA = z.object({
  /** Origin of the event. */
  source: z.string().default('unknown'),
  /** The user ID context for the event. */
  userId: z.string().default('SYSTEM'),
  /** Unique identifier for the trace. */
  traceId: z.string().default(() => generateId('t')),
  /** Unique identifier for the task. */
  taskId: z.string().default(() => generateId('task')),
  /** Identifier of the node that produced this event. */
  nodeId: z.string().optional(),
  /** Parent task or event identifier. */
  parentId: z.string().optional(),
  /** Identifier of the agent associated with this event. */
  agentId: z.string().optional(),
  /** Entity that initiated the current workflow. */
  initiatorId: z.string().default('orchestrator'),
  /** Recursion depth. */
  depth: z.number().default(0),
  /** Unique identifier for the session. */
  sessionId: z.string().default('default-session'),
  /** Multi-tenant workspace identifier. */
  workspaceId: z.string().optional(),
  /** Multi-tenant organization identifier. */
  orgId: z.string().optional(),
  /** Multi-tenant team identifier. */
  teamId: z.string().optional(),
  /** Optional staff identifier. */
  staffId: z.string().optional(),
  /** The role of the user associated with this event. */
  userRole: z.nativeEnum(UserRole).optional(),
  /** Epoch timestamp in milliseconds. */
  timestamp: z.number().default(() => Date.now()),
  /** Optional token budget for the task. */
  tokenBudget: z.number().min(0).optional(),
  /** Optional cost limit for the task. */
  costLimit: z.number().min(0).optional(),
  /** Tracking of prior token usage in the trace. */
  priorTokenUsage: z
    .object({
      inputTokens: z.number().default(0),
      outputTokens: z.number().default(0),
      totalTokens: z.number().default(0),
    })
    .optional(),
  /** Track number of replays from Dead Letter Queue. */
  replayCount: z.number().optional(),
});

/** Zod-inferred type for Attachment (matches ATTACHMENT_SCHEMA runtime output). */
export type AttachmentPayload = z.infer<typeof ATTACHMENT_SCHEMA>;

/** Zod-inferred type for BaseEvent (matches BASE_EVENT_SCHEMA runtime output with defaults applied). */
export type BaseEventPayload = z.infer<typeof BASE_EVENT_SCHEMA>;
