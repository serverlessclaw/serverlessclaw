import { describe, it, expect, vi } from 'vitest';
import { NODE_TYPE, EDGE_LABEL, INFRA_NODE_ID } from './constants';
import type { TopologyNode } from '../../types/index';

vi.mock('../../backbone', () => ({
  BACKBONE_REGISTRY: {
    superclaw: {
      id: 'superclaw',
      name: 'SuperClaw',
      enabled: true,
      isBackbone: true,
      tools: ['dispatchTask', 'saveMemory', 'recallKnowledge', 'sendMessage'],
      connectionProfile: ['bus', 'memory', 'config', 'trace', 'knowledge'],
    },
    coder: {
      id: 'coder',
      name: 'Coder Agent',
      enabled: true,
      isBackbone: true,
      tools: ['runTests', 'triggerDeployment'],
      connectionProfile: ['bus', 'memory', 'storage', 'codebuild', 'config', 'trace', 'knowledge'],
    },
    testhandler: {
      id: 'testhandler',
      name: 'Test Handler',
      enabled: true,
      isBackbone: true,
      tools: ['aws-s3_read_file', 'git_status'],
      connectionProfile: ['bus', 'deployer'],
    },
    noconnections: {
      id: 'noconnections',
      name: 'No Connections',
      enabled: true,
      isBackbone: true,
    },
  },
}));

import {
  mapProfileToResource,
  mapToolToResources,
  inferNodeEdges,
  inferBackboneEdges,
} from './edges';

describe('mapProfileToResource', () => {
  const busId = 'test-bus-id';

  it('maps bus profile to busId', () => {
    expect(mapProfileToResource('bus', busId)).toBe(busId);
  });

  it('maps agentbus profile to busId', () => {
    expect(mapProfileToResource('agentbus', busId)).toBe(busId);
  });

  it('maps memory profile to MEMORY_TABLE', () => {
    expect(mapProfileToResource('memory', busId)).toBe(INFRA_NODE_ID.MEMORY_TABLE);
  });

  it('maps memorytable profile to MEMORY_TABLE', () => {
    expect(mapProfileToResource('memorytable', busId)).toBe(INFRA_NODE_ID.MEMORY_TABLE);
  });

  it('maps config profile to CONFIG_TABLE', () => {
    expect(mapProfileToResource('config', busId)).toBe(INFRA_NODE_ID.CONFIG_TABLE);
  });

  it('maps configtable profile to CONFIG_TABLE', () => {
    expect(mapProfileToResource('configtable', busId)).toBe(INFRA_NODE_ID.CONFIG_TABLE);
  });

  it('maps trace profile to TRACE_TABLE', () => {
    expect(mapProfileToResource('trace', busId)).toBe(INFRA_NODE_ID.TRACE_TABLE);
  });

  it('maps tracetable profile to TRACE_TABLE', () => {
    expect(mapProfileToResource('tracetable', busId)).toBe(INFRA_NODE_ID.TRACE_TABLE);
  });

  it('maps storage profile to STAGING_BUCKET', () => {
    expect(mapProfileToResource('storage', busId)).toBe(INFRA_NODE_ID.STAGING_BUCKET);
  });

  it('maps stagingbucket profile to STAGING_BUCKET', () => {
    expect(mapProfileToResource('stagingbucket', busId)).toBe(INFRA_NODE_ID.STAGING_BUCKET);
  });

  it('maps codebuild profile to DEPLOYER', () => {
    expect(mapProfileToResource('codebuild', busId)).toBe(INFRA_NODE_ID.DEPLOYER);
  });

  it('maps deployer profile to DEPLOYER', () => {
    expect(mapProfileToResource('deployer', busId)).toBe(INFRA_NODE_ID.DEPLOYER);
  });

  it('maps knowledge profile to KNOWLEDGE_BUCKET', () => {
    expect(mapProfileToResource('knowledge', busId)).toBe(INFRA_NODE_ID.KNOWLEDGE_BUCKET);
  });

  it('maps knowledgebucket profile to KNOWLEDGE_BUCKET', () => {
    expect(mapProfileToResource('knowledgebucket', busId)).toBe(INFRA_NODE_ID.KNOWLEDGE_BUCKET);
  });

  it('maps scheduler profile to SCHEDULER', () => {
    expect(mapProfileToResource('scheduler', busId)).toBe(INFRA_NODE_ID.SCHEDULER);
  });

  it('maps notifier profile to NOTIFIER', () => {
    expect(mapProfileToResource('notifier', busId)).toBe(INFRA_NODE_ID.NOTIFIER);
  });

  it('maps MCP profiles correctly', () => {
    expect(mapProfileToResource('git', busId)).toBe('mcp-multiplexer');
    expect(mapProfileToResource('filesystem', busId)).toBe('mcp-multiplexer');
    expect(mapProfileToResource('google-search', busId)).toBe('mcp-multiplexer');
    expect(mapProfileToResource('puppeteer', busId)).toBe('mcp-multiplexer');
    expect(mapProfileToResource('fetch', busId)).toBe('mcp-multiplexer');
    expect(mapProfileToResource('aws', busId)).toBe('mcp-multiplexer');
    expect(mapProfileToResource('aws-s3', busId)).toBe('mcp-multiplexer');
  });

  it('returns null for unrecognized profiles', () => {
    expect(mapProfileToResource('unknown', busId)).toBeNull();
    expect(mapProfileToResource('random', busId)).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(mapProfileToResource('BUS', busId)).toBe(busId);
    expect(mapProfileToResource('Memory', busId)).toBe(INFRA_NODE_ID.MEMORY_TABLE);
    expect(mapProfileToResource('CODEBUILD', busId)).toBe(INFRA_NODE_ID.DEPLOYER);
  });
});

