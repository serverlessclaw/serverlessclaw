import { describe, it, expect } from 'vitest';
import { toolDefinitions } from './definitions/index';

describe('Tool Definitions Schema Integrity', () => {
  const tools = Object.values(toolDefinitions);

  it('should not expose system-managed "userId" in LLM schemas', () => {
    for (const tool of tools) {
      const properties = tool.parameters.properties as Record<string, unknown> | undefined;
      if (properties) {
        expect(properties.userId).toBeUndefined();
      }
    }
  });

  it('should ensure all required properties are defined in the schema', () => {
    for (const tool of tools) {
      const properties = tool.parameters.properties as Record<string, unknown> | undefined;
      const { required } = tool.parameters;
      if (required && properties) {
        for (const req of required) {
          expect(
            properties[req],
            `Tool "${tool.name}" requires "${req}" but it is not defined in properties.`
          ).toBeDefined();
        }
      }
    }
  });

  it('should have additionalProperties: false for all tools (OpenAI Strict requirement)', () => {
    for (const tool of tools) {
      expect(tool.parameters.additionalProperties).toBe(false);
    }
  });

  it('should have getAgentRegistrySummary tool', () => {
    expect(toolDefinitions.getAgentRegistrySummary).toBeDefined();
    expect(toolDefinitions.getAgentRegistrySummary.name).toBe('getAgentRegistrySummary');
  });
});
