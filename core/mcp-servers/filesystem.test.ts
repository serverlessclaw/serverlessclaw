import { describe, it, expect, vi } from 'vitest';

vi.mock('./base-handler', () => ({
  createMCPServerHandler: vi.fn().mockReturnValue(vi.fn()),
}));

import { handler } from './filesystem';
import { createMCPServerHandler } from './base-handler';

describe('filesystem MCP server handler', () => {
  it('exports a handler', () => {
    expect(handler).toBeDefined();
    expect(typeof handler).toBe('function');
  });

  it('creates handler with correct server params', () => {
    expect(createMCPServerHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'npx',
        args: expect.arrayContaining(['@modelcontextprotocol/server-filesystem']),
      })
    );
  });

  it('restricts filesystem to /tmp', () => {
    const callArgs = vi.mocked(createMCPServerHandler).mock.calls[0][0];
    expect(callArgs.args).toContain('/tmp');
  });

  it('uses --offline flag', () => {
    const callArgs = vi.mocked(createMCPServerHandler).mock.calls[0][0];
    expect(callArgs.args).toContain('--offline');
  });

  it('sets HOME to /tmp', () => {
    const callArgs = vi.mocked(createMCPServerHandler).mock.calls[0][0];
    expect(callArgs.env?.HOME).toBe('/tmp');
  });
});
