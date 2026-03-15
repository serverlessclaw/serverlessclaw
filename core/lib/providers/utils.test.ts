import { describe, it, expect } from 'vitest';
import { transformToolsToOpenAI, mapToOpenAIRole, capEffort } from './utils';
import { ITool } from '../types/index';

describe('transformToolsToOpenAI', () => {
  it('should return empty array for undefined tools', () => {
    expect(transformToolsToOpenAI(undefined)).toEqual([]);
  });

  it('should return empty array for empty tools array', () => {
    expect(transformToolsToOpenAI([])).toEqual([]);
  });

  it('should transform function tools to OpenAI format', () => {
    const tools = [
      {
        name: 'get_weather',
        description: 'Get the weather for a location',
        parameters: {
          type: 'object' as const,
          properties: {
            location: { type: 'string' as const },
          },
          required: ['location'],
        },
        execute: async () => 'result',
      },
    ];

    const result = transformToolsToOpenAI(tools);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get the weather for a location',
        parameters: tools[0].parameters,
        strict: true,
      },
    });
  });

  it('should filter out non-function tools', () => {
    const tools = [
      {
        name: 'get_weather',
        description: 'Get the weather',
        parameters: { type: 'object' as const, properties: {} },
        execute: async () => 'result',
      },
      {
        name: 'some_image',
        type: 'image',
        description: 'An image',
        parameters: { type: 'object' as const, properties: {} },
        execute: async () => 'result',
      } as ITool,
    ];

    const result = transformToolsToOpenAI(tools);

    expect(result).toHaveLength(1);
    expect(result[0].function.name).toBe('get_weather');
  });
});

describe('mapToOpenAIRole', () => {
  it('should map system to developer', () => {
    expect(mapToOpenAIRole('system')).toBe('developer');
  });

  it('should map developer to developer', () => {
    expect(mapToOpenAIRole('developer')).toBe('developer');
  });

  it('should map assistant to assistant', () => {
    expect(mapToOpenAIRole('assistant')).toBe('assistant');
  });

  it('should map tool to tool', () => {
    expect(mapToOpenAIRole('tool')).toBe('tool');
  });

  it('should map unknown roles to user', () => {
    expect(mapToOpenAIRole('unknown')).toBe('user');
  });
});

describe('capEffort', () => {
  it('should return requested if no max', () => {
    expect(capEffort('high')).toBe('high');
  });

  it('should cap effort at max level', () => {
    expect(capEffort('high', 'medium')).toBe('medium');
  });

  it('should not cap if requested is below max', () => {
    expect(capEffort('low', 'high')).toBe('low');
  });

  it('should return requested if max not found in levels', () => {
    expect(capEffort('high', 'super')).toBe('high');
  });
});
