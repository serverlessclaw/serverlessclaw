import { describe, it, expect } from 'vitest';
import { knowledgeSchema } from './schema';

describe('Knowledge Domain Tool Schemas', () => {
  const expectedToolNames = [
    'dispatchTask',
    'manageAgentTools',
    'listAgents',
    'createAgent',
    'deleteAgent',
    'syncAgentRegistry',
    'recallKnowledge',
    'saveMemory',
    'reportGap',
    'manageGap',
    'pruneMemory',
    'discoverSkills',
    'installSkill',
    'uninstallSkill',
    'prioritizeMemory',
    'deleteTraces',
    'refineMemory',
    'forceReleaseLock',
    'technicalResearch',
    'registerMCPServer',
    'unregisterMCPServer',
    'getMcpConfig',
    'checkConfig',
    'setSystemConfig',
    'listSystemConfigs',
    'getSystemConfigMetadata',
    'inspectTrace',
  ];

  it('should export all expected tool definitions', () => {
    const keys = Object.keys(knowledgeSchema);
    for (const name of expectedToolNames) {
      expect(keys).toContain(name);
    }
    expect(keys).toHaveLength(expectedToolNames.length);
  });

  it('should have required fields: name, description, parameters for every tool', () => {
    for (const [key, tool] of Object.entries(knowledgeSchema)) {
      expect(tool.name, `${key} missing name`).toBeTruthy();
      expect(tool.description, `${key} missing description`).toBeTruthy();
      expect(tool.parameters, `${key} missing parameters`).toBeDefined();
    }
  });

  it('should have parameters with type "object" and properties for every tool', () => {
    for (const [key, tool] of Object.entries(knowledgeSchema)) {
      expect(tool.parameters.type, `${key} parameters.type`).toBe('object');
      expect(tool.parameters.properties, `${key} parameters.properties`).toBeDefined();
      expect(typeof tool.parameters.properties, `${key} parameters.properties is object`).toBe(
        'object'
      );
    }
  });

  it('should have tool names matching their schema keys', () => {
    for (const [key, tool] of Object.entries(knowledgeSchema)) {
      expect(tool.name, `key "${key}" does not match tool.name "${tool.name}"`).toBe(key);
    }
  });

  it('should have required parameter fields listed correctly', () => {
    const requiredByTool: Record<string, string[]> = {
      dispatchTask: ['agentId', 'task', 'metadata'],
      manageAgentTools: ['agentId', 'toolNames'],
      listAgents: [],
      createAgent: ['agentId', 'name', 'systemPrompt'],
      deleteAgent: ['agentId'],
      syncAgentRegistry: [],
      recallKnowledge: ['query', 'category'],
      saveMemory: ['content', 'category'],
      reportGap: ['content', 'impact', 'urgency', 'category'],
      manageGap: [],
      pruneMemory: ['partitionKey', 'timestamp'],
      discoverSkills: [],
      installSkill: ['skillName', 'agentId'],
      uninstallSkill: ['skillName', 'agentId'],
      prioritizeMemory: ['timestamp'],
      deleteTraces: ['traceId'],
      refineMemory: ['timestamp'],
      forceReleaseLock: ['lockId'],
      registerMCPServer: ['serverName', 'command', 'env'],
      unregisterMCPServer: ['serverName'],
      checkConfig: [],
      setSystemConfig: ['key', 'value'],
      listSystemConfigs: [],
      getSystemConfigMetadata: [],
      inspectTrace: ['traceId'],
    };

    for (const [name, expected] of Object.entries(requiredByTool)) {
      const tool = knowledgeSchema[name];
      expect(tool).toBeDefined();
      expect(tool.parameters.required).toEqual(expected);
    }
  });

  it('should handle getMcpConfig with no required fields or missing required', () => {
    const tool = knowledgeSchema.getMcpConfig;
    expect(tool).toBeDefined();
    expect(tool.parameters.required).toBeUndefined();
  });

  it('should have additionalProperties: false for all tools', () => {
    for (const [key, tool] of Object.entries(knowledgeSchema)) {
      expect(
        tool.parameters.additionalProperties,
        `Tool "${key}" missing additionalProperties: false`
      ).toBe(false);
    }
  });
});
