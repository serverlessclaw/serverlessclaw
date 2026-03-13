import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDomainConfig } from './shared';

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
    expect(getDomainConfig('api')).toBe('api.example.com');
  });

  it('should return the domain when CLAW_DOMAIN_DASHBOARD is set', () => {
    process.env.CLAW_DOMAIN_DASHBOARD = 'dashboard.example.com';
    expect(getDomainConfig('dashboard')).toBe('dashboard.example.com');
  });
});
