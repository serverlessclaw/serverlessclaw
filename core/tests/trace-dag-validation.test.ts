import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentType } from '../lib/types/agent';
import { TraceType } from '../lib/types/constants';

/**
 * Trace DAG Validation Tests
 *
 * These tests verify that the ClawTracer correctly records the Directed Acyclic Graph (DAG)
 * structure for multi-agent workflows, including:
 * 1. Parent-child node linking via dispatchTask
 * 2. Parallel node creation via PARALLEL_TASK_DISPATCH
 * 3. Evolution loop trace paths (Planner → Coder → QA)
 * 4. Aggregation trace nodes for parallel dispatch results
 */

// ============================================================================
// Mock Setup
// ============================================================================

const mockDocClient = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue({}),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => mockDocClient),
  },
  PutCommand: class {
    constructor(public input: unknown) {}
  },
  UpdateCommand: class {
    constructor(public input: unknown) {}
  },
  QueryCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock('sst', () => ({
  Resource: {
    TraceTable: { name: 'test-trace-table' },
  },
}));

vi.mock('../lib/registry/index', () => ({
  AgentRegistry: {
    getRetentionDays: vi.fn().mockResolvedValue(7),
  },
}));

// ============================================================================
// Tests: Parent-Child Node Linking (dispatchTask)
// ============================================================================

describe('Trace DAG — Parent-Child Node Linking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDocClient.send.mockResolvedValue({});
  });

  it('should create root node with nodeId "root" and no parentId', async () => {
    const { ClawTracer } = await import('../lib/tracer');

    const tracer = new ClawTracer('user-123', 'dashboard', 'trace-001', 'root');
    await tracer.startTrace({ task: 'User request' });

    // Verify PutCommand was called with correct structure
    const putCalls = mockDocClient.send.mock.calls.filter(
      (call: unknown[]) => call[0]?.constructor?.name === 'PutCommand'
    );
    expect(putCalls.length).toBeGreaterThan(0);

    const putInput = putCalls[0][0].input;
    expect(putInput.Item.traceId).toBe('trace-001');
    expect(putInput.Item.nodeId).toBe('root');
    expect(putInput.Item.parentId).toBeUndefined();
  });

  it('should create child node with correct parentId when dispatchTask is called', async () => {
    const { ClawTracer } = await import('../lib/tracer');

    // Root (SuperClaw)
    const rootTracer = new ClawTracer('user-123', 'dashboard', 'trace-001', 'root');
    await rootTracer.startTrace({ task: 'User request' });

    // Child spawned by dispatchTask (Planner)
    const childTracer = rootTracer.getChildTracer('node-planner', AgentType.STRATEGIC_PLANNER);
    await childTracer.startTrace({ task: 'Design plan' });

    // Verify child node has correct parentId
    const putCalls = mockDocClient.send.mock.calls.filter(
      (call: unknown[]) => call[0]?.constructor?.name === 'PutCommand'
    );
    const childPutCall = putCalls.find(
      (call: unknown[]) =>
        (call[0] as { input: { Item: { nodeId: string } } }).input.Item.nodeId === 'node-planner'
    );

    expect(childPutCall).toBeDefined();
    const childInput = (childPutCall as unknown[])[0] as {
      input: { Item: { traceId: string; parentId: string; agentId: string } };
    };
    expect(childInput.input.Item.traceId).toBe('trace-001');
    expect(childInput.input.Item.parentId).toBe('root');
    expect(childInput.input.Item.agentId).toBe(AgentType.STRATEGIC_PLANNER);
  });

  it('should maintain same traceId across all nodes in a workflow', async () => {
    const { ClawTracer } = await import('../lib/tracer');

    const traceId = 'trace-workflow-001';

    // Root
    const root = new ClawTracer('user-123', 'system', traceId, 'root');
    await root.startTrace({ task: 'Start' });

    // Level 1 children
    const planner = root.getChildTracer('node-planner', AgentType.STRATEGIC_PLANNER);
    await planner.startTrace({ task: 'Plan' });

    // Level 2 children (planner dispatches to coder)
    const coder = planner.getChildTracer('node-coder', AgentType.CODER);
    await coder.startTrace({ task: 'Implement' });

    // All nodes should share the same traceId
    const putCalls = mockDocClient.send.mock.calls.filter(
      (call: unknown[]) => call[0]?.constructor?.name === 'PutCommand'
    );

    for (const call of putCalls) {
      const input = (call as unknown[])[0] as { input: { Item: { traceId: string } } };
      expect(input.input.Item.traceId).toBe(traceId);
    }
  });
});

// ============================================================================
// Tests: Parallel Node Creation (PARALLEL_TASK_DISPATCH)
// ============================================================================

