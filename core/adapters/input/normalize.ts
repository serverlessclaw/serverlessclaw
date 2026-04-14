/**
 * Unified Input Normalization Utility
 *
 * All input adapters (Telegram, Slack, GitHub, Jira, etc.) should produce a
 * `NormalizedMessage` that conforms to the same shape expected by downstream
 * agents. This utility provides a single place to enforce that shape and to
 * perform any required sanitisation, defaulting, or enrichment.
 *
 * The shape mirrors the `InboundMessage` type used throughout the system.
 */

import { InboundMessage } from './types';
import { z } from 'zod';
import { AttachmentSchema } from './types';
import { fnv1aHash } from '../../lib/utils/id-generator';

/**
 * NormalizedMessage is the canonical representation of an inbound message.
 * It contains the minimal fields required by the orchestration layer.
 */
export interface NormalizedMessage {
  source: string; // e.g. 'telegram', 'slack', 'github'
  userId: string; // unique identifier for the user (or channel)
  sessionId: string; // conversation/session identifier (FNV-1a hashed for stable addressing)
  text: string; // user supplied text (or empty string for non‑text events)
  attachments: z.infer<typeof AttachmentSchema>[];
  metadata: Record<string, unknown>;
  timestamp: string; // ISO string
}

/**
 * Helper to coerce any adapter‑specific raw payload into a NormalizedMessage.
 *
 * Each adapter should call this function after its own parsing logic.
 *
 * @param raw - The raw InboundMessage returned by the adapter's `parse` method.
 * @returns NormalizedMessage
 */
export function normalizeMessage(raw: InboundMessage): NormalizedMessage {
  // Ensure required fields exist; fall back to safe defaults.
  const {
    source = 'unknown',
    userId = 'unknown',
    sessionId,
    text = '',
    attachments = [],
    metadata = {},
    timestamp,
  } = raw;

  // Use FNV-1a hash for stable session addressing (Principle 18)
  // If sessionId is provided, hash it; otherwise hash userId as fallback
  const stableSessionId = sessionId ? fnv1aHash(sessionId) : fnv1aHash(userId);

  // Preserve the original timestamp if provided; otherwise generate now.
  const isoTimestamp = timestamp ?? new Date().toISOString();

  return {
    source,
    userId,
    sessionId: stableSessionId,
    text,
    attachments,
    metadata,
    timestamp: isoTimestamp,
  };
}
