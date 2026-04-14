/**
 * @module IdGenerator
 * @description Unified ID generation utilities with consistent entropy and collision handling.
 * Provides standardized ID generation for different entity types in the system.
 */

const FNV_1A_PRIME = BigInt('0x100000001b3');
const FNV_1A_OFFSET = BigInt('0xcbf29ce484222325');

/**
 * Generates a session ID with timestamp + entropy.
 * Format: session_<timestamp>_<random>
 * @returns Unique session ID
 */
export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generates a workspace ID with timestamp + entropy.
 * Format: ws-<timestamp>-<random>
 * @returns Unique workspace ID
 */
export function generateWorkspaceId(): string {
  return `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Generates a collaboration ID (UUID v4).
 * @returns UUID-formatted collaboration ID
 */
export function generateCollaborationId(): string {
  return `${generateHex(8)}-${generateHex(4)}-4${generateHex(3)}-${generateHex(4)}-${generateHex(12)}`;
}

/**
 * Generates a gap ID with timestamp + entropy.
 * Format: gap_<timestamp>_<random>
 * @returns Unique gap ID
 */
export function generateGapId(): string {
  return `gap_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generates a generic unique ID with timestamp + entropy.
 * Format: <prefix>_<timestamp>_<random>
 * @param prefix - Optional prefix for the ID
 * @returns Unique ID with optional prefix
 */
export function generateId(prefix?: string): string {
  const base = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  return prefix ? `${prefix}_${base}` : base;
}

/**
 * Generates FNV-1a hash for stable sort key generation.
 * Used when deterministic ordering is required (e.g., DynamoDB sort keys).
 * @param input - String to hash
 * @returns Numeric string for use as sort key
 */
export function fnv1aHash(input: string): string {
  let h = FNV_1A_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * FNV_1A_PRIME) & BigInt('0xffffffffffffffff');
  }
  return h.toString();
}

/**
 * Converts a session ID to a stable sort key for DynamoDB.
 * If session ID contains a parseable timestamp, uses that directly.
 * Otherwise, falls back to FNV-1a hash for stability.
 * @param sessionId - Session ID to convert
 * @returns Stable sort key (numeric string)
 */
export function sessionIdToSortKey(sessionId: string): number {
  const parsedTimestamp = Number.parseInt(sessionId.split('_')[1] || sessionId, 10);
  if (!Number.isNaN(parsedTimestamp)) {
    return parsedTimestamp;
  }
  return Number(fnv1aHash(sessionId));
}

function generateHex(length: number): string {
  let result = '';
  const chars = '0123456789abcdef';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * 16)];
  }
  return result;
}
