import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GapStatus, MessageRole } from '../../lib/types/index';
import type { IMemory, Message, MemoryInsight } from '../../lib/types/index';

/**
 * Prompts Module Tests
 *
 * Tests for core/agents/cognition-reflector/prompts.ts
 * Covers: buildReflectionPrompt, getGapContext
 */

// ============================================================================
// Mock Setup
// ============================================================================

function createMockMemory(overrides: Partial<IMemory> = {}): IMemory {
  return {
    getDistilledMemory: vi.fn().mockResolvedValue('Existing fact 1'),
    updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
    getAllGaps: vi.fn().mockResolvedValue([]),
    searchInsights: vi.fn().mockResolvedValue({ items: [] }),
    archiveStaleGaps: vi.fn().mockResolvedValue(0),
    getLowUtilizationMemory: vi.fn().mockResolvedValue([]),
    getFailedPlans: vi.fn().mockResolvedValue([]),
    getFailurePatterns: vi.fn().mockResolvedValue([]),
    getGlobalLessons: vi.fn().mockResolvedValue([]),
    addLesson: vi.fn().mockResolvedValue(undefined),
    addGlobalLesson: vi.fn().mockResolvedValue(0),
    recordFailurePattern: vi.fn().mockResolvedValue(0),
    refineMemory: vi.fn().mockResolvedValue(undefined),
    getLessons: vi.fn().mockResolvedValue([]),
    setGap: vi.fn().mockResolvedValue(undefined),
    updateGapStatus: vi.fn().mockResolvedValue(undefined),
    incrementGapAttemptCount: vi.fn().mockResolvedValue(1),
    acquireGapLock: vi.fn().mockResolvedValue(true),
    releaseGapLock: vi.fn().mockResolvedValue(undefined),
    getGapLock: vi.fn().mockResolvedValue(null),
    updateGapMetadata: vi.fn().mockResolvedValue(undefined),
    recordFailedPlan: vi.fn().mockResolvedValue(0),
    addMemory: vi.fn().mockResolvedValue(0),
    updateInsightMetadata: vi.fn().mockResolvedValue(undefined),
    listByPrefix: vi.fn().mockResolvedValue([]),
    getHistory: vi.fn().mockResolvedValue([]),
    addMessage: vi.fn().mockResolvedValue(undefined),
    clearHistory: vi.fn().mockResolvedValue(undefined),
    listConversations: vi.fn().mockResolvedValue([]),
    saveConversationMeta: vi.fn().mockResolvedValue(undefined),
    deleteConversation: vi.fn().mockResolvedValue(undefined),
    getSummary: vi.fn().mockResolvedValue(null),
    updateSummary: vi.fn().mockResolvedValue(undefined),
    saveClarificationRequest: vi.fn().mockResolvedValue(undefined),
    getClarificationRequest: vi.fn().mockResolvedValue(null),
    updateClarificationStatus: vi.fn().mockResolvedValue(undefined),
    saveEscalationState: vi.fn().mockResolvedValue(undefined),
    getEscalationState: vi.fn().mockResolvedValue(null),
    findExpiredClarifications: vi.fn().mockResolvedValue([]),
    incrementClarificationRetry: vi.fn().mockResolvedValue(0),
    getCollaboration: vi.fn().mockResolvedValue(null),
    checkCollaborationAccess: vi.fn().mockResolvedValue(true),
    closeCollaboration: vi.fn().mockResolvedValue(undefined),
    createCollaboration: vi.fn().mockResolvedValue({} as any),
    listCollaborationsForParticipant: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as IMemory;
}

// ============================================================================
// Tests: buildReflectionPrompt
// ============================================================================

describe('buildReflectionPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should build a complete prompt with all context sections', async () => {
    const { buildReflectionPrompt } = await import('./prompts');
    const memory = createMockMemory({
      getDistilledMemory: vi.fn().mockResolvedValue('User name is Peng'),
    });

    const conversation: Message[] = [
      { role: MessageRole.USER, content: 'Build me a dashboard', traceId: 't1', messageId: 'm1' },
      {
        role: MessageRole.ASSISTANT,
        content: 'I created the dashboard component',
        traceId: 't1',
        messageId: 'm2',
      },
    ];
    const traceContext = 'TRACE: agent=coder, duration=5s';
    const deployedGaps = [{ id: 'GAP#001', content: 'Missing chart library' }];
    const activeGaps = [{ content: 'Need auth module' }];

    const result = await buildReflectionPrompt(
      memory,
      'user-1',
      conversation,
      traceContext,
      deployedGaps,
      activeGaps
    );

    expect(result).toContain('User name is Peng');
    expect(result).toContain('USER: Build me a dashboard');
    expect(result).toContain('ASSISTANT: I created the dashboard component');
    expect(result).toContain('TRACE: agent=coder, duration=5s');
    expect(result).toContain('RECENTLY DEPLOYED CHANGES');
    expect(result).toContain('[ID: 001] Missing chart library');
    expect(result).toContain('GAPS ALREADY IN PROGRESS');
    expect(result).toContain('Need auth module');
    expect(result).toContain('Analyze the CONVERSATION and EXECUTION TRACE');
  });

  it('should call getDistilledMemory with the correct userId', async () => {
    const { buildReflectionPrompt } = await import('./prompts');
    const getDistilledMemory = vi.fn().mockResolvedValue('facts');
    const memory = createMockMemory({ getDistilledMemory });

    await buildReflectionPrompt(memory, 'base-user-42', [], '', [], []);

    expect(getDistilledMemory).toHaveBeenCalledWith('base-user-42');
  });

  // --------------------------------------------------------------------------
  // Memory context
  // --------------------------------------------------------------------------

  describe('memory context', () => {
    it('should include existing facts from memory', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory({
        getDistilledMemory: vi.fn().mockResolvedValue('Project uses TypeScript'),
      });

      const result = await buildReflectionPrompt(memory, 'user-1', [], '', [], []);

      expect(result).toContain('EXISTING FACTS:');
      expect(result).toContain('Project uses TypeScript');
    });

    it('should show "None" when no facts exist', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory({
        getDistilledMemory: vi.fn().mockResolvedValue(''),
      });

      const result = await buildReflectionPrompt(memory, 'user-1', [], '', [], []);

      expect(result).toContain('EXISTING FACTS:');
      expect(result).toContain('None');
    });

    it('should show "None" when memory returns null', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory({
        getDistilledMemory: vi.fn().mockResolvedValue(null as any),
      });

      const result = await buildReflectionPrompt(memory, 'user-1', [], '', [], []);

      expect(result).toContain('None');
    });
  });

  // --------------------------------------------------------------------------
  // Conversation context
  // --------------------------------------------------------------------------

  describe('conversation context', () => {
    it('should include user and assistant messages', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();
      const conversation: Message[] = [
        { role: MessageRole.USER, content: 'Hello', traceId: 't1', messageId: 'm1' },
        { role: MessageRole.ASSISTANT, content: 'Hi there', traceId: 't1', messageId: 'm2' },
      ];

      const result = await buildReflectionPrompt(memory, 'user-1', conversation, '', [], []);

      expect(result).toContain('USER: Hello');
      expect(result).toContain('ASSISTANT: Hi there');
    });

    it('should render tool calls as [Tool Calls] when content is absent', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();
      const conversation: Message[] = [
        {
          role: MessageRole.ASSISTANT,
          content: '',
          traceId: 't1',
          messageId: 'm1',
          tool_calls: [
            { id: 'call-1', type: 'function', function: { name: 'search', arguments: '{}' } },
          ],
        },
      ];

      const result = await buildReflectionPrompt(memory, 'user-1', conversation, '', [], []);

      expect(result).toContain('[Tool Calls]');
    });

    it('should handle empty conversation array', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();

      const result = await buildReflectionPrompt(memory, 'user-1', [], '', [], []);

      expect(result).toContain('CONVERSATION:');
      expect(result).toContain('Analyze the CONVERSATION and EXECUTION TRACE');
    });

    it('should handle multi-turn conversation', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();
      const conversation: Message[] = [
        { role: MessageRole.USER, content: 'First question', traceId: 't1', messageId: 'm1' },
        { role: MessageRole.ASSISTANT, content: 'First answer', traceId: 't1', messageId: 'm2' },
        { role: MessageRole.USER, content: 'Follow up', traceId: 't1', messageId: 'm3' },
        {
          role: MessageRole.ASSISTANT,
          content: 'Follow up answer',
          traceId: 't1',
          messageId: 'm4',
        },
      ];

      const result = await buildReflectionPrompt(memory, 'user-1', conversation, '', [], []);

      expect(result).toContain('USER: First question');
      expect(result).toContain('ASSISTANT: First answer');
      expect(result).toContain('USER: Follow up');
      expect(result).toContain('ASSISTANT: Follow up answer');
    });
  });

  // --------------------------------------------------------------------------
  // Trace context
  // --------------------------------------------------------------------------

  describe('trace context', () => {
    it('should include trace context in the prompt', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();
      const traceContext = 'TRACE: agent=main -> coder -> critic, total=12s';

      const result = await buildReflectionPrompt(memory, 'user-1', [], traceContext, [], []);

      expect(result).toContain('TRACE: agent=main -> coder -> critic, total=12s');
    });

    it('should handle empty trace context', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();

      const result = await buildReflectionPrompt(memory, 'user-1', [], '', [], []);

      expect(result).toContain('Analyze the CONVERSATION and EXECUTION TRACE');
    });
  });

  // --------------------------------------------------------------------------
  // Deployed gaps
  // --------------------------------------------------------------------------

  describe('deployed gaps', () => {
    it('should include deployed gaps section with audit task', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();
      const deployedGaps = [
        { id: 'GAP#1001', content: 'Added Slack integration' },
        { id: 'GAP#1002', content: 'Added retry logic' },
      ];

      const result = await buildReflectionPrompt(memory, 'user-1', [], '', deployedGaps, []);

      expect(result).toContain('RECENTLY DEPLOYED CHANGES (Audit required):');
      expect(result).toContain('[ID: 1001] Added Slack integration');
      expect(result).toContain('[ID: 1002] Added retry logic');
      expect(result).toContain('resolvedGapIds');
    });

    it('should strip GAP# prefix from deployed gap IDs', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();
      const deployedGaps = [{ id: 'GAP#42', content: 'Some fix' }];

      const result = await buildReflectionPrompt(memory, 'user-1', [], '', deployedGaps, []);

      expect(result).toContain('[ID: 42]');
      expect(result).not.toContain('[ID: GAP#42]');
    });

    it('should not include deployed gaps section when empty', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();

      const result = await buildReflectionPrompt(memory, 'user-1', [], '', [], []);

      expect(result).not.toContain('RECENTLY DEPLOYED CHANGES');
    });
  });

  // --------------------------------------------------------------------------
  // Active gaps
  // --------------------------------------------------------------------------

  describe('active gaps', () => {
    it('should include active gaps section with deduplication warning', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();
      const activeGaps = [{ content: 'Missing error handling' }, { content: 'No rate limiting' }];

      const result = await buildReflectionPrompt(memory, 'user-1', [], '', [], activeGaps);

      expect(result).toContain('GAPS ALREADY IN PROGRESS (Do not duplicate):');
      expect(result).toContain('Missing error handling');
      expect(result).toContain('No rate limiting');
      expect(result).toContain('DEDUPLICATION');
    });

    it('should not include active gaps section when empty', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();

      const result = await buildReflectionPrompt(memory, 'user-1', [], '', [], []);

      expect(result).not.toContain('GAPS ALREADY IN PROGRESS (Do not duplicate):');
    });
  });

  // --------------------------------------------------------------------------
  // Failure patterns
  // --------------------------------------------------------------------------

  describe('failure patterns', () => {
    it('should include failure patterns with chronic issue task', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();
      const failurePatterns: MemoryInsight[] = [
        {
          id: 'fp-1',
          content: 'Timeout on large payloads',
          metadata: {} as any,
          timestamp: Date.now(),
        },
        {
          id: 'fp-2',
          content: 'Memory leak in stream handler',
          metadata: {} as any,
          timestamp: Date.now(),
        },
      ];

      const result = await buildReflectionPrompt(memory, 'user-1', [], '', [], [], failurePatterns);

      expect(result).toContain('KNOWN FAILURE PATTERNS (Cross-reference current issues):');
      expect(result).toContain('Timeout on large payloads');
      expect(result).toContain('Memory leak in stream handler');
      expect(result).toContain('CHRONIC ISSUE');
    });

    it('should not include failure patterns section when empty', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();

      const result = await buildReflectionPrompt(memory, 'user-1', [], '', [], [], []);

      expect(result).not.toContain('KNOWN FAILURE PATTERNS');
    });

    it('should default failurePatterns to empty array', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();

      // Calling without the 7th parameter should not throw
      const result = await buildReflectionPrompt(memory, 'user-1', [], '', [], []);

      expect(result).not.toContain('KNOWN FAILURE PATTERNS');
    });
  });

  // --------------------------------------------------------------------------
  // Prompt structure / completeness
  // --------------------------------------------------------------------------

  describe('prompt structure', () => {
    it('should include the JSON schema for expected response', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();

      const result = await buildReflectionPrompt(memory, 'user-1', [], '', [], []);

      expect(result).toContain('"facts"');
      expect(result).toContain('"lessons"');
      expect(result).toContain('"gaps"');
      expect(result).toContain('"updatedGaps"');
      expect(result).toContain('"resolvedGapIds"');
    });

    it('should include instructions about facts extraction', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();

      const result = await buildReflectionPrompt(memory, 'user-1', [], '', [], []);

      expect(result).toContain('DECLARATIVE statements');
      expect(result).toContain('TECHNICAL TRUTHS');
    });

    it('should include deduplication instructions', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();

      const result = await buildReflectionPrompt(memory, 'user-1', [], '', [], []);

      expect(result).toContain('DEDUPLICATION');
      expect(result).toContain('updatedGaps');
    });

    it('should return a string', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();

      const result = await buildReflectionPrompt(memory, 'user-1', [], '', [], []);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Minimal / edge inputs
  // --------------------------------------------------------------------------

  describe('minimal inputs', () => {
    it('should build prompt with all optional sections empty', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory({
        getDistilledMemory: vi.fn().mockResolvedValue(''),
      });

      const result = await buildReflectionPrompt(memory, 'user-1', [], '', [], []);

      expect(result).toContain('EXISTING FACTS:');
      expect(result).toContain('CONVERSATION:');
      expect(result).toContain('Analyze the CONVERSATION');
      expect(result).not.toContain('RECENTLY DEPLOYED');
      expect(result).not.toContain('GAPS ALREADY IN PROGRESS (Do not duplicate):');
      expect(result).not.toContain('KNOWN FAILURE');
    });

    it('should handle conversation with messages that have no content and no tool_calls', async () => {
      const { buildReflectionPrompt } = await import('./prompts');
      const memory = createMockMemory();
      const conversation: Message[] = [
        { role: MessageRole.USER, content: '', traceId: 't1', messageId: 'm1' },
        { role: MessageRole.ASSISTANT, content: '', traceId: 't1', messageId: 'm2' },
      ];

      const result = await buildReflectionPrompt(memory, 'user-1', conversation, '', [], []);

      expect(result).toContain('USER:');
      expect(result).toContain('ASSISTANT:');
    });
  });
});

