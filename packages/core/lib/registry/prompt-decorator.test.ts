import { describe, it, expect, beforeEach } from 'vitest';
import { PromptDecoratorRegistry } from './prompt-decorator';

describe('PromptDecoratorRegistry', () => {
  beforeEach(() => {
    PromptDecoratorRegistry.clear();
  });

  it('applies a single decorator', async () => {
    PromptDecoratorRegistry.register((prompt) => `${prompt}\n[DECORATED]`);

    const result = await PromptDecoratorRegistry.decorate('Original Prompt', {
      agentId: 'test-agent',
    });

    expect(result).toBe('Original Prompt\n[DECORATED]');
  });

  it('applies multiple decorators in order', async () => {
    PromptDecoratorRegistry.register((prompt) => `${prompt}\n1`);
    PromptDecoratorRegistry.register((prompt) => `${prompt}\n2`);

    const result = await PromptDecoratorRegistry.decorate('Original', {
      agentId: 'test-agent',
    });

    expect(result).toBe('Original\n1\n2');
  });

  it('passes context to decorators', async () => {
    PromptDecoratorRegistry.register((prompt, context) => {
      return `${prompt}\nWorkspace: ${context.workspaceId}`;
    });

    const result = await PromptDecoratorRegistry.decorate('Base', {
      agentId: 'agent-1',
      workspaceId: 'ws-voltx',
    });

    expect(result).toContain('Workspace: ws-voltx');
  });

  it('handles async decorators', async () => {
    PromptDecoratorRegistry.register(async (prompt) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return `${prompt}\nAsync Done`;
    });

    const result = await PromptDecoratorRegistry.decorate('Start', {
      agentId: 'agent-1',
    });

    expect(result).toBe('Start\nAsync Done');
  });

  it('survives decorator errors', async () => {
    PromptDecoratorRegistry.register(() => {
      throw new Error('Boom');
    });
    PromptDecoratorRegistry.register((prompt) => `${prompt}\nRecovered`);

    const result = await PromptDecoratorRegistry.decorate('Safe', {
      agentId: 'agent-1',
    });

    expect(result).toBe('Safe\nRecovered');
  });
});
