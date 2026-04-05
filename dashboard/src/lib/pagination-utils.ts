/**
 * @module PaginationUtils
 * Reusable logic for encoding and decoding DynamoDB pagination tokens (ExclusiveStartKey).
 */

/**
 * Decodes a base64 encoded pagination token into a DynamoDB key object.
 * @param token - The base64 encoded string.
 * @returns The decoded key object or undefined if invalid.
 */
export function decodePaginationToken(token: string): Record<string, unknown> | undefined {
  if (!token) return undefined;
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString());
  } catch {
    return undefined;
  }
}

/**
 * Encodes a DynamoDB key object into a base64 pagination token.
 * @param key - The DynamoDB LastEvaluatedKey object.
 * @returns The base64 encoded string or undefined if key is missing.
 */
export function encodePaginationToken(key: Record<string, unknown> | undefined): string | undefined {
  if (!key) return undefined;
  try {
    return Buffer.from(JSON.stringify(key)).toString('base64');
  } catch {
    return undefined;
  }
}