describe('mapToolToResources', () => {
  it('returns sendMessage mapping to notifier', async () => {
    const result = await mapToolToResources('sendMessage');
    expect(result).toEqual([INFRA_NODE_ID.NOTIFIER]);
  });

  it('maps git_ prefixed tools to git profile', async () => {
    const result = await mapToolToResources('git_status');
    expect(result).toEqual(['git']);
  });

  it('maps filesystem_ prefixed tools to filesystem profile', async () => {
    const result = await mapToolToResources('filesystem_read_file');
    expect(result).toEqual(['filesystem']);
  });

  it('maps google-search_ prefixed tools to google-search profile', async () => {
    const result = await mapToolToResources('google-search_search');
    expect(result).toEqual(['google-search']);
  });

  it('maps puppeteer_ prefixed tools to puppeteer profile', async () => {
    const result = await mapToolToResources('puppeteer_navigate');
    expect(result).toEqual(['puppeteer']);
  });

  it('maps fetch_ prefixed tools to fetch profile', async () => {
    const result = await mapToolToResources('fetch_get');
    expect(result).toEqual(['fetch']);
  });

  it('maps aws_ prefixed tools to aws profile', async () => {
    const result = await mapToolToResources('aws_list_resources');
    expect(result).toEqual(['aws']);
  });

  it('maps aws-s3_ prefixed tools to aws-s3 profile', async () => {
    const result = await mapToolToResources('aws-s3_read_file');
    expect(result).toEqual(['aws-s3']);
  });

  it('returns empty array for empty tool name', async () => {
    const result = await mapToolToResources('');
    expect(result).toEqual([]);
  });

  it('returns empty array for unknown tool not matching any prefix', async () => {
    const result = await mapToolToResources('completelyUnknownTool');
    expect(result).toEqual([]);
  });
});

function makeNode(overrides: Partial<TopologyNode> & { id: string }): TopologyNode {
  return {
    type: NODE_TYPE.INFRA,
    label: overrides.id,
    ...overrides,
  };
}

