/**
 * Shared mock for the `sst` module.
 * Usage: vi.mock('sst', () => import('./__mocks__/sst'));
 *
 * The Proxy-based Resource mock returns a test-prefixed resource name
 * for any property access, so individual tests don't need to mock this.
 */

export const Resource = new Proxy(
  {},
  {
    get: (_target, prop) => ({
      name: `test-${String(prop).toLowerCase()}`,
      value: 'test-value',
    }),
  }
);
