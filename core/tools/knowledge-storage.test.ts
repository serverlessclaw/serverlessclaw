import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GapStatus } from '../lib/types/agent';
import { InsightCategory } from '../lib/types/memory';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  RECALL_KNOWLEDGE,
  MANAGE_GAP,
  SAVE_MEMORY,
  PRUNE_MEMORY,
  INSPECT_TRACE,
  DISCOVER_SKILLS,
  INSTALL_SKILL,
  UNINSTALL_SKILL,
  REPORT_GAP,
} from './knowledge-storage';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

// Hoist mocks
const mocks = vi.hoisted(() => ({
  updateGapStatus: vi.fn().mockResolvedValue(undefined),
  getDistilledMemory: vi.fn().mockResolvedValue(''),
  updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
  setGap: vi.fn().mockResolvedValue(undefined),
  addMemory: vi.fn().mockResolvedValue(123456789),
  recordMemoryHit: vi.fn().mockResolvedValue(undefined),
  deleteItem: vi.fn().mockResolvedValue(undefined),
  searchInsights: vi.fn().mockResolvedValue({
    items: [
      {
        id: 'insight-1',
        timestamp: 123,
        content: 'insight 1',
        metadata: { category: 'lesson', impact: 10, urgency: 10 },
      },
    ],
  }),
}));

// Mock DynamoMemory
vi.mock('../lib/memory', () => ({
  DynamoMemory: vi.fn().mockImplementation(function () {
    return {
      searchInsights: mocks.searchInsights,
      updateGapStatus: mocks.updateGapStatus,
      getDistilledMemory: mocks.getDistilledMemory,
      updateDistilledMemory: mocks.updateDistilledMemory,
      setGap: mocks.setGap,
      addMemory: mocks.addMemory,
      recordMemoryHit: mocks.recordMemoryHit,
      deleteItem: mocks.deleteItem,
    };
  }),
}));

// Mock Tracer
vi.mock('../lib/tracer', () => ({
  ClawTracer: {
    getTrace: vi.fn().mockResolvedValue([
      {
        nodeId: 'node-1',
        status: 'completed',
        steps: [{ timestamp: Date.now(), type: 'llm_call', content: 'hello' }],
      },
    ]),
  },
}));

