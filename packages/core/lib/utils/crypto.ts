import { createHmac, timingSafeEqual, createHash } from 'crypto';

/**
 * Verifies an HMAC signature for a webhook payload in a timing-safe manner.
 * Shared between core and integrations to prevent duplication.
 *
 * @param payload - The raw string body of the webhook.
 * @param signature - The signature header value (e.g. sha256=...).
 * @param secret - The configured webhook secret.
 * @param prefix - Optional prefix used in the signature (e.g. 'sha256=').
 */
export function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string,
  prefix = 'sha256='
): boolean {
  if (!signature || !secret) return false;

  try {
    const hmac = createHmac('sha256', secret);
    const digest = Buffer.from(prefix + hmac.update(payload).digest('hex'), 'utf8');
    const checksum = Buffer.from(signature, 'utf8');

    return checksum.length === digest.length && timingSafeEqual(digest, checksum);
  } catch {
    return false;
  }
}

/**
 * Performs a timing-safe equality comparison for secrets.
 *
 * @param provided - The secret provided in the request.
 * @param expected - The expected secret value.
 */
export function verifySecret(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;

  try {
    const providedBuf = Buffer.from(provided, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    return providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * Computes a SHA-256 hash for a given string.
 * Useful for versioning prompts or generating deterministic IDs.
 *
 * @param input - The string to hash.
 * @returns The hex representation of the hash.
 */
export function hashString(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
