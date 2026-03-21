import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TraceSource, GapStatus } from '../lib/types/agent';
import { InsightCategory } from '../lib/types/memory';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  LIST_AGENTS,
  RECALL_KNOWLEDGE,
  MANAGE_AGENT_TOOLS,
  DISPATCH_TASK,
  MANAGE_GAP,
  SAVE_MEMORY,
} from './knowledge';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

// Hoist mocks
const mocks = vi.hoisted(() => ({
  updateGapStatus: vi.fn().mockResolvedValue(undefined),
  getDistilledMemory: vi.fn().mockResolvedValue(''),
  updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
  setGap: vi.fn().mockResolvedValue(undefined),
  addMemory: vi.fn().mockResolvedValue(1),
  recordMemoryHit: vi.fn().mockResolvedValue(undefined),
  deleteItem: vi.fn().mockResolvedValue(undefined),
}));

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'test-config-table' },
    AgentBus: { name: 'test-bus' },
  },
}));

// Mock DynamoMemory
vi.mock('../lib/memory', () => ({
  DynamoMemory: vi.fn().mockImplementation(function () {
    return {
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

// Mock AgentRegistry
vi.mock('../lib/registry', () => ({
  AgentRegistry: {
    getAllConfigs: vi.fn().mockResolvedValue({
      main: { id: 'main', name: 'Main', description: 'desc', enabled: true, isBackbone: true },
    }),
    getAgentConfig: vi.fn().mockResolvedValue({ enabled: true, id: 'coder' }),
  },
}));

// Mock Tracer
vi.mock('../lib/tracer', () => ({
  ClawTracer: class {
    constructor(
      public userId: string,
      public source: TraceSource,
      public traceId: string,
      public nodeId: string
    ) {}
    getTraceId = vi.fn().mockReturnValue('trace-123');
    getNodeId = vi.fn().mockReturnValue('node-parent');
    getParentId = vi.fn().mockReturnValue(undefined);
    getChildTracer = vi.fn().mockReturnValue({
      getTraceId: () => 'trace-123',
      getNodeId: () => 'node-child',
      getParentId: () => 'node-parent',
    });
  },
}));

describe('knowledge tools', () => {
  beforeEach(() => {
    ddbMock.reset();
    ebMock.reset();
    vi.clearAllMocks();
  });

  describe('LIST_AGENTS', () => {
    it('should return a summary of agents excluding main', async () => {
      // Mock AgentRegistry.getAllConfigs via the file mock
      const { AgentRegistry } = await import('../lib/registry');
      vi.mocked(AgentRegistry.getAllConfigs).mockResolvedValueOnce({
        main: { id: 'main', name: 'Main', enabled: true, description: 'desc' } as any,
        coder: { id: 'coder', name: 'Coder', enabled: true, description: 'dev' } as any,
      });

      const result = await LIST_AGENTS.execute();
      expect(result).toContain('[coder] Coder: dev');
      expect(result).not.toContain('[main] Main');
    });
  });

  describe('RECALL_KNOWLEDGE', () => {
    it('should return search results from memory', async () => {
      const result = await RECALL_KNOWLEDGE.execute({
        userId: 'user-1',
        query: 'test',
        category: 'tactical_lesson',
      });
      expect(result).toContain('insight 1');
    });
  });

  describe('MANAGE_AGENT_TOOLS', () => {
    it('should update agent tools in DDB', async () => {
      ddbMock.on(PutCommand).resolves({});

      const result = await MANAGE_AGENT_TOOLS.execute({ agentId: 'main', toolNames: ['tool1'] });

      expect(result).toContain('Successfully updated tools');
      expect(ddbMock.calls()).toHaveLength(1);
    });
  });

  describe('DISPATCH_TASK', () => {
    it('should branch trace and dispatch task via EventBridge', async () => {
      ebMock.on(PutEventsCommand).resolves({});

      const result = await DISPATCH_TASK.execute({
        agentId: 'coder',
        userId: 'user-1',
        task: 'build something',
        traceId: 'trace-123',
        nodeId: 'node-parent',
      });

      expect(result).toContain('I have successfully dispatched this task');

      const ebCalls = ebMock.commandCalls(PutEventsCommand);
      expect(ebCalls).toHaveLength(1);

      const payload = JSON.parse(ebCalls[0].args[0].input.Entries![0].Detail!);
      expect(payload).toMatchObject({
        traceId: 'trace-123',
        nodeId: 'node-child',
        parentId: 'node-parent',
        task: 'build something',
      });
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
    // Renamed from saveKnowledge
    it('should save user preference to memory', async () => {
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
      const { PRUNE_MEMORY } = await import('./knowledge-storage');
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

    it('should fail if partitionKey or timestamp is missing', async () => {
      const { PRUNE_MEMORY } = await import('./knowledge-storage');
      const result = await PRUNE_MEMORY.execute({
        partitionKey: 'LESSON#user-1',
      });

      expect(result).toContain('FAILED');
      expect(mocks.deleteItem).not.toHaveBeenCalled();
    });
  });
});
