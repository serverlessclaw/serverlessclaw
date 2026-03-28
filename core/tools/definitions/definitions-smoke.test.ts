import { describe, it, expect } from 'vitest';
import type { IToolDefinition } from '../../lib/types/index';
import { toolDefinitions } from './index';
import { agentTools } from './agent';
import { clarificationTools } from './clarification';
import { collaborationTools } from './collaboration';
import { configTools } from './config';
import { deploymentTools } from './deployment';
import { gitTools } from './git';
import { knowledgeTools } from './knowledge';
import { mcpTools } from './mcp';
import { metadataTools } from './metadata';
import { orchestrationTools } from './orchestration';
import { schedulerDefinitions } from './scheduler';
import { skillsTools } from './skills';
import { systemTools } from './system';

const toolCategories: Record<string, Record<string, IToolDefinition>> = {
  agent: agentTools,
  clarification: clarificationTools,
  collaboration: collaborationTools,
  config: configTools,
  deployment: deploymentTools,
  git: gitTools,
  knowledge: knowledgeTools,
  mcp: mcpTools,
  metadata: metadataTools,
  orchestration: orchestrationTools,
  scheduler: schedulerDefinitions,
  skills: skillsTools,
  system: systemTools,
};

describe('tool definitions', () => {
  describe('aggregated toolDefinitions', () => {
    it('exports a non-empty record of tools', () => {
      expect(toolDefinitions).toBeDefined();
      expect(typeof toolDefinitions).toBe('object');
      expect(Object.keys(toolDefinitions).length).toBeGreaterThan(0);
    });

    it('every tool has name, description, and parameters', () => {
      for (const [key, tool] of Object.entries(toolDefinitions)) {
        expect(tool.name, `Tool "${key}" missing name`).toBeTruthy();
        expect(tool.description, `Tool "${key}" missing description`).toBeTruthy();
        expect(tool.parameters, `Tool "${key}" missing parameters`).toBeDefined();
        expect(tool.parameters.type, `Tool "${key}" parameters missing type`).toBe('object');
        expect(
          tool.parameters.properties,
          `Tool "${key}" parameters missing properties`
        ).toBeDefined();
      }
    });

    it('tool key matches tool name', () => {
      for (const [key, tool] of Object.entries(toolDefinitions)) {
        expect(tool.name, `Tool key "${key}" does not match name "${tool.name}"`).toBe(key);
      }
    });
  });

  describe.each(Object.entries(toolCategories))('%s category', (_categoryName, tools) => {
    it('exports a non-empty record', () => {
      expect(tools).toBeDefined();
      expect(Object.keys(tools).length).toBeGreaterThan(0);
    });

    it('each tool has required fields', () => {
      for (const [key, tool] of Object.entries(tools)) {
        expect(tool.name, `Tool "${key}" missing name`).toBeTruthy();
        expect(tool.description, `Tool "${key}" missing description`).toBeTruthy();
        expect(tool.parameters, `Tool "${key}" missing parameters`).toBeDefined();
      }
    });

    it('parameter schemas have type and properties', () => {
      for (const [key, tool] of Object.entries(tools)) {
        expect(tool.parameters.type, `Tool "${key}" params missing type`).toBeDefined();
        if (tool.parameters.type === 'object') {
          expect(
            tool.parameters.properties,
            `Tool "${key}" object params missing properties`
          ).toBeDefined();
        }
      }
    });
  });
});
