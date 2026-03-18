import { describe, it, expect, vi } from 'vitest';
import {
  transformToolsToOpenAI,
  mapToOpenAIRole,
  normalizeProfile,
  capEffort,
  parseConfigInt,
} from './utils';
import { ITool, ReasoningProfile } from '../types/index';
import { logger } from '../logger';

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
  },
}));

describe('transformToolsToOpenAI', () => {
  it('should transform internal tools to OpenAI format', () => {
    const tools: ITool[] = [
      {
        name: 'get_weather',
        description: 'Get the weather',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string' },
          },
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
        description: 'Get the weather',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string' },
          },
        },
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
      } as ITool,
      {
        name: 'some_image',
        type: 'image',
        description: 'An image tool',
        parameters: { type: 'object', properties: {} },
        execute: async () => 'result',
      } as unknown as ITool,
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

  it('should map other to user', () => {
    expect(mapToOpenAIRole('user')).toBe('user');
    expect(mapToOpenAIRole('unknown')).toBe('user');
  });
});

describe('normalizeProfile', () => {
  const capabilities = {
    supportedReasoningProfiles: [ReasoningProfile.STANDARD, ReasoningProfile.FAST],
  };

  it('should return requested profile if supported', () => {
    expect(normalizeProfile(ReasoningProfile.STANDARD, capabilities, 'model')).toBe(
      ReasoningProfile.STANDARD
    );
  });

  it('should fallback to a lower profile if requested is not supported', () => {
    expect(normalizeProfile(ReasoningProfile.DEEP, capabilities, 'model')).toBe(
      ReasoningProfile.STANDARD
    );
    expect(vi.mocked(logger.info)).toHaveBeenCalled();
  });

  it('should return standard if no supported profiles found', () => {
    expect(
      normalizeProfile(ReasoningProfile.DEEP, { supportedReasoningProfiles: [] }, 'model')
    ).toBe(ReasoningProfile.STANDARD);
  });
});

describe('capEffort', () => {
  it('should return requested if no max is specified', () => {
    expect(capEffort('high')).toBe('high');
  });

  it('should cap effort based on max levels', () => {
    expect(capEffort('high', 'medium')).toBe('medium');
    expect(capEffort('low', 'medium')).toBe('low');
  });

  it('should return requested if max is not in EFFORT_LEVELS', () => {
    expect(capEffort('high', 'unknown')).toBe('high');
  });
});

describe('parseConfigInt', () => {
  it('should parse valid integers', () => {
    expect(parseConfigInt('10', 5)).toBe(10);
    expect(parseConfigInt(20, 5)).toBe(20);
  });

  it('should return fallback for invalid input', () => {
    expect(parseConfigInt(null, 5)).toBe(5);
    expect(parseConfigInt(undefined, 5)).toBe(5);
    expect(parseConfigInt('abc', 5)).toBe(5);
  });
});
