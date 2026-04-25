import { describe, it, expect } from 'vitest';
import { systemSchema } from './schema';

describe('System Domain Tool Schemas', () => {
  const expectedToolNames = [
    'triggerTrunkSync',
    'checkHealth',
    'runCognitiveHealthCheck',
    'debugAgent',
    'validateCode',
    'verifyChanges',
    'switchModel',
    'checkReputation',
    'renderComponent',
    'navigateTo',
    'uiAction',
    'renderCodeDiff',
    'renderPlanEditor',
    'setSystemConfig',
    'getSystemConfig',
    'listSystemConfigs',
    'proposeAutonomyUpdate',
    'scanMetabolism',
    'pauseWorkflow',
    'resumeWorkflow',
  ];

  it('should export all expected tool definitions', () => {
    const keys = Object.keys(systemSchema);
    for (const name of expectedToolNames) {
      expect(keys).toContain(name);
    }
    expect(keys).toHaveLength(expectedToolNames.length);
  });

  it('should have required fields: name, description, parameters for every tool', () => {
    for (const [key, tool] of Object.entries(systemSchema)) {
      expect(tool.name, `${key} missing name`).toBeTruthy();
      expect(tool.description, `${key} missing description`).toBeTruthy();
      expect(tool.parameters, `${key} missing parameters`).toBeDefined();
    }
  });

  it('should have parameters with type "object" and properties for every tool', () => {
    for (const [key, tool] of Object.entries(systemSchema)) {
      expect(tool.parameters.type, `${key} parameters.type`).toBe('object');
      expect(tool.parameters.properties, `${key} parameters.properties`).toBeDefined();
      expect(typeof tool.parameters.properties, `${key} parameters.properties is object`).toBe(
        'object'
      );
    }
  });

  it('should have tool names matching their schema keys', () => {
    for (const [key, tool] of Object.entries(systemSchema)) {
      expect(tool.name, `key "${key}" does not match tool.name "${tool.name}"`).toBe(key);
    }
  });

  it('should have required parameter fields listed correctly', () => {
    const requiredByTool: Record<string, string[]> = {
      triggerTrunkSync: ['commitMessage'],
      debugAgent: ['agentId', 'level'],
      validateCode: [],
      switchModel: ['provider', 'model'],
      checkReputation: ['agentId'],
      pauseWorkflow: ['reason'],
      resumeWorkflow: ['sessionId'],
    };

    for (const [name, expected] of Object.entries(requiredByTool)) {
      const tool = systemSchema[name];
      expect(tool).toBeDefined();
      expect(tool.parameters.required).toEqual(expected);
    }
  });

  it('should handle tools with optional required fields', () => {
    const toolsWithoutRequired = ['checkHealth', 'runCognitiveHealthCheck'];
    for (const name of toolsWithoutRequired) {
      const tool = systemSchema[name];
      expect(tool).toBeDefined();
      const hasRequired = tool.parameters.required !== undefined;
      if (hasRequired) {
        expect(Array.isArray(tool.parameters.required)).toBe(true);
      }
    }
  });

  it('should have additionalProperties: false for all tools', () => {
    for (const [key, tool] of Object.entries(systemSchema)) {
      expect(
        tool.parameters.additionalProperties,
        `Tool "${key}" missing additionalProperties: false`
      ).toBe(false);
    }
  });
});
