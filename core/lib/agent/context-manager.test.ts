import { describe, it, expect, vi } from 'vitest';
import { ContextManager } from './context-manager';
import { MessageRole, Message } from '../types/index';

vi.mock('../registry/config', () => ({
  ConfigManager: {
    getTypedConfig: vi.fn().mockResolvedValue(0.2),
    getRawConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('ContextManager', () => {
  describe('estimateTokens', () => {
    it('should estimate tokens based on character count', () => {
      const messages: Message[] = [
        { role: MessageRole.USER, content: 'Hello' },
        { role: MessageRole.ASSISTANT, content: 'Hi there!' },
      ];
      expect(ContextManager.estimateTokens(messages)).toBe(5);
    });

    it('should include tool calls in estimation', () => {
      const messages: Message[] = [
        {
          role: MessageRole.ASSISTANT,
          tool_calls: [{ id: '1', type: 'function', function: { name: 'test', arguments: '{}' } }],
        },
      ];
      expect(ContextManager.estimateTokens(messages)).toBeGreaterThan(0);
    });

    it('should accept custom charsPerToken', () => {
      const messages: Message[] = [{ role: MessageRole.USER, content: 'Hello world!' }];
      expect(ContextManager.estimateTokens(messages, 4)).toBe(3);
      expect(ContextManager.estimateTokens(messages, 2)).toBe(6);
    });
  });

  describe('scoreMessagePriority', () => {
    it('should handle zero totalMessages safely without returning NaN', () => {
      const msg = { role: MessageRole.USER, content: 'Test' } as Message;
      const score = ContextManager.scoreMessagePriority(msg, 0, 0);
      expect(score).not.toBeNaN();
    });

    it('should assign highest priority to system messages', () => {
      const msg = { role: MessageRole.SYSTEM, content: 'You are an agent.' } as Message;
      const score = ContextManager.scoreMessagePriority(msg, 5, 20);
      expect(score).toBeGreaterThan(0.9);
    });

    it('should assign higher priority to tool errors than tool successes', () => {
      const errorMsg = { role: MessageRole.TOOL, content: 'Error: ENOENT no such file' } as Message;
      const successMsg = {
        role: MessageRole.TOOL,
        content: 'File created successfully at /tmp/out.log',
      } as Message;
      const errorScore = ContextManager.scoreMessagePriority(errorMsg, 5, 20);
      const successScore = ContextManager.scoreMessagePriority(successMsg, 5, 20);
      expect(errorScore).toBeGreaterThan(successScore);
    });

    it('should assign higher priority to user messages than assistant messages', () => {
      const userMsg = { role: MessageRole.USER, content: 'Deploy to production' } as Message;
      const assistantMsg = { role: MessageRole.ASSISTANT, content: 'I am thinking...' } as Message;
      const userScore = ContextManager.scoreMessagePriority(userMsg, 5, 20);
      const assistantScore = ContextManager.scoreMessagePriority(assistantMsg, 5, 20);
      expect(userScore).toBeGreaterThan(assistantScore);
    });

    it('should apply recency bonus favoring newer messages', () => {
      const msg = { role: MessageRole.USER, content: 'Deploy now' } as Message;
      const recentScore = ContextManager.scoreMessagePriority(msg, 19, 20);
      const oldScore = ContextManager.scoreMessagePriority(msg, 1, 20);
      expect(recentScore).toBeGreaterThan(oldScore);
    });

    it('should penalize very long messages', () => {
      const shortMsg = { role: MessageRole.USER, content: 'Deploy' } as Message;
      const longMsg = { role: MessageRole.USER, content: 'A'.repeat(5000) } as Message;
      const shortScore = ContextManager.scoreMessagePriority(shortMsg, 5, 20);
      const longScore = ContextManager.scoreMessagePriority(longMsg, 5, 20);
      expect(shortScore).toBeGreaterThan(longScore);
    });
  });

  describe('extractKeyFacts', () => {
    it('should extract file paths with quotes correctly', () => {
      const messages: Message[] = [
        {
          role: MessageRole.TOOL,
          content: 'Updated file "/src/app.ts"',
        },
      ];
      const facts = ContextManager.extractKeyFacts(messages);
      expect(facts.some((f) => f.includes('/src/app.ts'))).toBe(true);
    });

    it('should extract file paths from tool results', () => {
      const messages: Message[] = [
        {
          role: MessageRole.TOOL,
          content:
            'Created file at /Users/pengcao/projects/serverlessclaw/core/agent/deployment.ts successfully.',
        },
      ];
      const facts = ContextManager.extractKeyFacts(messages);
      expect(facts.some((f) => f.includes('deployment.ts'))).toBe(true);
    });

    it('should extract error messages from tool results', () => {
      const messages: Message[] = [
        {
          role: MessageRole.TOOL,
          content: 'Build failed: Error: Cannot find module ./utils in /src/index.ts',
        },
      ];
      const facts = ContextManager.extractKeyFacts(messages);
      expect(facts.some((f) => f.startsWith('err:'))).toBe(true);
    });

    it('should extract commit hashes', () => {
      const messages: Message[] = [
        {
          role: MessageRole.ASSISTANT,
          content: 'Deployed commit a1b2c3d4e5f67890abcdef1234567890 successfully.',
        },
      ];
      const facts = ContextManager.extractKeyFacts(messages);
      expect(facts.some((f) => f.startsWith('commit:'))).toBe(true);
    });

    it('should extract build status', () => {
      const messages: Message[] = [
        {
          role: MessageRole.TOOL,
          content: 'BUILD SUCCESS at commit abc1234 — artifacts deployed to s3://bucket',
        },
      ];
      const facts = ContextManager.extractKeyFacts(messages);
      expect(facts.some((f) => f.startsWith('status:'))).toBe(true);
    });

    it('should extract decisions', () => {
      const messages: Message[] = [
        {
          role: MessageRole.ASSISTANT,
          content: 'decision: proceeding with blue-green deployment strategy.',
        },
      ];
      const facts = ContextManager.extractKeyFacts(messages);
      expect(facts.some((f) => f.startsWith('dec:'))).toBe(true);
    });

    it('should return empty array when no facts are present', () => {
      const messages: Message[] = [
        { role: MessageRole.USER, content: 'Hello, how are you?' },
        { role: MessageRole.ASSISTANT, content: 'I am doing well, thank you!' },
      ];
      expect(ContextManager.extractKeyFacts(messages)).toHaveLength(0);
    });

    it('should deduplicate facts', () => {
      const messages: Message[] = [
        {
          role: MessageRole.TOOL,
          content: 'Updated file at /src/index.ts\nUpdated file at /src/index.ts',
        },
      ];
      const facts = ContextManager.extractKeyFacts(messages);
      const fileFacts = facts.filter((f) => f.startsWith('file:'));
      expect(fileFacts.length).toBe(1);
    });

    it('should cap extracted facts at 20', () => {
      const messages = Array.from({ length: 30 }, (_, i) => ({
        role: MessageRole.TOOL,
        content: `Error: failure ${i} at /src/file${i}.ts`,
      })) as Message[];
      const facts = ContextManager.extractKeyFacts(messages);
      expect(facts.length).toBeLessThanOrEqual(20);
    });
  });

  describe('getManagedContext', () => {
    it('should filter out existing system messages from input history', async () => {
      const history: Message[] = [
        { role: MessageRole.SYSTEM, content: 'Old system prompt' },
        { role: MessageRole.USER, content: 'User message' },
      ];
      const managed = await ContextManager.getManagedContext(
        history,
        null,
        'New system prompt',
        100000
      );
      const systemMessages = managed.messages.filter((m) => m.role === MessageRole.SYSTEM);
      expect(systemMessages.length).toBe(1);
      expect(systemMessages[0].content).toBe('New system prompt');
    });

    it('should group ASSISTANT messages with tool_calls and subsequent TOOL messages', async () => {
      const history: Message[] = [
        { role: MessageRole.USER, content: 'Do something' },
        {
          role: MessageRole.ASSISTANT,
          content: '',
          tool_calls: [{ id: '1', type: 'function', function: { name: 't1', arguments: '{}' } }],
        },
        { role: MessageRole.TOOL, tool_call_id: '1', name: 't1', content: 'Result 1' },
      ];

      const managed = await ContextManager.getManagedContext(history, null, 'Sys', 100000);
      const activeWindowMsgs = managed.messages.filter((m) => m.role !== MessageRole.SYSTEM);
      expect(activeWindowMsgs.length).toBe(3);
      expect(activeWindowMsgs[1].role).toBe(MessageRole.ASSISTANT);
      expect(activeWindowMsgs[2].role).toBe(MessageRole.TOOL);
    });

    it('should return recent messages that fit the limit', async () => {
      const history: Message[] = [
        { role: MessageRole.USER, content: 'Old message 1' },
        { role: MessageRole.ASSISTANT, content: 'Old message 2' },
        { role: MessageRole.USER, content: 'New message' },
      ];
      const limit = 100000;
      const managed = await ContextManager.getManagedContext(history, null, 'System prompt', limit);
      expect(managed.messages.length).toBeGreaterThan(0);
      expect(managed.messages[0].role).toBe(MessageRole.SYSTEM);
      expect(managed.messages.some((m) => m.content === 'New message')).toBe(true);
    });

    it('should include the summary if available', async () => {
      const managed = await ContextManager.getManagedContext(
        [],
        'Previously did X',
        'System prompt',
        100000
      );
      expect(managed.messages.some((m) => m.content?.includes('Previously did X'))).toBe(true);
    });

    it('should include tierBreakdown metadata', async () => {
      const managed = await ContextManager.getManagedContext(
        [{ role: MessageRole.USER, content: 'Test' }],
        null,
        'System prompt',
        100000
      );
      expect(managed.tierBreakdown).toBeDefined();
      expect(managed.tierBreakdown.systemPrompt).toBeGreaterThan(0);
      expect(typeof managed.tierBreakdown.compressedHistory).toBe('number');
      expect(typeof managed.tierBreakdown.activeWindow).toBe('number');
      expect(typeof managed.tierBreakdown.factsExtracted).toBe('number');
    });

    it('should prioritize tool errors over trivial assistant messages', async () => {
      const history: Message[] = [
        { role: MessageRole.ASSISTANT, content: 'I am thinking about this...' },
        { role: MessageRole.ASSISTANT, content: 'Let me check the logs.' },
        { role: MessageRole.USER, content: 'Old request' },
        { role: MessageRole.TOOL, content: 'Error: ENOENT /tmp/cache.json not found' },
      ];
      const limit = 100000;
      const managed = await ContextManager.getManagedContext(history, null, 'System', limit);
      const activeWindowMsgs = managed.messages.filter((m) => m.role !== MessageRole.SYSTEM);
      const hasError = activeWindowMsgs.some(
        (m) => m.role === MessageRole.TOOL && m.content?.includes('ENOENT')
      );
      expect(hasError).toBe(true);
    });

    it('should respect custom budget ratios via options', async () => {
      const history = Array.from({ length: 10 }, (_, i) => ({
        role: MessageRole.USER,
        content: `Message ${i}: ${'x'.repeat(100)}`,
      })) as Message[];
      const managed = await ContextManager.getManagedContext(history, null, 'System', 1000, {
        summaryRatio: 0.5,
        activeWindowRatio: 0.5,
      });
      expect(managed.messages.length).toBeGreaterThan(0);
      expect(managed.messages[0].role).toBe(MessageRole.SYSTEM);
    });

    it('should apply provider-specific toolResultPriority', () => {
      const msg = { role: MessageRole.TOOL, content: 'Success' } as Message;

      // Default strategy: toolResultPriority = normal
      const defaultScore = ContextManager.scoreMessagePriority(msg, 5, 20);

      // Claude strategy: toolResultPriority = high
      const claudeStrategy = {
        maxContextTokens: 200000,
        reservedResponseTokens: 8192,
        compressionTriggerPercent: 80,
        toolResultPriority: 'high' as const,
      };
      const highPriorityScore = ContextManager.scoreMessagePriority(msg, 5, 20, claudeStrategy);

      expect(highPriorityScore).toBeGreaterThan(defaultScore);
    });
  });

  describe('needsSummarization', () => {
    it('should return true if history exceeds trigger ratio', async () => {
      const longMessage = 'A'.repeat(9000);
      const history: Message[] = [{ role: MessageRole.USER, content: longMessage }];
      expect(await ContextManager.needsSummarization(history, 2000)).toBe(true);
    });

    it('should return false if history is below trigger ratio', async () => {
      const history: Message[] = [{ role: MessageRole.USER, content: 'Hello' }];
      expect(await ContextManager.needsSummarization(history, 10000)).toBe(false);
    });

    it('should respect custom trigger ratio', async () => {
      const history: Message[] = [{ role: MessageRole.USER, content: 'A'.repeat(7500) }];
      expect(await ContextManager.needsSummarization(history, 5000, 0.4)).toBe(true);
      expect(await ContextManager.needsSummarization(history, 5000, 0.6)).toBe(false);
    });
  });
});
