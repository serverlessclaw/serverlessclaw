import { describe, it, expect } from 'vitest';
import { AgentProcessOptions } from './options';
import { ReasoningProfile, TraceSource, AttachmentType } from '../types/index';

describe('AgentProcessOptions', () => {
  it('should allow creating options with default values', () => {
    const options: AgentProcessOptions = {};
    expect(options.profile).toBeUndefined();
    expect(options.context).toBeUndefined();
    expect(options.isContinuation).toBeUndefined();
    expect(options.isIsolated).toBeUndefined();
  });

  it('should allow specifying all options', () => {
    const mockContext = {} as import('aws-lambda').Context;
    const attachments = [{ type: AttachmentType.IMAGE, base64: 'abc123' }];

    const options: AgentProcessOptions = {
      profile: ReasoningProfile.DEEP,
      context: mockContext,
      isContinuation: true,
      isIsolated: false,
      initiatorId: 'agent-123',
      depth: 2,
      traceId: 'trace-456',
      nodeId: 'node-789',
      parentId: 'parent-012',
      sessionId: 'session-345',
      attachments,
      source: TraceSource.DASHBOARD,
    };

    expect(options.profile).toBe(ReasoningProfile.DEEP);
    expect(options.isContinuation).toBe(true);
    expect(options.depth).toBe(2);
    expect(options.attachments).toHaveLength(1);
    expect(options.attachments?.[0].type).toBe(AttachmentType.IMAGE);
  });

  it('should allow string source', () => {
    const options: AgentProcessOptions = {
      source: 'custom-source',
    };
    expect(options.source).toBe('custom-source');
  });
});
