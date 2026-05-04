import { describe, it, expect, vi } from 'vitest';
import { ContextManager } from './context-manager';
import { MessageRole, Message } from '../types/index';

vi.mock('../registry/config', () => ({
  ConfigManager: {
    getTypedConfig: vi.fn().mockResolvedValue(0.2),
    getRawConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../metrics/token-usage', () => ({
  TokenTracker: {
    recordInvocation: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('ContextManager', () => {
  describe('estimateTokens', () => {
    it('should estimate tokens based on character count', () => {
      const messages: Message[] = [
        { role: MessageRole.USER, content: 'Hello', traceId: 'test-trace', messageId: 'test-msg' },
        {
          role: MessageRole.ASSISTANT,
          content: 'Hi there!',
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
      ];
      expect(ContextManager.estimateTokens(messages)).toBe(5);
    });

    it('should include tool calls in estimation', () => {
      const messages: Message[] = [
        {
          role: MessageRole.ASSISTANT,
          content: '',
          tool_calls: [{ id: '1', type: 'function', function: { name: 'test', arguments: '{}' } }],
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
      ];
      expect(ContextManager.estimateTokens(messages)).toBeGreaterThan(0);
    });

    it('should accept custom charsPerToken', () => {
      const messages: Message[] = [
        {
          role: MessageRole.USER,
          content: 'Hello world!',
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
      ];
      expect(ContextManager.estimateTokens(messages, 4)).toBe(3);
      expect(ContextManager.estimateTokens(messages, 2)).toBe(6);
    });
  });

  describe('scoreMessagePriority', () => {
    it('should handle zero totalMessages safely without returning NaN', () => {
      const msg = {
        role: MessageRole.USER,
        content: 'Test',
        traceId: 'test-trace',
        messageId: 'test-msg',
      } as Message;
      const score = ContextManager.scoreMessagePriority(msg, 0, 0);
      expect(score).not.toBeNaN();
    });

    it('should assign highest priority to system messages', () => {
      const msg = {
        role: MessageRole.SYSTEM,
        content: 'You are an agent.',
        traceId: 'test-trace',
        messageId: 'test-msg',
      } as Message;
      const score = ContextManager.scoreMessagePriority(msg, 5, 20);
      expect(score).toBeGreaterThan(0.9);
    });

    it('should assign higher priority to tool errors than tool successes', () => {
      const errorMsg = {
        role: MessageRole.TOOL,
        content: 'Error: ENOENT no such file',
        traceId: 'test-trace',
        messageId: 'test-msg',
      } as Message;
      const successMsg = {
        role: MessageRole.TOOL,
        content: 'File created successfully at /tmp/out.log',
      } as Message;
      const errorScore = ContextManager.scoreMessagePriority(errorMsg, 5, 20);
      const successScore = ContextManager.scoreMessagePriority(successMsg, 5, 20);
      expect(errorScore).toBeGreaterThan(successScore);
    });

    it('should assign higher priority to user messages than assistant messages', () => {
      const userMsg = {
        role: MessageRole.USER,
        content: 'Deploy to production',
        traceId: 'test-trace',
        messageId: 'test-msg',
      } as Message;
      const assistantMsg = {
        role: MessageRole.ASSISTANT,
        content: 'I am thinking...',
        traceId: 'test-trace',
        messageId: 'test-msg',
      } as Message;
      const userScore = ContextManager.scoreMessagePriority(userMsg, 5, 20);
      const assistantScore = ContextManager.scoreMessagePriority(assistantMsg, 5, 20);
      expect(userScore).toBeGreaterThan(assistantScore);
    });

    it('should apply recency bonus favoring newer messages', () => {
      const msg = {
        role: MessageRole.USER,
        content: 'Deploy now',
        traceId: 'test-trace',
        messageId: 'test-msg',
      } as Message;
      const recentScore = ContextManager.scoreMessagePriority(msg, 19, 20);
      const oldScore = ContextManager.scoreMessagePriority(msg, 1, 20);
      expect(recentScore).toBeGreaterThan(oldScore);
    });

    it('should penalize very long messages', () => {
      const shortMsg = {
        role: MessageRole.USER,
        content: 'Deploy',
        traceId: 'test-trace',
        messageId: 'test-msg',
      } as Message;
      const longMsg = {
        role: MessageRole.USER,
        content: 'A'.repeat(5000),
        traceId: 'test-trace',
        messageId: 'test-msg',
      } as Message;
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
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
      ];
      const facts = ContextManager.extractKeyFacts(messages);
      expect(facts.some((f) => f.includes('/src/app.ts'))).toBe(true);
    });

    it('should extract file paths from tool results', () => {
      const messages: Message[] = [
        {
          role: MessageRole.TOOL,
          content: 'Created file at ./core/agent/deployment.ts successfully.',
          traceId: 'test-trace',
          messageId: 'test-msg',
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
          traceId: 'test-trace',
          messageId: 'test-msg',
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
          traceId: 'test-trace',
          messageId: 'test-msg',
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
          traceId: 'test-trace',
          messageId: 'test-msg',
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
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
      ];
      const facts = ContextManager.extractKeyFacts(messages);
      expect(facts.some((f) => f.startsWith('dec:'))).toBe(true);
    });

    it('should return empty array when no facts are present', () => {
      const messages: Message[] = [
        {
          role: MessageRole.USER,
          content: 'Hello, how are you?',
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
        {
          role: MessageRole.ASSISTANT,
          content: 'I am doing well, thank you!',
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
      ];
      expect(ContextManager.extractKeyFacts(messages)).toHaveLength(0);
    });

    it('should deduplicate facts', () => {
      const messages: Message[] = [
        {
          role: MessageRole.TOOL,
          content: 'Updated file at /src/index.ts\nUpdated file at /src/index.ts',
          traceId: 'test-trace',
          messageId: 'test-msg',
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
        traceId: 'test-trace',
        messageId: 'test-msg',
      })) as Message[];
      const facts = ContextManager.extractKeyFacts(messages);
      expect(facts.length).toBeLessThanOrEqual(20);
    });
  });

  describe('getManagedContext', () => {
    it('should filter out existing system messages from input history', async () => {
      const history: Message[] = [
        {
          role: MessageRole.SYSTEM,
          content: 'Old system prompt',
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
        {
          role: MessageRole.USER,
          content: 'User message',
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
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
        {
          role: MessageRole.USER,
          content: 'Do something',
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
        {
          role: MessageRole.ASSISTANT,
          content: '',
          tool_calls: [{ id: '1', type: 'function', function: { name: 't1', arguments: '{}' } }],
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
        {
          role: MessageRole.TOOL,
          tool_call_id: '1',
          name: 't1',
          content: 'Result 1',
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
      ];

      const managed = await ContextManager.getManagedContext(history, null, 'Sys', 100000);
      const activeWindowMsgs = managed.messages.filter((m) => m.role !== MessageRole.SYSTEM);
      expect(activeWindowMsgs.length).toBe(3);
      expect(activeWindowMsgs[1].role).toBe(MessageRole.ASSISTANT);
      expect(activeWindowMsgs[2].role).toBe(MessageRole.TOOL);
    });

    it('should return recent messages that fit the limit', async () => {
      const history: Message[] = [
        {
          role: MessageRole.USER,
          content: 'Old message 1',
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
        {
          role: MessageRole.ASSISTANT,
          content: 'Old message 2',
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
        {
          role: MessageRole.USER,
          content: 'New message',
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
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
        [{ role: MessageRole.USER, content: 'Test', traceId: 'test-trace', messageId: 'test-msg' }],
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

    it('should apply provider-specific toolResultPriority', () => {
      const msg = {
        role: MessageRole.TOOL,
        content: 'Success',
        traceId: 'test-trace',
        messageId: 'test-msg',
      } as Message;

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

    it('should propagate traceId to generated system messages', async () => {
      const history: Message[] = [
        {
          role: MessageRole.USER,
          content: 'User message',
          traceId: 'original-trace',
          messageId: 'm1',
        },
      ];
      const traceId = 'new-trace-id';
      const managed = await ContextManager.getManagedContext(
        history,
        'summary',
        'System prompt',
        100000,
        {},
        traceId
      );

      const systemMessages = managed.messages.filter((m) => m.role === MessageRole.SYSTEM);
      expect(systemMessages.length).toBeGreaterThan(0);
      systemMessages.forEach((m) => {
        expect(m.traceId).toBe(traceId);
      });
    });
  });

  describe('needsSummarization', () => {
    it('should return true if history exceeds trigger ratio', async () => {
      const longMessage = 'A'.repeat(9000);
      const history: Message[] = [
        {
          role: MessageRole.USER,
          content: longMessage,
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
      ];
      expect(await ContextManager.needsSummarization(history, 2000)).toBe(true);
    });

    it('should return false if history is below trigger ratio', async () => {
      const history: Message[] = [
        { role: MessageRole.USER, content: 'Hello', traceId: 'test-trace', messageId: 'test-msg' },
      ];
      expect(await ContextManager.needsSummarization(history, 10000)).toBe(false);
    });

    it('should respect custom trigger ratio', async () => {
      const history: Message[] = [
        {
          role: MessageRole.USER,
          content: 'A'.repeat(7500),
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
      ];
      expect(await ContextManager.needsSummarization(history, 5000, 0.4)).toBe(true);
      expect(await ContextManager.needsSummarization(history, 5000, 0.6)).toBe(false);
    });
  });

  describe('summarize', () => {
    it('should update summary when provider returns content', async () => {
      const mockMemory = {
        getSummary: vi.fn().mockResolvedValue('old summary'),
        updateSummary: vi.fn().mockResolvedValue(undefined),
      };
      const mockProvider = {
        call: vi.fn().mockResolvedValue({
          content: 'new summary content',
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      };

      await ContextManager.summarize(mockMemory as any, 'user1', mockProvider as any, [
        { role: MessageRole.USER, content: 'hello', traceId: 'test-trace', messageId: 'test-msg' },
      ]);

      expect(mockMemory.updateSummary).toHaveBeenCalledWith('user1', 'new summary content');
    });

    it('should not update summary when provider returns no content', async () => {
      const mockMemory = {
        getSummary: vi.fn().mockResolvedValue(null),
        updateSummary: vi.fn().mockResolvedValue(undefined),
      };
      const mockProvider = {
        call: vi.fn().mockResolvedValue({ content: null, usage: undefined }),
      };

      await ContextManager.summarize(mockMemory as any, 'user1', mockProvider as any, [
        { role: MessageRole.USER, content: 'hello', traceId: 'test-trace', messageId: 'test-msg' },
      ]);

      expect(mockMemory.updateSummary).not.toHaveBeenCalled();
    });

    it('should propagate traceId during summarization', async () => {
      const mockMemory = {
        getSummary: vi.fn().mockResolvedValue(null),
        updateSummary: vi.fn().mockResolvedValue(undefined),
      };
      const mockProvider = {
        call: vi.fn().mockResolvedValue({ content: 'new', usage: undefined }),
      };
      const traceId = 'summarize-trace';

      await ContextManager.summarize(mockMemory as any, 'user1', mockProvider as any, [], traceId);

      const callArgs = mockProvider.call.mock.calls[0];
      expect(callArgs[0][0].traceId).toBe(traceId);
    });
  });

  describe('isToolError', () => {
    it('should detect error patterns', () => {
      expect(ContextManager.isToolError('Error: something went wrong')).toBe(true);
      expect(ContextManager.isToolError('FAILED: build error')).toBe(true);
      expect(ContextManager.isToolError('exit code 1')).toBe(true);
      expect(ContextManager.isToolError('Exception occurred')).toBe(true);
    });

    it('should return false for non-error content', () => {
      expect(ContextManager.isToolError('Success')).toBe(false);
      expect(ContextManager.isToolError('File created')).toBe(false);
    });
  });
});