// ============================================================================
// Tests: getGapContext
// ============================================================================

describe('getGapContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return deployed and active gaps', async () => {
    const { getGapContext } = await import('./prompts');
    const deployedGaps = [
      {
        id: 'GAP#001',
        content: 'Deployed gap 1',
        metadata: {} as any,
        timestamp: Date.now(),
      },
    ];
    const plannedGaps = [
      {
        id: 'GAP#002',
        content: 'Planned gap',
        metadata: {} as any,
        timestamp: Date.now(),
      },
    ];
    const progressGaps = [
      {
        id: 'GAP#003',
        content: 'In progress gap',
        metadata: {} as any,
        timestamp: Date.now(),
      },
    ];

    const memory = createMockMemory({
      getAllGaps: vi.fn().mockImplementation((status?: string) => {
        if (status === GapStatus.DEPLOYED) return Promise.resolve(deployedGaps);
        if (status === GapStatus.PLANNED) return Promise.resolve(plannedGaps);
        if (status === GapStatus.PROGRESS) return Promise.resolve(progressGaps);
        return Promise.resolve([]);
      }),
    });

    const result = await getGapContext(memory);

    expect(result.deployedGaps).toEqual(deployedGaps);
    expect(result.activeGaps).toHaveLength(2);
    expect(result.activeGaps).toEqual([...plannedGaps, ...progressGaps]);
  });

  it('should call getAllGaps with correct statuses', async () => {
    const { getGapContext } = await import('./prompts');
    const getAllGaps = vi.fn().mockResolvedValue([]);
    const memory = createMockMemory({ getAllGaps });

    await getGapContext(memory);

    expect(getAllGaps).toHaveBeenCalledWith(GapStatus.DEPLOYED);
    expect(getAllGaps).toHaveBeenCalledWith(GapStatus.PLANNED);
    expect(getAllGaps).toHaveBeenCalledWith(GapStatus.PROGRESS);
    expect(getAllGaps).toHaveBeenCalledTimes(3);
  });

  it('should return empty arrays when no gaps exist', async () => {
    const { getGapContext } = await import('./prompts');
    const memory = createMockMemory({
      getAllGaps: vi.fn().mockResolvedValue([]),
    });

    const result = await getGapContext(memory);

    expect(result.deployedGaps).toEqual([]);
    expect(result.activeGaps).toEqual([]);
  });

  it('should combine planned and progress gaps into activeGaps', async () => {
    const { getGapContext } = await import('./prompts');
    const planned = [{ id: 'GAP#P1', content: 'planned', metadata: {} as any, timestamp: 1 }];
    const progress = [{ id: 'GAP#PR1', content: 'progress', metadata: {} as any, timestamp: 2 }];

    const memory = createMockMemory({
      getAllGaps: vi.fn().mockImplementation((status?: string) => {
        if (status === GapStatus.PLANNED) return Promise.resolve(planned);
        if (status === GapStatus.PROGRESS) return Promise.resolve(progress);
        return Promise.resolve([]);
      }),
    });

    const result = await getGapContext(memory);

    expect(result.activeGaps).toHaveLength(2);
    expect(result.activeGaps[0]).toEqual(planned[0]);
    expect(result.activeGaps[1]).toEqual(progress[0]);
  });
});