describe('Trace DAG — Parallel Node Creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDocClient.send.mockResolvedValue({});
  });

  it('should create multiple child nodes for parallel dispatch', async () => {
    const { ClawTracer } = await import('../lib/tracer');

    const rootTracer = new ClawTracer('user-123', 'system', 'trace-parallel-001', 'root');
    await rootTracer.startTrace({ task: 'Council review' });

    // Simulate parallel dispatch creating 3 child nodes
    const reviewModes = ['security', 'performance', 'architect'];
    for (const mode of reviewModes) {
      const childTracer = rootTracer.getChildTracer(`node-${mode}`, 'critic');
      await childTracer.startTrace({ reviewMode: mode });
    }

    // Verify 4 PutCommand calls (root + 3 children)
    const putCalls = mockDocClient.send.mock.calls.filter(
      (call: unknown[]) => call[0]?.constructor?.name === 'PutCommand'
    );
    expect(putCalls).toHaveLength(4);

    // Verify all children point to root
    const childCalls = putCalls.filter((call: unknown[]) => {
      const input = (call as unknown[])[0] as {
        input: { Item: { nodeId: string; parentId?: string } };
      };
      return input.input.Item.nodeId !== 'root';
    });

    expect(childCalls).toHaveLength(3);
    for (const call of childCalls) {
      const input = (call as unknown[])[0] as { input: { Item: { parentId: string } } };
      expect(input.input.Item.parentId).toBe('root');
    }
  });

  it('should record steps for each parallel node independently', async () => {
    const { ClawTracer } = await import('../lib/tracer');

    const rootTracer = new ClawTracer('user-123', 'system', 'trace-parallel-002', 'root');
    await rootTracer.startTrace({ task: 'Council review' });

    const securityTracer = rootTracer.getChildTracer('node-security', 'critic');
    await securityTracer.startTrace({ reviewMode: 'security' });
    await securityTracer.addStep({
      type: TraceType.REVIEW_COMPLETE,
      content: 'No vulnerabilities found',
    });

    const perfTracer = rootTracer.getChildTracer('node-perf', 'critic');
    await perfTracer.startTrace({ reviewMode: 'performance' });
    await perfTracer.addStep({
      type: TraceType.REVIEW_COMPLETE,
      content: 'Latency impact: minimal',
    });

    // Verify UpdateCommand calls for steps
    const updateCalls = mockDocClient.send.mock.calls.filter(
      (call: unknown[]) => call[0]?.constructor?.name === 'UpdateCommand'
    );

    // Each addStep creates an UpdateCommand
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// Tests: Evolution Loop Trace Path
// ============================================================================

describe('Trace DAG — Evolution Loop Path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDocClient.send.mockResolvedValue({});
  });

  it('should create Planner → Coder → QA trace path', async () => {
    const { ClawTracer } = await import('../lib/tracer');

    const traceId = 'trace-evolution-001';

    // Root (SuperClaw or Reflector)
    const rootTracer = new ClawTracer('user-123', 'system', traceId, 'root');
    await rootTracer.startTrace({ task: 'Evolution cycle' });

    // Planner node
    const plannerTracer = rootTracer.getChildTracer('node-planner', AgentType.STRATEGIC_PLANNER);
    await plannerTracer.startTrace({ task: 'Design plan for gap-001' });
    await plannerTracer.addStep({
      type: TraceType.PLAN_GENERATED,
      content: 'Strategic plan created',
    });

    // Coder node (child of planner)
    const coderTracer = plannerTracer.getChildTracer('node-coder', AgentType.CODER);
    await coderTracer.startTrace({ task: 'Implement fix for gap-001' });
    await coderTracer.addStep({ type: TraceType.CODE_WRITTEN, content: 'Modified files' });

    // QA node (child of coder)
    const qaTracer = coderTracer.getChildTracer('node-qa', AgentType.QA);
    await qaTracer.startTrace({ task: 'Verify implementation' });
    await qaTracer.addStep({ type: TraceType.AUDIT_COMPLETE, content: 'SUCCESS' });

    // Verify the chain of PutCommand calls
    const putCalls = mockDocClient.send.mock.calls.filter(
      (call: unknown[]) => call[0]?.constructor?.name === 'PutCommand'
    );

    // Root + Planner + Coder + QA = 4 nodes
    expect(putCalls).toHaveLength(4);

    // Extract node data
    const nodes = putCalls.map((call: unknown[]) => {
      const input = (call as unknown[])[0] as {
        input: { Item: { nodeId: string; parentId?: string; agentId?: string } };
      };
      return input.input.Item;
    });

    const rootNode = nodes.find((n) => n.nodeId === 'root');
    const plannerNode = nodes.find((n) => n.agentId === AgentType.STRATEGIC_PLANNER);
    const coderNode = nodes.find((n) => n.agentId === AgentType.CODER);
    const qaNode = nodes.find((n) => n.agentId === AgentType.QA);

    // Verify all nodes exist
    expect(rootNode).toBeDefined();
    expect(plannerNode).toBeDefined();
    expect(coderNode).toBeDefined();
    expect(qaNode).toBeDefined();

    // Verify parent chain
    expect(plannerNode!.parentId).toBe('root');
    expect(coderNode!.parentId).toBe('node-planner');
    expect(qaNode!.parentId).toBe('node-coder');
  });

  it('should include QA node after Coder in evolution trace', async () => {
    const { ClawTracer } = await import('../lib/tracer');

    const traceId = 'trace-evolution-002';

    const rootTracer = new ClawTracer('user-123', 'system', traceId, 'root');
    await rootTracer.startTrace({ task: 'Evolution' });

    const plannerTracer = rootTracer.getChildTracer('node-planner', AgentType.STRATEGIC_PLANNER);
    await plannerTracer.startTrace({ task: 'Plan' });

    const coderTracer = plannerTracer.getChildTracer('node-coder', AgentType.CODER);
    await coderTracer.startTrace({ task: 'Code' });

    const qaTracer = coderTracer.getChildTracer('node-qa', AgentType.QA);
    await qaTracer.startTrace({ task: 'Verify' });

    // Verify temporal ordering via PutCommand call sequence
    const putCalls = mockDocClient.send.mock.calls.filter(
      (call: unknown[]) => call[0]?.constructor?.name === 'PutCommand'
    );

    const agentOrder = putCalls.map((call: unknown[]) => {
      const input = (call as unknown[])[0] as { input: { Item: { agentId?: string } } };
      return input.input.Item.agentId;
    });

    // Verify order: root (undefined) → planner → coder → qa
    const definedAgents = agentOrder.filter((a): a is string => !!a);
    expect(definedAgents).toEqual([AgentType.STRATEGIC_PLANNER, AgentType.CODER, AgentType.QA]);
  });
});

