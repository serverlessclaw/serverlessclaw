import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the global $app variable before importing the module under test
vi.stubGlobal('$app', {
  stage: 'prod',
  name: 'serverlessclaw',
});

// Mock the sst global for cloudflare.dns
vi.stubGlobal('sst', {
  cloudflare: {
    dns: vi.fn().mockReturnValue({ type: 'cloudflare-dns' }),
  },
});

import { getDomainConfig } from './shared';

describe('infra/shared logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset process.env for each test
    delete process.env.CLAW_DOMAIN_API;
    delete process.env.CLAW_DOMAIN_DASHBOARD;
    delete process.env.CLAW_DOMAIN_ROUTER;
    delete process.env.CLOUDFLARE_ZONE_ID;
    delete process.env.ACM_CERTIFICATE_ARN;
  });

  describe('getDomainConfig', () => {
    it('should return undefined if stage is not prod', () => {
      vi.stubGlobal('$app', { stage: 'dev' });
      const config = getDomainConfig('api');
      expect(config).toBeUndefined();
    });

    it('should return undefined if domain env var is missing in prod', () => {
      vi.stubGlobal('$app', { stage: 'prod' });
      const config = getDomainConfig('api');
      expect(config).toBeUndefined();
    });

    it('should return domain config if env var is present in prod', () => {
      vi.stubGlobal('$app', { stage: 'prod' });
      process.env.CLAW_DOMAIN_API = 'api.example.com';
      process.env.CLOUDFLARE_ZONE_ID = 'zone123';

      const config = getDomainConfig('api');

      expect(config).toBeDefined();
      expect(config?.name).toBe('api.example.com');
      expect(config?.dns).toBeDefined();
    });

    it('should include ACM certificate ARN if provided', () => {
      vi.stubGlobal('$app', { stage: 'prod' });
      process.env.CLAW_DOMAIN_API = 'api.example.com';
      process.env.ACM_CERTIFICATE_ARN = 'arn:aws:acm:us-east-1:123456789012:certificate/abc';

      const config = getDomainConfig('api');

      expect(config?.cert).toBe('arn:aws:acm:us-east-1:123456789012:certificate/abc');
    });
  });
});
