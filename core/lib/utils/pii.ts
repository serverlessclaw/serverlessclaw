/**
 * PII Filtering Utilities
 *
 * Provides regex-based detection and masking for common Personal Identifiable Information
 * to ensure that sensitive user data is not persisted in memory or logs.
 */

const PII_PATTERNS = {
  EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  CREDIT_CARD: /\b(?:\d[ -]*?){13,16}\b/g,
  IP_ADDRESS: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g,
  // Improved regex for secrets: keyword followed by separator and then the secret
  SECRET:
    /\b(api_?key|secret|key|token|auth|password|pwd)(\s*[:=is]+\s*|\s+)(["']?)([a-zA-Z0-9-_.]{4,})\3/gi,
};

// 13-digit Unix timestamps (milliseconds) starting with 1 — not credit cards
const TIMESTAMP_13_DIGIT = /^1\d{12}$/;

// Common keywords that usually precede a secret or credential
const SECRET_KEYWORDS = ['api', 'secret', 'key', 'token', 'auth', 'password', 'pwd'];

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

  // 2. Mask Secrets
  filtered = filtered.replace(PII_PATTERNS.SECRET, (match, key, sep, quote, _secret) => {
    return `${key}${sep}${quote}[SECRET_REDACTED]${quote}`;
  });

  // 3. Mask Credit Cards (skip 13-digit timestamps)
  filtered = filtered.replace(PII_PATTERNS.CREDIT_CARD, (match) => {
    const digits = match.replace(/[\s-]/g, '');
    if (TIMESTAMP_13_DIGIT.test(digits)) return match;
    return '[CARD_REDACTED]';
  });

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
    const lowerKey = key.toLowerCase();

    // skip filtering for tool call function names and arguments to avoid breaking structured JSON
    // or corrupting the schema definition.
    if (lowerKey === 'function' || lowerKey === 'tool_calls' || lowerKey === 'tool_call_id') {
      continue;
    }

    const value = filteredObj[key];

    // If the KEY itself is sensitive, mask the value completely
    const isSensitiveKey = SECRET_KEYWORDS.some((k) => lowerKey.includes(k));
    if (isSensitiveKey && typeof value === 'string') {
      filteredObj[key] = '[SECRET_REDACTED]';
      continue;
    }

    if (typeof value === 'string') {
      filteredObj[key] = filterPII(value);
    } else if (typeof value === 'object') {
      filteredObj[key] = filterPIIFromObject(value);
    }
  }

  return filteredObj as unknown as T;
}
