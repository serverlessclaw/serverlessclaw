import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  dispatchTask,
  listAgents,
  manageAgentTools,
  createAgent,
  deleteAgent,
  syncAgentRegistry,
  pulseCheck,
} from './agent';
import { setSystemConfig } from './config';
import { emitEvent } from '../../lib/utils/bus';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);

// Mock dependencies
vi.mock('../../lib/utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/registry/index', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockImplementation(async (id) => ({
      enabled: true,
      isBackbone: id === 'coder' || id === 'superclaw',
    })),
    getAllConfigs: vi.fn().mockResolvedValue({}),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../lib/registry/config', () => ({
  ConfigManager: {
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
  },
  defaultDocClient: {
    send: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../lib/tracer', () => ({
  ClawTracer: vi.fn().mockImplementation(function () {
    return {
      getChildTracer: vi.fn().mockReturnValue({
        getTraceId: () => 'child-trace-123',
        getNodeId: () => 'child-node-123',
        getParentId: () => 'parent-node-123',
      }),
    };
  }),
}));

vi.mock('../../lib/backbone', () => ({
  BACKBONE_REGISTRY: {
    superclaw: { id: 'superclaw', name: 'SuperClaw', isBackbone: true },
    coder: { id: 'coder', name: 'Coder', isBackbone: true },
  },
}));

vi.mock('../../lib/utils/topology', () => ({
  discoverSystemTopology: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
}));

vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'test-config-table' },
  },
}));

