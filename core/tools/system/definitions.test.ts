import { describe, it, expect } from 'vitest';
import { knowledgeSchema } from '../knowledge/schema';
import { collaborationSchema } from '../collaboration/schema';
import { infraSchema } from '../infra/schema';
import { systemSchema } from './schema';

const allSchemas = [
  ...Object.values(knowledgeSchema),
  ...Object.values(collaborationSchema),
  ...Object.values(infraSchema),
  ...Object.values(systemSchema),
];

describe('Domain-Driven Tool Definitions Integrity', () => {
  it('should not expose system-managed "userId" in LLM schemas', () => {
    for (const tool of allSchemas) {
      const properties = tool.parameters.properties as Record<string, unknown> | undefined;
      if (properties) {
        expect(properties.userId, `Tool "${tool.name}" exposes userId property.`).toBeUndefined();
      }
    }
  });

  it('should ensure all required properties are defined in the schema', () => {
    for (const tool of allSchemas) {
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
    for (const tool of allSchemas) {
      expect(
        tool.parameters.additionalProperties,
        `Tool "${tool.name}" missing additionalProperties: false`
      ).toBe(false);
    }
  });

  it('should have key essential tools defined across domains', () => {
    const names = allSchemas.map((t) => t.name);
    expect(names).toContain('listAgents');
    expect(names).toContain('createWorkspace');
    expect(names).toContain('triggerDeployment');
    expect(names).toContain('runShellCommand');
  });
});
