import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDomainConfig } from './shared';

// Mock sst global
(global as any).sst = {
  cloudflare: {
    dns: vi.fn().mockReturnValue({}),
  },
};

describe('getDomainConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CLAW_DOMAIN_API = '';
    process.env.CLAW_DOMAIN_DASHBOARD = '';
  });

  it('should return undefined when env vars are not set', () => {
    expect(getDomainConfig('api')).toBeUndefined();
    expect(getDomainConfig('dashboard')).toBeUndefined();
  });

  it('should return the domain when CLAW_DOMAIN_API is set', () => {
    process.env.CLAW_DOMAIN_API = 'api.example.com';
    expect(getDomainConfig('api')).toMatchObject({ name: 'api.example.com' });
  });

  it('should return the domain when CLAW_DOMAIN_DASHBOARD is set', () => {
    process.env.CLAW_DOMAIN_DASHBOARD = 'dashboard.example.com';
    expect(getDomainConfig('dashboard')).toMatchObject({ name: 'dashboard.example.com' });
  });
});
