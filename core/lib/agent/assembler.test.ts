/**
 * @module AgentAssembler Tests
 * @description Tests for context preparation including memory retrieval,
 * prompt assembly, managed context, and summarization trigger.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentAssembler } from './assembler';

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./executor', () => ({
  AGENT_LOG_MESSAGES: {
    RECOVERY_LOG_PREFIX: '\n\nSYSTEM_RECOVERY_LOG: ',
  },
}));

vi.mock('../prompts/vision', () => ({
  VISION_PROMPT_BLOCK: '\n\n[VISION_CAPABILITIES]',
}));

vi.mock('../prompts/snippets', () => ({
  resolvePromptSnippets: vi.fn((prompt: string) => Promise.resolve(prompt)),
}));

vi.mock('./context', () => ({
  AgentContext: {
    getMemoryIndexBlock: vi.fn(() => '[MEMORY_INDEX_BLOCK]'),
    getIdentityBlock: vi.fn(() => '[IDENTITY_BLOCK]'),
  },
}));

vi.mock('./context-manager', () => ({
  ContextManager: {
    getManagedContext: vi.fn((messages: any[]) => Promise.resolve({ messages, truncated: false })),
    needsSummarization: vi.fn(() => Promise.resolve(false)),
    summarize: vi.fn(() => Promise.resolve()),
  },
}));

function createMockMemory(overrides: Partial<any> = {}) {
  return {
    getHistory: vi.fn().mockResolvedValue([]),
    getDistilledMemory: vi.fn().mockResolvedValue(''),
    getLessons: vi.fn().mockResolvedValue([]),
    searchInsights: vi.fn().mockResolvedValue({ items: [] }),
    getGlobalLessons: vi.fn().mockResolvedValue([]),
    getSummary: vi.fn().mockResolvedValue(null),
    updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
    getScopedUserId: vi.fn((userId: string) => userId),
    ...overrides,
  };
}

function createMockProvider(overrides: Partial<any> = {}) {
  return {
    getCapabilities: vi.fn().mockResolvedValue({
      contextWindow: 8000,
      supportedAttachmentTypes: [],
    }),
    ...overrides,
  };
}

describe('AgentAssembler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultOptions = {
    isIsolated: false,
    depth: 0,
    activeModel: 'gpt-4',
    activeProvider: 'openai',
    activeProfile: 'standard' as any,
    systemPrompt: 'You are helpful.',
  };

  describe('prepareContext', () => {
    it('assembles context with all memory sources', async () => {
      const memory = createMockMemory({
        getHistory: vi.fn().mockResolvedValue([{ role: 'user', content: 'previous message' }]),
        getDistilledMemory: vi.fn().mockResolvedValue('User prefers concise answers'),
        getLessons: vi.fn().mockResolvedValue(['Always test code']),
        searchInsights: vi.fn().mockResolvedValue({
          items: [{ content: 'Likes TypeScript' }],
        }),
        getGlobalLessons: vi.fn().mockResolvedValue(['Global lesson']),
      });
      const provider = createMockProvider();

      const result = await AgentAssembler.prepareContext(
        memory as any,
        provider as any,
        undefined,
        'user1',
        'storage1',
        'hello world',
        undefined,
        defaultOptions
      );

      expect(result).toHaveProperty('contextPrompt');
      expect(result).toHaveProperty('messages');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('contextLimit');
      expect(result.activeModel).toBe('gpt-4');
      expect(result.activeProvider).toBe('openai');
      expect(memory.getHistory).toHaveBeenCalledWith('storage1');
      expect(memory.getDistilledMemory).toHaveBeenCalledWith('user1');
      expect(memory.getLessons).toHaveBeenCalledWith('user1');
      expect(memory.getGlobalLessons).toHaveBeenCalledWith(5);
    });

    it('includes recovery context when available', async () => {
      const memory = createMockMemory({
        getDistilledMemory: vi
          .fn()
          .mockResolvedValueOnce('')
          .mockResolvedValueOnce('rollback details'),
      });
      const provider = createMockProvider();

      const result = await AgentAssembler.prepareContext(
        memory as any,
        provider as any,
        undefined,
        'user1',
        'storage1',
        'hello',
        undefined,
        defaultOptions
      );

      expect(result.contextPrompt).toContain('SYSTEM_RECOVERY_LOG');
    });

    it('adds vision block for image-capable models', async () => {
      const memory = createMockMemory();
      const provider = createMockProvider({
        getCapabilities: vi.fn().mockResolvedValue({
          contextWindow: 8000,
          supportedAttachmentTypes: ['image'],
        }),
      });

      const result = await AgentAssembler.prepareContext(
        memory as any,
        provider as any,
        undefined,
        'user1',
        'storage1',
        'hello',
        undefined,
        defaultOptions
      );

      expect(result.contextPrompt).toContain('VISION_CAPABILITIES');
    });

    it('includes current user message in history', async () => {
      const memory = createMockMemory({
        getHistory: vi.fn().mockResolvedValue([{ role: 'user', content: 'old message' }]),
      });
      const provider = createMockProvider();

      const result = await AgentAssembler.prepareContext(
        memory as any,
        provider as any,
        undefined,
        'user1',
        'storage1',
        'new message',
        undefined,
        defaultOptions
      );

      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].content).toBe('new message');
    });

    it('sets relationship context for user consultation', async () => {
      const memory = createMockMemory();
      const provider = createMockProvider();

      const result = await AgentAssembler.prepareContext(
        memory as any,
        provider as any,
        undefined,
        'user1',
        'storage1',
        'hello',
        undefined,
        { ...defaultOptions, isIsolated: false }
      );

      expect(result.contextPrompt).toContain('USER_CONSULTATION');
    });

    it('sets relationship context for isolated tasks', async () => {
      const memory = createMockMemory();
      const provider = createMockProvider();

      const result = await AgentAssembler.prepareContext(
        memory as any,
        provider as any,
        undefined,
        'user1',
        'storage1',
        'hello',
        undefined,
        { ...defaultOptions, isIsolated: true }
      );

      expect(result.contextPrompt).toContain('SYSTEM_TASK');
    });

    it('triggers summarization when needed', async () => {
      const memory = createMockMemory();
      const provider = createMockProvider();
      const { ContextManager } = await import('./context-manager');
      (ContextManager.needsSummarization as any).mockResolvedValue(true);

      await AgentAssembler.prepareContext(
        memory as any,
        provider as any,
        undefined,
        'user1',
        'storage1',
        'hello',
        undefined,
        defaultOptions
      );

      expect(ContextManager.summarize).toHaveBeenCalled();
    });

    it('handles empty distilled memory gracefully', async () => {
      const memory = createMockMemory({
        getDistilledMemory: vi.fn().mockResolvedValue(''),
      });
      const provider = createMockProvider();

      const result = await AgentAssembler.prepareContext(
        memory as any,
        provider as any,
        undefined,
        'user1',
        'storage1',
        'hello',
        undefined,
        defaultOptions
      );

      expect(result.contextPrompt).toContain('No persistent knowledge available');
    });

    it('uses default context limit when capabilities lack contextWindow', async () => {
      const memory = createMockMemory();
      const provider = createMockProvider({
        getCapabilities: vi.fn().mockResolvedValue({
          supportedAttachmentTypes: [],
        }),
      });

      const result = await AgentAssembler.prepareContext(
        memory as any,
        provider as any,
        undefined,
        'user1',
        'storage1',
        'hello',
        undefined,
        defaultOptions
      );

      expect(result.contextLimit).toBeGreaterThan(0);
    });
  });
});