describe('inferNodeEdges', () => {
  it('returns edges for agent-to-bus orchestration', () => {
    const nodes = [
      makeNode({ id: 'superclaw', type: NODE_TYPE.AGENT }),
      makeNode({ id: 'agentbus', type: NODE_TYPE.BUS }),
    ];
    const edges = inferNodeEdges(nodes);
    const orchEdge = edges.find((e) => e.source === 'superclaw' && e.target === 'agentbus');
    const signalEdge = edges.find((e) => e.source === 'agentbus' && e.target === 'superclaw');
    expect(orchEdge).toBeDefined();
    expect(orchEdge?.label).toBe(EDGE_LABEL.ORCHESTRATE);
    expect(signalEdge).toBeDefined();
    expect(signalEdge?.label).toBe(EDGE_LABEL.SIGNAL);
  });

  it('creates edges for monitor agent', () => {
    const nodes = [
      makeNode({ id: 'monitor', type: NODE_TYPE.AGENT }),
      makeNode({ id: 'agentbus', type: NODE_TYPE.BUS }),
    ];
    const edges = inferNodeEdges(nodes);
    expect(edges.find((e) => e.source === 'monitor' && e.target === 'agentbus')).toBeDefined();
    expect(edges.find((e) => e.source === 'agentbus' && e.target === 'monitor')).toBeDefined();
  });

  it('creates edges for superclaw agent', () => {
    const nodes = [
      makeNode({ id: 'superclaw', type: NODE_TYPE.AGENT }),
      makeNode({ id: 'agentbus', type: NODE_TYPE.BUS }),
    ];
    const edges = inferNodeEdges(nodes);
    expect(edges.find((e) => e.source === 'superclaw' && e.target === 'agentbus')).toBeDefined();
  });

  it('includes scheduler-to-heartbeat edge', () => {
    const edges = inferNodeEdges([]);
    expect(
      edges.find(
        (e) =>
          e.source === INFRA_NODE_ID.SCHEDULER &&
          e.target === INFRA_NODE_ID.HEARTBEAT &&
          e.label === EDGE_LABEL.HEARTBEAT
      )
    ).toBeDefined();
  });

  it('includes heartbeat-to-bus signal edge', () => {
    const edges = inferNodeEdges([]);
    const heartbeatEdge = edges.find(
      (e) => e.source === INFRA_NODE_ID.HEARTBEAT && e.label === EDGE_LABEL.SIGNAL
    );
    expect(heartbeatEdge).toBeDefined();
    expect(heartbeatEdge?.target).toBe(INFRA_NODE_ID.AGENT_BUS);
  });

  it('creates API-to-bus signal edge when API node exists', () => {
    const nodes = [makeNode({ id: INFRA_NODE_ID.WEBHOOK_API })];
    const edges = inferNodeEdges(nodes);
    const apiEdge = edges.find(
      (e) => e.source === INFRA_NODE_ID.WEBHOOK_API && e.label === EDGE_LABEL.SIGNAL
    );
    expect(apiEdge).toBeDefined();
  });

  it('creates telegram-to-api webhook edge when API node exists', () => {
    const nodes = [makeNode({ id: INFRA_NODE_ID.WEBHOOK_API })];
    const edges = inferNodeEdges(nodes);
    const telegramEdge = edges.find(
      (e) =>
        e.source === INFRA_NODE_ID.TELEGRAM &&
        e.target === INFRA_NODE_ID.WEBHOOK_API &&
        e.label === EDGE_LABEL.WEBHOOK
    );
    expect(telegramEdge).toBeDefined();
  });

  it('does not create telegram edge when no API node', () => {
    const edges = inferNodeEdges([]);
    const telegramEdge = edges.find((e) => e.source === INFRA_NODE_ID.TELEGRAM);
    expect(telegramEdge).toBeUndefined();
  });

  it('creates bus-to-realtime-bridge signal when both exist', () => {
    const nodes = [
      makeNode({ id: 'agentbus', type: NODE_TYPE.BUS }),
      makeNode({ id: INFRA_NODE_ID.REALTIME_BRIDGE }),
    ];
    const edges = inferNodeEdges(nodes);
    const bridgeEdge = edges.find(
      (e) =>
        e.source === 'agentbus' &&
        e.target === INFRA_NODE_ID.REALTIME_BRIDGE &&
        e.label === EDGE_LABEL.SIGNAL
    );
    expect(bridgeEdge).toBeDefined();
  });

  it('creates realtime-bridge-to-bus edge when both bridge and bus exist', () => {
    const nodes = [
      makeNode({ id: INFRA_NODE_ID.REALTIME_BRIDGE }),
      makeNode({ id: INFRA_NODE_ID.REALTIME_BUS }),
    ];
    const edges = inferNodeEdges(nodes);
    const bridgeEdge = edges.find(
      (e) =>
        e.source === INFRA_NODE_ID.REALTIME_BRIDGE &&
        e.target === INFRA_NODE_ID.REALTIME_BUS &&
        e.label === EDGE_LABEL.REALTIME
    );
    expect(bridgeEdge).toBeDefined();
  });

  it('creates realtime-bus-to-dashboard edge when both exist', () => {
    const nodes = [
      makeNode({ id: 'dashboard', type: NODE_TYPE.DASHBOARD }),
      makeNode({ id: INFRA_NODE_ID.REALTIME_BUS }),
    ];
    const edges = inferNodeEdges(nodes);
    const dashEdge = edges.find(
      (e) =>
        e.source === INFRA_NODE_ID.REALTIME_BUS &&
        e.target === 'dashboard' &&
        e.label === EDGE_LABEL.REALTIME
    );
    expect(dashEdge).toBeDefined();
  });

  it('creates dashboard-to-superclaw link', () => {
    const nodes = [
      makeNode({ id: 'dashboard', type: NODE_TYPE.DASHBOARD }),
      makeNode({ id: 'superclaw', type: NODE_TYPE.AGENT }),
    ];
    const edges = inferNodeEdges(nodes);
    const link = edges.find(
      (e) =>
        e.source === 'dashboard' && e.target === 'superclaw' && e.label === EDGE_LABEL.ORCHESTRATE
    );
    expect(link).toBeDefined();
  });

  it('creates dashboard-to-api inbound edge', () => {
    const nodes = [
      makeNode({ id: 'dashboard', type: NODE_TYPE.DASHBOARD }),
      makeNode({ id: INFRA_NODE_ID.WEBHOOK_API }),
    ];
    const edges = inferNodeEdges(nodes);
    const apiEdge = edges.find(
      (e) =>
        e.source === 'dashboard' &&
        e.target === INFRA_NODE_ID.WEBHOOK_API &&
        e.label === EDGE_LABEL.INBOUND
    );
    expect(apiEdge).toBeDefined();
  });

  it('creates dashboard query edges to core tables', () => {
    const nodes = [
      makeNode({ id: 'dashboard', type: NODE_TYPE.DASHBOARD }),
      makeNode({ id: INFRA_NODE_ID.CLAWDB }),
    ];
    const edges = inferNodeEdges(nodes);

    for (const table of [INFRA_NODE_ID.CLAWDB]) {
      const queryEdge = edges.find(
        (e) => e.source === 'dashboard' && e.target === table && e.label === EDGE_LABEL.QUERY
      );
      expect(queryEdge).toBeDefined();
    }
  });

  it('does not create dashboard edges when no dashboard node', () => {
    const nodes = [makeNode({ id: 'someagent', type: NODE_TYPE.AGENT })];
    const edges = inferNodeEdges(nodes);
    const dashEdges = edges.filter((e) => e.source === 'dashboard' || e.target === 'dashboard');
    expect(dashEdges.length).toBe(0);
  });

  it('uses AGENT_BUS as default bus when no bus node present', () => {
    const nodes = [makeNode({ id: 'someagent', type: NODE_TYPE.AGENT })];
    const edges = inferNodeEdges(nodes);
    const agentEdge = edges.find(
      (e) => e.source === 'someagent' && e.target === INFRA_NODE_ID.AGENT_BUS
    );
    expect(agentEdge).toBeDefined();
  });

  it('uses actual bus node ID when present', () => {
    const nodes = [
      makeNode({ id: 'my-custom-bus', type: NODE_TYPE.BUS }),
      makeNode({ id: 'coder', type: NODE_TYPE.AGENT }),
    ];
    const edges = inferNodeEdges(nodes);
    const coderEdge = edges.find((e) => e.source === 'coder' && e.target === 'my-custom-bus');
    expect(coderEdge).toBeDefined();
  });

  it('matches agent bus by AGENT_BUS id', () => {
    const nodes = [
      makeNode({ id: INFRA_NODE_ID.AGENT_BUS, type: NODE_TYPE.BUS }),
      makeNode({ id: 'coder', type: NODE_TYPE.AGENT }),
    ];
    const edges = inferNodeEdges(nodes);
    expect(
      edges.find((e) => e.source === 'coder' && e.target === INFRA_NODE_ID.AGENT_BUS)
    ).toBeDefined();
  });

  it('does not create duplicate edges', () => {
    const nodes = [
      makeNode({ id: 'superclaw', type: NODE_TYPE.AGENT }),
      makeNode({ id: INFRA_NODE_ID.AGENT_BUS, type: NODE_TYPE.BUS }),
    ];
    const edges = inferNodeEdges(nodes);
    const superclawToBus = edges.filter(
      (e) => e.source === 'superclaw' && e.target === INFRA_NODE_ID.AGENT_BUS
    );
    expect(superclawToBus.length).toBe(1);
  });
});

