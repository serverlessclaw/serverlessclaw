import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SystemContext } from './system-context';
import fs from 'fs';

describe('SystemContext', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    SystemContext.refresh();
  });

  it('returns environmental constraints from package.json', () => {
    const spy = vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        version: '1.2.3',
        dependencies: { vitest: 'latest' },
      })
    );

    const constraints = SystemContext.getEnvironmentalConstraints();
    expect(constraints).toContain('[ENVIRONMENTAL_CONSTRAINTS]');
    expect(constraints).toContain('VERSION: 1.2.3');
    expect(constraints).toContain('vitest@latest');
    spy.mockRestore();
  });

  it('handles errors gracefully', () => {
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('File not found');
    });

    const constraints = SystemContext.getEnvironmentalConstraints();
    expect(constraints).toContain('Status: Unavailable');
    spy.mockRestore();
  });
});