// Mock SkillRegistry
vi.mock('../lib/skills', () => ({
  SkillRegistry: {
    discoverSkills: vi.fn().mockResolvedValue([{ name: 'test-skill', description: 'test desc' }]),
    installSkill: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock AgentRegistry
vi.mock('../lib/registry', () => ({
  AgentRegistry: {
    getRawConfig: vi.fn().mockResolvedValue(['test-skill']),
  },
}));

// Mock ConfigManager
vi.mock('../lib/registry/config', () => ({
  ConfigManager: {
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('knowledge-storage tools', () => {
  beforeEach(() => {
    ddbMock.reset();
    ebMock.reset();
    vi.clearAllMocks();
  });

  describe('RECALL_KNOWLEDGE', () => {
    it('should return search results from memory', async () => {
      const result = await RECALL_KNOWLEDGE.execute({
        userId: 'user-1',
        query: 'test',
        category: 'tactical_lesson',
      });
      expect(result).toContain('insight 1');
      expect(mocks.searchInsights).toHaveBeenCalledWith('user-1', 'test', 'tactical_lesson');
    });

    it('should search both prefixed and raw for user_preference', async () => {
      await RECALL_KNOWLEDGE.execute({
        userId: 'user-1',
        query: 'coffee',
        category: 'user_preference',
      });
      expect(mocks.searchInsights).toHaveBeenCalledWith('USER#user-1', 'coffee', 'user_preference');
      expect(mocks.searchInsights).toHaveBeenCalledWith('user-1', 'coffee', 'user_preference');
    });
  });

  describe('MANAGE_GAP', () => {
    it('should update gap status in memory', async () => {
      const result = await MANAGE_GAP.execute({ gapId: 'gap-1', status: GapStatus.PLANNED });
      expect(result).toContain('Successfully updated gap gap-1 to PLANNED');
      expect(mocks.updateGapStatus).toHaveBeenCalledWith('gap-1', GapStatus.PLANNED);
    });
  });

  describe('SAVE_MEMORY', () => {
    it('should save user preference to memory with semantic deduplication attempt', async () => {
      // Mock search for deduplication check
      mocks.searchInsights
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [] });

      const result = await SAVE_MEMORY.execute({
        userId: 'user-1',
        content: 'likes coffee',
        category: 'user_preference',
      });
      expect(result).toContain('Successfully saved knowledge as MEMORY:USER_PREFERENCE');
      expect(mocks.addMemory).toHaveBeenCalledWith(
        'USER#user-1',
        InsightCategory.USER_PREFERENCE,
        'likes coffee',
        expect.any(Object)
      );
    });

    it('should save general knowledge as system memory', async () => {
      const result = await SAVE_MEMORY.execute({
        userId: 'user-1',
        content: 'new fact',
        category: 'system_knowledge',
      });
      expect(result).toContain('Successfully saved knowledge as MEMORY:SYSTEM_KNOWLEDGE');
      expect(mocks.addMemory).toHaveBeenCalledWith(
        'SYSTEM#GLOBAL',
        InsightCategory.SYSTEM_KNOWLEDGE,
        'new fact',
        expect.any(Object)
      );
    });
  });

  describe('PRUNE_MEMORY', () => {
    it('should permanently delete a memory item from DDB', async () => {
      const result = await PRUNE_MEMORY.execute({
        partitionKey: 'LESSON#user-1',
        timestamp: 123456,
      });

      expect(result).toContain('Successfully pruned memory item');
      expect(mocks.deleteItem).toHaveBeenCalledWith({
        userId: 'LESSON#user-1',
        timestamp: 123456,
      });
    });
  });

  describe('INSPECT_TRACE', () => {
    it('should return trace summary', async () => {
      const result = await INSPECT_TRACE.execute({ traceId: 'trace-1' });
      expect(result).toContain('--- NODE: node-1');
      expect(result).toContain('[LLM_CALL] hello');
    });
  });

  describe('DISCOVER_SKILLS', () => {
    it('should list matching skills', async () => {
      const result = await DISCOVER_SKILLS.execute({ query: 'test' });
      expect(result).toContain('Found 1 matching skills');
      expect(result).toContain('test-skill: test desc');
    });
  });

  describe('INSTALL_SKILL', () => {
    it('should install skill for target agent', async () => {
      const result = await INSTALL_SKILL.execute({ skillName: 'test-skill', agentId: 'coder' });
      expect(result).toContain("Skill 'test-skill' successfully installed for agent coder");
    });
  });

  describe('UNINSTALL_SKILL', () => {
    it('should uninstall skill for target agent', async () => {
      const result = await UNINSTALL_SKILL.execute({ skillName: 'test-skill', agentId: 'coder' });
      expect(result).toContain("Successfully uninstalled skill 'test-skill' from agent coder");
    });

    it('should fail if skill is not installed', async () => {
      const { AgentRegistry } = await import('../lib/registry');
      vi.mocked(AgentRegistry.getRawConfig).mockResolvedValueOnce([]);

      const result = await UNINSTALL_SKILL.execute({ skillName: 'wrong-skill', agentId: 'coder' });
      expect(result).toContain("FAILED: Skill 'wrong-skill' is not installed");
    });
  });

  describe('REPORT_GAP', () => {
    it('should record gap and emit EVOLUTION_PLAN event', async () => {
      ebMock.on(PutEventsCommand).resolves({});

      const result = await REPORT_GAP.execute({
        userId: 'user-1',
        content: 'missing feature X',
        impact: 10,
        urgency: 8,
      });

      expect(result).toContain('Successfully recorded new gap');
      expect(mocks.addMemory).toHaveBeenCalledWith(
        'SYSTEM#GLOBAL',
        InsightCategory.STRATEGIC_GAP,
        'missing feature X',
        expect.objectContaining({ impact: 10, urgency: 8 })
      );
      expect(ebMock.calls().length).toBe(1);
    });
  });
});