describe('inferBackboneEdges', () => {
  it('creates edges from connection profiles', async () => {
    const nodes = [
      makeNode({ id: 'superclaw', type: NODE_TYPE.AGENT }),
      makeNode({ id: INFRA_NODE_ID.AGENT_BUS }),
      makeNode({ id: INFRA_NODE_ID.MEMORY_TABLE }),
      makeNode({ id: INFRA_NODE_ID.CONFIG_TABLE }),
      makeNode({ id: INFRA_NODE_ID.TRACE_TABLE }),
      makeNode({ id: INFRA_NODE_ID.KNOWLEDGE_BUCKET }),
    ];
    const edges = await inferBackboneEdges(nodes);

    // superclaw has connectionProfile: bus, memory, config, trace, knowledge
    expect(
      edges.find((e) => e.source === 'superclaw' && e.target === INFRA_NODE_ID.AGENT_BUS)
    ).toBeDefined();
    expect(
      edges.find((e) => e.source === 'superclaw' && e.target === INFRA_NODE_ID.MEMORY_TABLE)
    ).toBeDefined();
    expect(
      edges.find((e) => e.source === 'superclaw' && e.target === INFRA_NODE_ID.CONFIG_TABLE)
    ).toBeDefined();
    expect(
      edges.find((e) => e.source === 'superclaw' && e.target === INFRA_NODE_ID.TRACE_TABLE)
    ).toBeDefined();
    expect(
      edges.find((e) => e.source === 'superclaw' && e.target === INFRA_NODE_ID.KNOWLEDGE_BUCKET)
    ).toBeDefined();
  });

  it('creates edges from tools via mapToolToResources', async () => {
    const nodes = [
      makeNode({ id: 'testhandler' }),
      makeNode({ id: 'mcp-multiplexer' }),
      makeNode({ id: INFRA_NODE_ID.DEPLOYER }),
      makeNode({ id: INFRA_NODE_ID.AGENT_BUS }),
    ];
    const edges = await inferBackboneEdges(nodes);

    // testhandler has tools: aws-s3_read_file, git_status which map to mcp-multiplexer
    expect(
      edges.find((e) => e.source === 'testhandler' && e.target === 'mcp-multiplexer')
    ).toBeDefined();
  });

  it('skips edges when target node not in list', async () => {
    const nodes = [
      makeNode({ id: 'superclaw', type: NODE_TYPE.AGENT }),
      // Only bus, no memory/config/trace/knowledge
      makeNode({ id: INFRA_NODE_ID.AGENT_BUS }),
    ];
    const edges = await inferBackboneEdges(nodes);

    // Should have bus edge
    expect(
      edges.find((e) => e.source === 'superclaw' && e.target === INFRA_NODE_ID.AGENT_BUS)
    ).toBeDefined();
    // Should NOT have memory edge since node not in list
    expect(
      edges.find((e) => e.source === 'superclaw' && e.target === INFRA_NODE_ID.MEMORY_TABLE)
    ).toBeUndefined();
  });

  it('does not create duplicate edges', async () => {
    const nodes = [
      makeNode({ id: 'coder' }),
      makeNode({ id: INFRA_NODE_ID.AGENT_BUS }),
      makeNode({ id: INFRA_NODE_ID.MEMORY_TABLE }),
      makeNode({ id: INFRA_NODE_ID.STAGING_BUCKET }),
      makeNode({ id: INFRA_NODE_ID.DEPLOYER }),
      makeNode({ id: INFRA_NODE_ID.CONFIG_TABLE }),
      makeNode({ id: INFRA_NODE_ID.TRACE_TABLE }),
      makeNode({ id: INFRA_NODE_ID.KNOWLEDGE_BUCKET }),
    ];
    const edges = await inferBackboneEdges(nodes);

    // Check coder->bus only appears once
    const busEdges = edges.filter(
      (e) => e.source === 'coder' && e.target === INFRA_NODE_ID.AGENT_BUS
    );
    expect(busEdges.length).toBe(1);
  });

  it('sets USE label on all edges', async () => {
    const nodes = [
      makeNode({ id: 'coder' }),
      makeNode({ id: INFRA_NODE_ID.AGENT_BUS }),
      makeNode({ id: INFRA_NODE_ID.MEMORY_TABLE }),
    ];
    const edges = await inferBackboneEdges(nodes);
    for (const edge of edges) {
      expect(edge.label).toBe(EDGE_LABEL.USE);
    }
  });

  it('handles agents with no connectionProfile or tools', async () => {
    const nodes = [makeNode({ id: 'noconnections' }), makeNode({ id: INFRA_NODE_ID.AGENT_BUS })];
    const edges = await inferBackboneEdges(nodes);

    // noconnections has no connectionProfile, no tools - should produce no edges
    const noConnEdges = edges.filter((e) => e.source === 'noconnections');
    expect(noConnEdges.length).toBe(0);
  });

  it('returns empty edges for empty nodes', async () => {
    const edges = await inferBackboneEdges([]);
    expect(edges).toEqual([]);
  });

  it('uses lowercase IDs for edge sources', async () => {
    const nodes = [makeNode({ id: 'coder' }), makeNode({ id: INFRA_NODE_ID.AGENT_BUS })];
    const edges = await inferBackboneEdges(nodes);
    for (const edge of edges) {
      expect(edge.source).toBe(edge.source.toLowerCase());
    }
  });
});