// ============================================================================
// Tests: Aggregation Trace Nodes
// ============================================================================

describe('Trace DAG — Aggregation Trace Nodes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDocClient.send.mockResolvedValue({});
  });

  it('should create aggregation trace node after parallel dispatch completes', async () => {
    const { ClawTracer } = await import('../lib/tracer');

    const traceId = 'trace-aggregation-001';

    // Root dispatcher
    const rootTracer = new ClawTracer('user-123', 'system', traceId, 'root');
    await rootTracer.startTrace({ task: 'Parallel council review' });

    // Parallel children
    const modes = ['security', 'performance', 'architect'];
    for (const mode of modes) {
      const child = rootTracer.getChildTracer(`node-${mode}`, 'critic');
      await child.startTrace({ reviewMode: mode });
      await child.addStep({ type: TraceType.REVIEW_COMPLETE, content: `${mode} review done` });
    }

    // Aggregation node (child of root, after all parallel tasks complete)
    const aggregatorTracer = rootTracer.getChildTracer('node-aggregation', 'aggregator');
    await aggregatorTracer.startTrace({ task: 'Aggregate council results' });
    await aggregatorTracer.addStep({
      type: TraceType.AGGREGATION_COMPLETE,
      content: 'All reviews approved',
    });

    const putCalls = mockDocClient.send.mock.calls.filter(
      (call: unknown[]) => call[0]?.constructor?.name === 'PutCommand'
    );

    // root + 3 parallel + 1 aggregation = 5 nodes
    expect(putCalls).toHaveLength(5);

    // Verify aggregation node has correct parentId
    const aggNode = putCalls.find((call: unknown[]) => {
      const input = (call as unknown[])[0] as { input: { Item: { nodeId: string } } };
      return input.input.Item.nodeId === 'node-aggregation';
    });

    expect(aggNode).toBeDefined();
    const aggInput = (aggNode as unknown[])[0] as { input: { Item: { parentId: string } } };
    expect(aggInput.input.Item.parentId).toBe('root');
  });
});

// ============================================================================
// Tests: Trace Retrieval (getTrace)
// ============================================================================

describe('Trace DAG — Trace Retrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should retrieve all nodes for a given traceId', async () => {
    const { ClawTracer } = await import('../lib/tracer');

    const mockNodes = [
      { traceId: 'trace-retrieve-001', nodeId: 'root', parentId: undefined, agentId: undefined },
      {
        traceId: 'trace-retrieve-001',
        nodeId: 'node-planner',
        parentId: 'root',
        agentId: AgentType.STRATEGIC_PLANNER,
      },
      {
        traceId: 'trace-retrieve-001',
        nodeId: 'node-coder',
        parentId: 'node-planner',
        agentId: AgentType.CODER,
      },
    ];

    mockDocClient.send.mockResolvedValueOnce({ Items: mockNodes });

    const nodes = await ClawTracer.getTrace('trace-retrieve-001');

    expect(nodes).toHaveLength(3);
    expect(nodes[0].nodeId).toBe('root');
    expect(nodes[1].parentId).toBe('root');
    expect(nodes[2].parentId).toBe('node-planner');
  });

  it('should return empty array for non-existent traceId', async () => {
    const { ClawTracer } = await import('../lib/tracer');

    mockDocClient.send.mockResolvedValueOnce({ Items: undefined });

    const nodes = await ClawTracer.getTrace('non-existent-trace');

    expect(nodes).toEqual([]);
  });
});
