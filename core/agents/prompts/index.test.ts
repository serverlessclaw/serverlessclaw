import { describe, it, expect } from 'vitest';
import * as prompts from './index';

describe('agents/prompts/index', () => {
  it('exports prompt strings for agents', () => {
    const keys = Object.keys(prompts);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      const val = (prompts as any)[k];
      expect(typeof val === 'string' || typeof val === 'object').toBe(true);
      // Many prompts are markdown strings; ensure not empty when string
      if (typeof val === 'string') expect(val.length).toBeGreaterThan(10);
    }
  });
});
