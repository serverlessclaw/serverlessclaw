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

import { InboundMessage, AttachmentSchema } from './types';

/**
 * NormalizedMessage is the canonical representation of an inbound message.
 * It contains the minimal fields required by the orchestration layer.
 */
export interface NormalizedMessage {
  source: string; // e.g. 'telegram', 'slack', 'github'
  userId: string; // unique identifier for the user (or channel)
  sessionId: string; // conversation/session identifier
  text: string; // user supplied text (or empty string for non‑text events)
  attachments: AttachmentSchema[];
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
    sessionId = userId,
    text = '',
    attachments = [],
    metadata = {},
    timestamp,
  } = raw;

  // Preserve the original timestamp if provided; otherwise generate now.
  const isoTimestamp = timestamp ?? new Date().toISOString();

  return {
    source,
    userId,
    sessionId,
    text,
    attachments,
    metadata,
    timestamp: isoTimestamp,
  };
}
