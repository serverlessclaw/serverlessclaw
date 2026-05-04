import { describe, it, expect } from 'vitest';
import { infraSchema } from './schema';

describe('Infra Domain Tool Schemas', () => {
  const expectedToolNames = [
    'stageChanges',
    'generatePatch',
    'triggerDeployment',
    'triggerInfraRebuild',
    'triggerRollback',
    'scheduleGoal',
    'cancelGoal',
    'listGoals',
    'triggerBatchEvolution',
    'signalOrchestration',
    'requestConsensus',
    'voteOnProposal',
    'inspectTopology',
    'discoverPeers',
    'registerPeer',
  ];

  it('should export all expected tool definitions', () => {
    const keys = Object.keys(infraSchema);
    for (const name of expectedToolNames) {
      expect(keys).toContain(name);
    }
    expect(keys).toHaveLength(expectedToolNames.length);
  });

  it('should have required fields: name, description, parameters for every tool', () => {
    for (const [key, tool] of Object.entries(infraSchema)) {
      expect(tool.name, `${key} missing name`).toBeTruthy();
      expect(tool.description, `${key} missing description`).toBeTruthy();
      expect(tool.parameters, `${key} missing parameters`).toBeDefined();
    }
  });

  it('should have parameters with type "object" and properties for every tool', () => {
    for (const [key, tool] of Object.entries(infraSchema)) {
      expect(tool.parameters.type, `${key} parameters.type`).toBe('object');
      expect(tool.parameters.properties, `${key} parameters.properties`).toBeDefined();
      expect(typeof tool.parameters.properties, `${key} parameters.properties is object`).toBe(
        'object'
      );
    }
  });

  it('should have tool names matching their schema keys', () => {
    for (const [key, tool] of Object.entries(infraSchema)) {
      expect(tool.name, `key "${key}" does not match tool.name "${tool.name}"`).toBe(key);
    }
  });

  it('should have required parameter fields listed correctly', () => {
    const requiredByTool: Record<string, string[]> = {
      stageChanges: ['modifiedFiles', 'sessionId', 'skipValidation'],
      generatePatch: ['sessionId'],
      triggerDeployment: ['reason', 'gapIds'],
      triggerInfraRebuild: ['reason'],
      triggerRollback: ['reason'],
      scheduleGoal: ['goalId', 'task', 'scheduleExpression', 'agentId', 'metadata'],
      cancelGoal: ['goalId'],
      listGoals: ['namePrefix'],
      triggerBatchEvolution: ['gapIds'],
      signalOrchestration: ['status', 'reasoning', 'nextStep', 'targetAgentId'],
      requestConsensus: ['proposal', 'voterIds'],
      voteOnProposal: ['proposalId', 'vote', 'reason'],
      inspectTopology: [],
      discoverPeers: [],
      registerPeer: ['sourceAgentId', 'targetAgentId', 'topologyType'],
    };

    for (const [name, expected] of Object.entries(requiredByTool)) {
      const tool = infraSchema[name];
      expect(tool).toBeDefined();
      expect(tool.parameters.required).toEqual(expected);
    }
  });

  it('should have additionalProperties: false for all tools', () => {
    for (const [key, tool] of Object.entries(infraSchema)) {
      expect(
        tool.parameters.additionalProperties,
        `Tool "${key}" missing additionalProperties: false`
      ).toBe(false);
    }
  });
});
