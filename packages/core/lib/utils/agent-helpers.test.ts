import { describe, it, expect, vi } from 'vitest';
import {
  createAgent,
  extractBaseUserId,
  validatePayload,
  extractPayload,
  detectFailure,
  isTaskPaused,
} from './agent-helpers';
import { ReasoningProfile, AttachmentType } from '../types/index';

vi.mock('../../tools/index', () => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
}));

vi.mock('../agent', () => ({
  Agent: vi.fn().mockImplementation(function (this: any, m: any, p: any, t: any, sp: any) {
    this.memory = m;
    this.provider = p;
    this.tools = t;
    this.config = sp; // In createAgent, the 4th arg is the config object
    this.systemPrompt = sp?.systemPrompt;
    this.getConfig = () => this.config;
  }),
}));

describe('createAgent', () => {
  const mockConfig = { systemPrompt: 'Base Prompt', enabled: true };
  const mockMemory = {} as any;
  const mockProvider = {
    getCapabilities: vi.fn().mockResolvedValue({
      supportedReasoningProfiles: [ReasoningProfile.STANDARD],
      supportedAttachmentTypes: [AttachmentType.IMAGE, AttachmentType.FILE],
    }),
  } as any;

  it('should append English instructions for locale=en', async () => {
    const agent = (await createAgent(
      'test',
      mockConfig as any,
      mockMemory,
      mockProvider,
      'en'
    )) as any;
    expect(agent.systemPrompt).toBe('Base Prompt'); // EN instruction is empty string in constants
  });

  it('should append Chinese instructions for locale=cn', async () => {
    const agent = (await createAgent(
      'test',
      mockConfig as any,
      mockMemory,
      mockProvider,
      'cn'
    )) as any;
    expect(agent.getConfig()?.systemPrompt).toContain('Base Prompt');
    expect(agent.getConfig()?.systemPrompt).toContain('Chinese (中文)');
  });
});

describe('extractBaseUserId', () => {
  it('should extract base userId when CONV# prefix is present', () => {
    expect(extractBaseUserId('CONV#user123')).toBe('user123');
  });

  it('should extract base userId from deep dashboard session identifiers', () => {
    expect(extractBaseUserId('CONV#dashboard-user#session_123')).toBe('dashboard-user');
  });

  it('should handle complex dashboard session identifiers', () => {
    expect(extractBaseUserId('CONV#dashboard-user#session_1774075326991')).toBe('dashboard-user');
  });

  it('should return original userId when no CONV# prefix', () => {
    expect(extractBaseUserId('user123')).toBe('user123');
  });

  it('should return original userId for other prefixed strings', () => {
    expect(extractBaseUserId('BUILD#123')).toBe('BUILD#123');
  });

  it('should handle empty string', () => {
    expect(extractBaseUserId('')).toBe('');
  });
});

describe('validatePayload', () => {
  it('should return true when all required fields are present', () => {
    const payload = { userId: 'u1', task: 't1' };
    expect(validatePayload(payload, ['userId', 'task'])).toBe(true);
  });

  it('should return false and log error when a required field is missing', () => {
    const payload = { userId: 'u1' };
    expect(validatePayload(payload, ['userId', 'task'])).toBe(false);
  });

  it('should return true when payload has falsy but valid values (0, false)', () => {
    const payload = { userId: 'u1', task: 't1', depth: 0, isContinuation: false };
    expect(validatePayload(payload, ['userId', 'task', 'depth', 'isContinuation'])).toBe(true);
  });

  it('should return false when payload is null or undefined', () => {
    expect(validatePayload(null, ['userId'])).toBe(false);
    expect(validatePayload(undefined, ['userId'])).toBe(false);
  });
});

describe('extractPayload', () => {
  it('should extract payload from EventBridge event with detail wrapper', () => {
    const event = { detail: { userId: 'user123', message: 'hello' } };
    const result = extractPayload(event);
    expect(result).toEqual({ userId: 'user123', message: 'hello' });
  });

  it('should return direct payload when no detail wrapper', () => {
    const event = { userId: 'user123', message: 'hello' };
    const result = extractPayload(event);
    expect(result).toEqual({ userId: 'user123', message: 'hello' });
  });

  it('should handle empty event', () => {
    const event = {};
    const result = extractPayload(event);
    expect(result).toEqual({});
  });
});

describe('detectFailure', () => {
  it('should return true for internal error response (EN)', () => {
    expect(detectFailure('I encountered an internal error')).toBe(true);
  });

  it('should return true for failure responses (EN)', () => {
    expect(detectFailure('I encountered an internal error: timeout')).toBe(true);
  });

  it('should return true for localized failure responses (CN)', () => {
    expect(detectFailure('在我的认知处理周期中遇到了内部错误，无法继续')).toBe(true);
  });

  it('should return false for normal response', () => {
    expect(detectFailure('Task completed successfully')).toBe(false);
    expect(detectFailure('任务成功完成')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(detectFailure('')).toBe(false);
  });
});

describe('isTaskPaused', () => {
  it('should return true for TASK_PAUSED response', () => {
    expect(isTaskPaused('TASK_PAUSED')).toBe(true);
  });

  it('should return false for normal response', () => {
    expect(isTaskPaused('Task completed')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isTaskPaused('')).toBe(false);
  });
});
