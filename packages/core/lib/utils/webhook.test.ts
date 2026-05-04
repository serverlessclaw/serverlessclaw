import { describe, it, expect } from 'vitest';
import { verifyHmacSignature, verifySecret } from './webhook';
import { createHmac } from 'crypto';

describe('webhook utilities', () => {
  describe('verifyHmacSignature', () => {
    const secret = 'test-secret';
    const payload = JSON.stringify({ event: 'test' });

    it('should verify a valid signature', () => {
      const hmac = createHmac('sha256', secret);
      const signature = 'sha256=' + hmac.update(payload).digest('hex');

      expect(verifyHmacSignature(payload, signature, secret)).toBe(true);
    });

    it('should reject an invalid signature', () => {
      expect(verifyHmacSignature(payload, 'sha256=invalid', secret)).toBe(false);
    });

    it('should reject signature with wrong prefix', () => {
      const hmac = createHmac('sha256', secret);
      const signature = 'sha1=' + hmac.update(payload).digest('hex');

      expect(verifyHmacSignature(payload, signature, secret)).toBe(false);
    });

    it('should reject if signature is missing', () => {
      expect(verifyHmacSignature(payload, '', secret)).toBe(false);
    });

    it('should support custom prefix', () => {
      const hmac = createHmac('sha256', secret);
      const digest = hmac.update(payload).digest('hex');
      const signature = 'HMAC ' + digest;

      expect(verifyHmacSignature(payload, signature, secret, 'HMAC ')).toBe(true);
    });
  });

  describe('verifySecret', () => {
    const expected = 'correct-secret';

    it('should verify matching secrets', () => {
      expect(verifySecret('correct-secret', expected)).toBe(true);
    });

    it('should reject non-matching secrets', () => {
      expect(verifySecret('wrong-secret', expected)).toBe(false);
    });

    it('should reject if provided is empty', () => {
      expect(verifySecret('', expected)).toBe(false);
    });

    it('should reject if expected is empty', () => {
      expect(verifySecret('any', '')).toBe(false);
    });
  });
});