describe('Knowledge Agent Tools', () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
  });

  describe('listAgents', () => {
    it('should list enabled agents but exclude main', async () => {
      const { AgentRegistry } = await import('../../lib/registry/index');
      vi.mocked(AgentRegistry.getAllConfigs).mockResolvedValueOnce({
        superclaw: {
          id: 'superclaw',
          name: 'SuperClaw',
          enabled: true,
          description: 'Orchestrator',
        } as any,
        coder: { id: 'coder', name: 'Coder', enabled: true, description: 'Writes code' } as any,
        disabled: { id: 'bad', name: 'Bad', enabled: false, description: 'Off' } as any,
      });

      const result = await listAgents.execute();

      expect(result).toContain('- [coder] Coder: Writes code');
      expect(result).not.toContain('SuperClaw');
      expect(result).not.toContain('[superclaw]');
      expect(result).not.toContain('Bad');
    });

    it('should return helpful message when no agents available', async () => {
      const { AgentRegistry } = await import('../../lib/registry/index');
      vi.mocked(AgentRegistry.getAllConfigs).mockResolvedValueOnce({});

      const result = await listAgents.execute();
      expect(result).toBe('No enabled agents found in the registry.');
    });
  });

  describe('dispatchTask', () => {
    it('should return TASK_PAUSED signal upon successful dispatch', async () => {
      const args = {
        agentId: 'coder',
        userId: 'user-1',
        task: 'build a feature',
        sessionId: 'session-1',
      };

      const result = await dispatchTask.execute(args);

      expect(result).toContain('TASK_PAUSED');
      expect(result).toContain('successfully dispatched this task to the **coder** agent');

      // Verify event emission
      expect(emitEvent).toHaveBeenCalledWith(
        'superclaw',
        'coder_task',
        expect.objectContaining({
          userId: 'user-1',
          task: 'build a feature',
          sessionId: 'session-1',
          traceId: 'child-trace-123',
        })
      );
    });

    it('should prevent dispatching to the main agent', async () => {
      const args = {
        agentId: 'superclaw',
        userId: 'user-1',
        task: 'build a feature',
      };

      const result = await dispatchTask.execute(args);

      expect(result).toContain("FAILED: Cannot dispatch tasks to the 'superclaw' agent");
      expect(emitEvent).not.toHaveBeenCalled();
    });

    it('should decompose complex missions into sub-tasks', async () => {
      const args = {
        agentId: 'coder',
        userId: 'user-1',
        task: `
### Goal: CODER
Implement the backend API with auth and database connection. Ensure all routes are protected.
Actually, this next part is also for the coder.
### Goal: CODER
Implement the frontend dashboard with responsive design and theme support.
### Goal: CODER
Deploy the entire application to AWS using SST and verify all resources are active.
`,
        sessionId: 'session-complex',
      };

      const result = await dispatchTask.execute(args);

      expect(result).toContain('TASK_PAUSED');
      expect(result).toContain('decomposed this mission into 3 sub-tasks');

      // Verify multiple events emitted (total 3 sub-tasks)
      expect(emitEvent).toHaveBeenCalledTimes(3);
    });
  });

  describe('pulseCheck', () => {
    it('should emit PULSE_PING event to verify agent connectivity', async () => {
      const result = await pulseCheck.execute({
        targetAgentId: 'coder',
        userId: 'user-pulse',
      });

      expect(result).toContain('PULSE_SENT');
      expect(result).toContain('sent a cognitive pulse to **coder**');

      expect(emitEvent).toHaveBeenCalledWith(
        'superclaw',
        'pulse_ping',
        expect.objectContaining({
          targetAgentId: 'coder',
          userId: 'user-pulse',
        })
      );
    });
  });

  describe('manageAgentTools', () => {
    it('should update agent tools via ConfigManager', async () => {
      const { ConfigManager } = await import('../../lib/registry/config');
      const result = await manageAgentTools.execute({
        agentId: 'superclaw',
        toolNames: ['tool1'],
      });

      expect(result).toContain('Successfully updated tools for agent superclaw');
      expect(ConfigManager.saveRawConfig).toHaveBeenCalledWith('superclaw_tools', ['tool1']);
    });
  });

  describe('setSystemConfig', () => {
    it('should update system config via ConfigManager', async () => {
      const { ConfigManager } = await import('../../lib/registry/config');
      await setSystemConfig.execute({
        key: 'test_key',
        value: '{"foo": "bar"}',
      });

      expect(ConfigManager.saveRawConfig).toHaveBeenCalledWith('test_key', '{"foo": "bar"}');
    });
  });

  describe('createAgent', () => {
    it('should create a new non-backbone agent', async () => {
      const { AgentRegistry } = await import('../../lib/registry/index');
      vi.mocked(AgentRegistry.getAgentConfig).mockResolvedValueOnce(undefined);

      const result = await createAgent.execute({
        agentId: 'my-agent',
        name: 'My Agent',
        systemPrompt: 'You are a helpful assistant.',
        provider: 'openai',
        model: 'gpt-5.4-mini',
        enabled: true,
      });

      expect(result).toContain("Successfully created agent 'my-agent'");
      expect(AgentRegistry.saveConfig).toHaveBeenCalledWith(
        'my-agent',
        expect.objectContaining({
          id: 'my-agent',
          name: 'My Agent',
          systemPrompt: 'You are a helpful assistant.',
          isBackbone: false,
        })
      );
    });
  });

  describe('deleteAgent', () => {
    it('should delete a non-backbone agent', async () => {
      const { defaultDocClient } = await import('../../lib/registry/config');
      vi.mocked(defaultDocClient.send).mockResolvedValue({} as any);

      const result = await deleteAgent.execute({ agentId: 'my-custom-agent' });
      expect(result).toContain("Successfully deleted agent 'my-custom-agent'");
    });
  });

  describe('syncAgentRegistry', () => {
    it('should sync registry and discover topology', async () => {
      const { AgentRegistry } = await import('../../lib/registry/index');
      vi.mocked(AgentRegistry.getAllConfigs).mockResolvedValueOnce({
        coder: { id: 'coder', name: 'Coder', enabled: true } as any,
        'strategic-planner': {
          id: 'strategic-planner',
          name: 'Strategic Planner',
          enabled: true,
        } as any,
      });

      const result = await syncAgentRegistry.execute();

      expect(result).toContain('Registry synchronized');
      expect(result).toContain('2 active agents');
    });
  });
});
