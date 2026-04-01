import { describe, it, expect, vi } from 'vitest';

vi.mock('./base-handler', () => ({
  createMCPServerHandler: vi.fn().mockReturnValue(vi.fn()),
}));

import { handler } from './google-search';
import { createMCPServerHandler } from './base-handler';

describe('google-search MCP server handler', () => {
  it('exports a handler', () => {
    expect(handler).toBeDefined();
    expect(typeof handler).toBe('function');
  });

  it('creates handler with correct server params', () => {
    expect(createMCPServerHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'npx',
        args: expect.arrayContaining(['@mcp-server/google-search-mcp']),
      })
    );
  });

  it('uses --offline flag', () => {
    const callArgs = vi.mocked(createMCPServerHandler).mock.calls[0][0];
    expect(callArgs.args).toContain('--offline');
  });

  it('sets HOME to /tmp', () => {
    const callArgs = vi.mocked(createMCPServerHandler).mock.calls[0][0];
    expect(callArgs.env?.HOME).toBe('/tmp');
  });

  it('includes GOOGLE_API_KEY in env', () => {
    const callArgs = vi.mocked(createMCPServerHandler).mock.calls[0][0];
    expect(callArgs.env).toHaveProperty('GOOGLE_API_KEY');
  });

  it('includes GOOGLE_SEARCH_ENGINE_ID in env', () => {
    const callArgs = vi.mocked(createMCPServerHandler).mock.calls[0][0];
    expect(callArgs.env).toHaveProperty('GOOGLE_SEARCH_ENGINE_ID');
  });
});
