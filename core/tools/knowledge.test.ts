import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TraceSource } from '../lib/types';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  getAgentRegistrySummary,
  recallKnowledge,
  manageAgentTools,
  dispatchTask,
  manageGap,
  saveMemory, // Renamed from saveKnowledge
} from './knowledge';
import { GapStatus, InsightCategory } from '../lib/types/index';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

// Hoist mocks
const mocks = vi.hoisted(() => ({
  updateGapStatus: vi.fn().mockResolvedValue(undefined),
  getDistilledMemory: vi.fn().mockResolvedValue(''),
  updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
  setGap: vi.fn().mockResolvedValue(undefined),
  addInsight: vi.fn().mockResolvedValue(123456), // reportGap still uses addInsight
  addMemory: vi.fn().mockResolvedValue(123456), // saveMemory now uses addMemory
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
      searchInsights: vi
        .fn()
        .mockResolvedValue([
          { content: 'insight 1', metadata: { category: 'lesson', impact: 10, urgency: 10 } },
        ]),
      updateGapStatus: mocks.updateGapStatus,
      getDistilledMemory: mocks.getDistilledMemory,
      updateDistilledMemory: mocks.updateDistilledMemory,
      setGap: mocks.setGap,
      addInsight: mocks.addInsight, // reportGap still uses addInsight
      addMemory: mocks.addMemory, // saveMemory now uses addMemory
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

  describe('getAgentRegistrySummary', () => {
    it('should return a summary of agents', async () => {
      const result = await getAgentRegistrySummary.execute();
      expect(result).toContain('[main] Main');
    });
  });

  describe('recallKnowledge', () => {
    it('should return search results from memory', async () => {
      const result = await recallKnowledge.execute({
        userId: 'user-1',
        query: 'test',
        category: 'tactical_lesson',
      });
      expect(result).toContain('insight 1');
    });
  });

  describe('manageAgentTools', () => {
    it('should update agent tools in DDB', async () => {
      ddbMock.on(PutCommand).resolves({});

      const result = await manageAgentTools.execute({ agentId: 'main', toolNames: ['tool1'] });

      expect(result).toContain('Successfully updated tools');
      expect(ddbMock.calls()).toHaveLength(1);
    });
  });

  describe('dispatchTask', () => {
    it('should branch trace and dispatch task via EventBridge', async () => {
      ebMock.on(PutEventsCommand).resolves({});

      const result = await dispatchTask.execute({
        agentId: 'coder',
        userId: 'user-1',
        task: 'build something',
        traceId: 'trace-123',
        nodeId: 'node-parent',
      });

      expect(result).toContain('Task successfully dispatched');

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

  describe('manageGap', () => {
    it('should update gap status in memory', async () => {
      const result = await manageGap.execute({ gapId: 'gap-1', status: GapStatus.PLANNED });
      expect(result).toContain('Successfully updated gap gap-1 to PLANNED');
      expect(mocks.updateGapStatus).toHaveBeenCalledWith('gap-1', GapStatus.PLANNED);
    });
  });

  describe('saveMemory', () => {
    // Renamed from saveKnowledge
    it('should save user preference to memory', async () => {
      const result = await saveMemory.execute({
        userId: 'user-1',
        content: 'likes coffee',
        category: 'user_preference',
      });
      expect(result).toContain('Successfully saved user preference');
      expect(mocks.addMemory).toHaveBeenCalledWith(
        'USER#user-1',
        InsightCategory.USER_PREFERENCE,
        'likes coffee'
      );
    });

    it('should save general knowledge as system memory', async () => {
      const result = await saveMemory.execute({
        userId: 'user-1',
        content: 'new fact',
        category: 'system_knowledge',
      });
      expect(result).toContain('Successfully saved knowledge');
      expect(mocks.addMemory).toHaveBeenCalledWith(
        'SYSTEM#GLOBAL',
        InsightCategory.SYSTEM_KNOWLEDGE,
        'new fact',
        expect.any(Object)
      );
    });
  });
});
