import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolMiddlewareRegistry } from './tool-middleware';

describe('ToolMiddlewareRegistry', () => {
  beforeEach(() => {
    ToolMiddlewareRegistry.clear();
  });

  const mockTool: any = { name: 'test-tool' };
  const mockArgs: any = { foo: 'bar' };
  const mockContext: any = { agentId: 'test-agent' };

  it('executes middleware and allows call', async () => {
    const beforeExecute = vi.fn().mockResolvedValue({ allowed: true });
    ToolMiddlewareRegistry.register({ beforeExecute });

    const result = await ToolMiddlewareRegistry.execute(mockTool, mockArgs, mockContext);

    expect(result.allowed).toBe(true);
    expect(beforeExecute).toHaveBeenCalledWith(mockTool, mockArgs, mockContext);
  });

  it('blocks execution when middleware returns allowed: false', async () => {
    const beforeExecute = vi.fn().mockResolvedValue({ allowed: false, reason: 'Stop!' });
    ToolMiddlewareRegistry.register({ beforeExecute });

    const result = await ToolMiddlewareRegistry.execute(mockTool, mockArgs, mockContext);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Stop!');
  });

  it('modifies arguments', async () => {
    const beforeExecute = vi.fn().mockResolvedValue({
      allowed: true,
      modifiedArgs: { foo: 'baz', extra: 123 },
    });
    ToolMiddlewareRegistry.register({ beforeExecute });

    const result = await ToolMiddlewareRegistry.execute(mockTool, mockArgs, mockContext);

    expect(result.allowed).toBe(true);
    expect(result.modifiedArgs).toEqual({ foo: 'baz', extra: 123 });
  });

  it('fails closed when middleware throws', async () => {
    const beforeExecute = vi.fn().mockImplementation(() => {
      throw new Error('Boom');
    });
    ToolMiddlewareRegistry.register({ beforeExecute });

    const result = await ToolMiddlewareRegistry.execute(mockTool, mockArgs, mockContext);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Middleware execution error');
  });
});
