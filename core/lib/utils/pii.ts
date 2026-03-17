/**
 * PII Filtering Utilities
 *
 * Provides regex-based detection and masking for common Personal Identifiable Information
 * to ensure that sensitive user data is not persisted in memory or logs.
 */

const PII_PATTERNS = {
  EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  API_KEY:
    /(?:api|secret|key|token|auth|password|pwd)(?:\s*[:=]\s*|\s+)(?:"|')?([a-zA-Z0-9-_.]{8,})(?:"|')?/gi,
  CREDIT_CARD: /\b(?:\d[ -]*?){13,16}\b/g,
  IP_ADDRESS: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g,
};

/**
 * Filter PII from a string by masking matches with [REDACTED].
 *
 * @param text - The text to filter.
 * @returns The filtered text with sensitive information masked.
 */
export function filterPII(text: string): string {
  if (!text) return text;

  let filtered = text;

  // 1. Mask Emails
  filtered = filtered.replace(PII_PATTERNS.EMAIL, '[EMAIL_REDACTED]');

  // 2. Mask API Keys / Secrets (preserving the key name)
  filtered = filtered.replace(PII_PATTERNS.API_KEY, (match, key) => {
    // We want to replace the FIRST occurrence of the secret 'key' after the key-name prefix
    const keyIndex = match.lastIndexOf(key);
    if (keyIndex === -1) return match;
    return (
      match.substring(0, keyIndex) + '[SECRET_REDACTED]' + match.substring(keyIndex + key.length)
    );
  });

  // 3. Mask Credit Cards
  filtered = filtered.replace(PII_PATTERNS.CREDIT_CARD, '[CARD_REDACTED]');

  // 4. Mask IP Addresses
  filtered = filtered.replace(PII_PATTERNS.IP_ADDRESS, '[IP_REDACTED]');

  return filtered;
}

/**
 * Recursively filter PII from an object's string properties.
 *
 * @param obj - The object to filter.
 * @returns A deep copy of the object with PII masked in all string properties.
 */
export function filterPIIFromObject<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => filterPIIFromObject(item)) as unknown as T;
  }

  const filteredObj = { ...obj } as Record<string, unknown>;

  for (const key in filteredObj) {
    const value = filteredObj[key];
    if (typeof value === 'string') {
      filteredObj[key] = filterPII(value);
    } else if (typeof value === 'object') {
      filteredObj[key] = filterPIIFromObject(value);
    }
  }

  return filteredObj as unknown as T;
}
