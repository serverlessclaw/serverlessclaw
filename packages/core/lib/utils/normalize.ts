/**
 * Base Normalization Utilities
 *
 * Pure functions with ZERO dependencies used for early data normalization.
 * Extracted here to prevent circular dependencies between schemas, types, and helpers.
 */

/**
 * Normalizes a userId by removing 'CONV#' prefixes.
 */
export function normalizeBaseUserId(userId: string | undefined | null): string {
  if (userId === '') return '';
  if (!userId || typeof userId !== 'string') return 'unknown';
  return userId.startsWith('CONV#') ? userId.split('#')[1] : userId;
}

/**
 * Sanitizes a string for use in AWS IoT MQTT topics.
 *
 * @param text - The string to sanitize for MQTT topic compatibility.
 * @returns A sanitized string safe for use in MQTT topics.
 */
export function sanitizeMqttTopic(text: string): string {
  if (!text) return 'unknown';
  return text.replace(/[#+]/g, '_');
}
