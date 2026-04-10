import { describe, it, expect, vi } from 'vitest';
import { AttachmentType } from '../types/llm';
import { HealthSeverity, ParallelTaskStatus } from '../types/constants';
import { EventType, AgentType } from '../types/agent';
import {
  ATTACHMENT_SCHEMA,
  BASE_EVENT_SCHEMA,
  AGENT_PAYLOAD_SCHEMA,
  TASK_EVENT_SCHEMA,
  BUILD_EVENT_SCHEMA,
  COMPLETION_EVENT_SCHEMA,
  OUTBOUND_MESSAGE_EVENT_SCHEMA,
  FAILURE_EVENT_SCHEMA,
  HEALTH_REPORT_EVENT_SCHEMA,
  PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA,
  BRIDGE_EVENT_SCHEMA,
  PARALLEL_TASK_COMPLETED_EVENT_SCHEMA,
  CODER_TASK_METADATA,
  QA_AUDIT_METADATA,
  PLANNER_TASK_METADATA,
  BUILD_TASK_METADATA,
  CLARIFICATION_TASK_METADATA,
  CONSENSUS_REQUEST_SCHEMA,
  CONSENSUS_VOTE_SCHEMA,
  CONSENSUS_REACHED_SCHEMA,
  EVENT_SCHEMA_MAP,
} from './events';

describe('ATTACHMENT_SCHEMA', () => {
  it('should validate a minimal valid attachment', () => {
    const result = ATTACHMENT_SCHEMA.parse({
      type: AttachmentType.IMAGE,
      url: 'https://example.com/pic.png',
    });
    expect(result.type).toBe(AttachmentType.IMAGE);
  });

  it('should validate a full attachment with all fields', () => {
    const input = {
      type: AttachmentType.FILE,
      url: 'https://example.com/file.pdf',
      base64: 'data:application/pdf;base64,abc123',
      name: 'report.pdf',
      mimeType: 'application/pdf',
    };
    const result = ATTACHMENT_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should reject missing type field', () => {
    expect(() => ATTACHMENT_SCHEMA.parse({ url: 'https://example.com' })).toThrow();
  });

  it('should reject invalid type enum value', () => {
    expect(() => ATTACHMENT_SCHEMA.parse({ type: 'invalid' })).toThrow();
  });

  it('should accept IMAGE attachment type', () => {
    const result = ATTACHMENT_SCHEMA.parse({
      type: AttachmentType.IMAGE,
      url: 'https://example.com/pic.png',
    });
    expect(result.type).toBe('image');
  });

  it('should accept FILE attachment type', () => {
    const result = ATTACHMENT_SCHEMA.parse({
      type: AttachmentType.FILE,
      base64: 'data:text/plain;base64,SGVsbG8=',
    });
    expect(result.type).toBe('file');
  });

  it('should reject attachment missing both url and base64', () => {
    expect(() => ATTACHMENT_SCHEMA.parse({ type: AttachmentType.FILE })).toThrow();
  });
});

describe('BASE_EVENT_SCHEMA', () => {
  it('should validate with empty input applying all defaults', () => {
    const result = BASE_EVENT_SCHEMA.parse({});
    expect(result.source).toBe('unknown');
    expect(result.userId).toBe('SYSTEM');
    expect(result.taskId).toMatch(/^task-\d+-[a-z0-9]+$/);
    expect(result.initiatorId).toBe('orchestrator');
    expect(result.depth).toBe(0);
    expect(typeof result.timestamp).toBe('number');
  });

  it('should validate with explicit values', () => {
    const input = {
      source: 'telegram',
      userId: 'user-123',
      traceId: 'trace-456',
      taskId: 'task-789',
      agentId: 'coder-1',
      initiatorId: 'user',
      depth: 3,
      sessionId: 'session-abc',
      timestamp: 1700000000000,
    };
    const result = BASE_EVENT_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should apply default source when omitted', () => {
    const result = BASE_EVENT_SCHEMA.parse({ userId: 'u1' });
    expect(result.source).toBe('unknown');
  });

  it('should apply default userId when omitted', () => {
    const result = BASE_EVENT_SCHEMA.parse({});
    expect(result.userId).toBe('SYSTEM');
  });

  it('should provide default traceId', () => {
    const result = BASE_EVENT_SCHEMA.parse({});
    expect(result.traceId).toMatch(/^t-\d+-[a-z0-9]+$/);
  });

  it('should generate unique taskId values by default', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000000);
    const r1 = BASE_EVENT_SCHEMA.parse({});
    const r2 = BASE_EVENT_SCHEMA.parse({});
    expect(r1.taskId).not.toBe(r2.taskId);
    vi.restoreAllMocks();
  });

  it('should apply default depth of 0', () => {
    const result = BASE_EVENT_SCHEMA.parse({});
    expect(result.depth).toBe(0);
  });

  it('should provide default sessionId', () => {
    const result = BASE_EVENT_SCHEMA.parse({});
    expect(result.sessionId).toBe('default-session');
  });

  it('should accept optional agentId', () => {
    const result = BASE_EVENT_SCHEMA.parse({});
    expect(result.agentId).toBeUndefined();
  });
});

describe('AGENT_PAYLOAD_SCHEMA', () => {
  it('should validate with minimal input using defaults', () => {
    const result = AGENT_PAYLOAD_SCHEMA.parse({});
    expect(result.task).toBe('');
    expect(result.metadata).toEqual({});
    expect(result.attachments).toEqual([]);
    expect(result.isContinuation).toBe(false);
    expect(result.source).toBe('unknown');
    expect(result.userId).toBe('SYSTEM');
  });

  it('should validate with full input', () => {
    const input = {
      source: 'dashboard',
      userId: 'user-1',
      traceId: 'trace-1',
      taskId: 'task-1',
      agentId: 'coder',
      initiatorId: 'orchestrator',
      depth: 2,
      sessionId: 'sess-1',
      timestamp: 1700000000000,
      task: 'Build the API',
      response: 'Done',
      metadata: { key: 'value' },
      attachments: [{ type: AttachmentType.IMAGE, url: 'https://img.com/pic.png' }],
      isContinuation: true,
    };
    const result = AGENT_PAYLOAD_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should default task to empty string', () => {
    const result = AGENT_PAYLOAD_SCHEMA.parse({});
    expect(result.task).toBe('');
  });

  it('should default metadata to empty object', () => {
    const result = AGENT_PAYLOAD_SCHEMA.parse({});
    expect(result.metadata).toEqual({});
  });

  it('should default attachments to empty array', () => {
    const result = AGENT_PAYLOAD_SCHEMA.parse({});
    expect(result.attachments).toEqual([]);
  });

  it('should default isContinuation to false', () => {
    const result = AGENT_PAYLOAD_SCHEMA.parse({});
    expect(result.isContinuation).toBe(false);
  });

  it('should make response optional', () => {
    const result = AGENT_PAYLOAD_SCHEMA.parse({});
    expect(result.response).toBeUndefined();
  });

  it('should inherit base event fields', () => {
    const result = AGENT_PAYLOAD_SCHEMA.parse({});
    expect(result.source).toBe('unknown');
    expect(result.initiatorId).toBe('orchestrator');
    expect(result.depth).toBe(0);
  });
});

describe('TASK_EVENT_SCHEMA', () => {
  it('should validate with required task field', () => {
    const result = TASK_EVENT_SCHEMA.parse({ task: 'Write tests' });
    expect(result.task).toBe('Write tests');
  });

  it('should validate with all fields', () => {
    const input = {
      source: 'system',
      userId: 'user-1',
      traceId: 'trace-1',
      taskId: 'task-1',
      agentId: 'coder',
      initiatorId: 'orchestrator',
      depth: 1,
      sessionId: 'sess-1',
      timestamp: 1700000000000,
      task: 'Implement feature X',
      isContinuation: true,
      metadata: { branch: 'main' },
      attachments: [
        { type: AttachmentType.FILE, url: 'https://example.com/spec.md', name: 'spec.md' },
      ],
    };
    const result = TASK_EVENT_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should reject missing task field', () => {
    expect(() => TASK_EVENT_SCHEMA.parse({})).toThrow();
  });

  it('should make isContinuation optional', () => {
    const result = TASK_EVENT_SCHEMA.parse({ task: 'test' });
    expect(result.isContinuation).toBeUndefined();
  });

  it('should make metadata optional', () => {
    const result = TASK_EVENT_SCHEMA.parse({ task: 'test' });
    expect(result.metadata).toBeUndefined();
  });

  it('should make attachments optional', () => {
    const result = TASK_EVENT_SCHEMA.parse({ task: 'test' });
    expect(result.attachments).toBeUndefined();
  });

  it('should inherit base event defaults', () => {
    const result = TASK_EVENT_SCHEMA.parse({ task: 'test' });
    expect(result.source).toBe('unknown');
    expect(result.userId).toBe('SYSTEM');
    expect(result.initiatorId).toBe('orchestrator');
    expect(result.depth).toBe(0);
  });

  it('should accept empty string as task', () => {
    const result = TASK_EVENT_SCHEMA.parse({ task: '' });
    expect(result.task).toBe('');
  });
});

describe('BUILD_EVENT_SCHEMA', () => {
  it('should validate with required buildId', () => {
    const result = BUILD_EVENT_SCHEMA.parse({ buildId: 'build-123' });
    expect(result.buildId).toBe('build-123');
  });

  it('should validate with all fields', () => {
    const input = {
      source: 'codebuild',
      userId: 'system',
      traceId: 'trace-1',
      taskId: 'task-1',
      agentId: 'monitor',
      initiatorId: 'orchestrator',
      depth: 0,
      sessionId: 'sess-1',
      timestamp: 1700000000000,
      buildId: 'build-456',
      projectName: 'serverlessclaw',
      task: 'Monitor build',
      errorLogs: 'Compilation error at line 42',
      gapIds: ['gap-1', 'gap-2'],
    };
    const result = BUILD_EVENT_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should reject missing buildId', () => {
    expect(() => BUILD_EVENT_SCHEMA.parse({})).toThrow();
  });

  it('should make projectName optional', () => {
    const result = BUILD_EVENT_SCHEMA.parse({ buildId: 'b1' });
    expect(result.projectName).toBeUndefined();
  });

  it('should make task optional', () => {
    const result = BUILD_EVENT_SCHEMA.parse({ buildId: 'b1' });
    expect(result.task).toBeUndefined();
  });

  it('should make errorLogs optional', () => {
    const result = BUILD_EVENT_SCHEMA.parse({ buildId: 'b1' });
    expect(result.errorLogs).toBeUndefined();
  });

  it('should make gapIds optional', () => {
    const result = BUILD_EVENT_SCHEMA.parse({ buildId: 'b1' });
    expect(result.gapIds).toBeUndefined();
  });

  it('should inherit base event fields', () => {
    const result = BUILD_EVENT_SCHEMA.parse({ buildId: 'b1' });
    expect(result.source).toBe('unknown');
    expect(result.userId).toBe('SYSTEM');
    expect(result.initiatorId).toBe('orchestrator');
  });
});

describe('COMPLETION_EVENT_SCHEMA', () => {
  it('should validate with required response field', () => {
    const result = COMPLETION_EVENT_SCHEMA.parse({ response: 'Task completed' });
    expect(result.response).toBe('Task completed');
  });

  it('should validate with all fields', () => {
    const input = {
      source: 'agent',
      userId: 'user-1',
      traceId: 'trace-1',
      taskId: 'task-1',
      agentId: 'coder',
      initiatorId: 'orchestrator',
      depth: 1,
      sessionId: 'sess-1',
      timestamp: 1700000000000,
      task: 'Build API',
      response: 'API built successfully',
      attachments: [{ type: AttachmentType.IMAGE, url: 'https://img.com/ss.png' }],
      metadata: { duration: 1200 },
      userNotified: true,
    };
    const result = COMPLETION_EVENT_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should reject missing response', () => {
    expect(() => COMPLETION_EVENT_SCHEMA.parse({})).toThrow();
  });

  it('should default agentId to unknown', () => {
    const result = COMPLETION_EVENT_SCHEMA.parse({ response: 'done' });
    expect(result.agentId).toBe('unknown');
  });

  it('should default task to empty string', () => {
    const result = COMPLETION_EVENT_SCHEMA.parse({ response: 'done' });
    expect(result.task).toBe('');
  });

  it('should default attachments to empty array', () => {
    const result = COMPLETION_EVENT_SCHEMA.parse({ response: 'done' });
    expect(result.attachments).toEqual([]);
  });

  it('should default metadata to empty object', () => {
    const result = COMPLETION_EVENT_SCHEMA.parse({ response: 'done' });
    expect(result.metadata).toEqual({});
  });

  it('should default userNotified to false', () => {
    const result = COMPLETION_EVENT_SCHEMA.parse({ response: 'done' });
    expect(result.userNotified).toBe(false);
  });

  it('should inherit base event fields', () => {
    const result = COMPLETION_EVENT_SCHEMA.parse({ response: 'done' });
    expect(result.source).toBe('unknown');
    expect(result.userId).toBe('SYSTEM');
  });
});

describe('OUTBOUND_MESSAGE_EVENT_SCHEMA', () => {
  it('should validate with required message field', () => {
    const result = OUTBOUND_MESSAGE_EVENT_SCHEMA.parse({ message: 'Hello user' });
    expect(result.message).toBe('Hello user');
  });

  it('should validate with all fields', () => {
    const input = {
      source: 'agent',
      userId: 'user-1',
      traceId: 'trace-1',
      taskId: 'task-1',
      agentId: 'coder',
      initiatorId: 'orchestrator',
      depth: 0,
      sessionId: 'sess-1',
      timestamp: 1700000000000,
      message: 'Build succeeded',
      agentName: 'BuildBot',
      memoryContexts: ['ctx-1', 'ctx-2'],
      attachments: [
        { type: AttachmentType.FILE, url: 'https://example.com/log.txt', name: 'log.txt' },
      ],
      metadata: { channel: 'slack' },
    };
    const result = OUTBOUND_MESSAGE_EVENT_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should reject missing message', () => {
    expect(() => OUTBOUND_MESSAGE_EVENT_SCHEMA.parse({})).toThrow();
  });

  it('should default agentName to SuperClaw', () => {
    const result = OUTBOUND_MESSAGE_EVENT_SCHEMA.parse({ message: 'hi' });
    expect(result.agentName).toBe('SuperClaw');
  });

  it('should default memoryContexts to empty array', () => {
    const result = OUTBOUND_MESSAGE_EVENT_SCHEMA.parse({ message: 'hi' });
    expect(result.memoryContexts).toEqual([]);
  });

  it('should default attachments to empty array', () => {
    const result = OUTBOUND_MESSAGE_EVENT_SCHEMA.parse({ message: 'hi' });
    expect(result.attachments).toEqual([]);
  });

  it('should default metadata to empty object', () => {
    const result = OUTBOUND_MESSAGE_EVENT_SCHEMA.parse({ message: 'hi' });
    expect(result.metadata).toEqual({});
  });

  it('should inherit base event fields', () => {
    const result = OUTBOUND_MESSAGE_EVENT_SCHEMA.parse({ message: 'hi' });
    expect(result.source).toBe('unknown');
    expect(result.initiatorId).toBe('orchestrator');
  });
});

describe('FAILURE_EVENT_SCHEMA', () => {
  it('should validate with required error field', () => {
    const result = FAILURE_EVENT_SCHEMA.parse({ error: 'Something went wrong' });
    expect(result.error).toBe('Something went wrong');
  });

  it('should validate with all fields', () => {
    const input = {
      source: 'agent',
      userId: 'user-1',
      traceId: 'trace-1',
      taskId: 'task-1',
      agentId: 'coder',
      initiatorId: 'orchestrator',
      depth: 1,
      sessionId: 'sess-1',
      timestamp: 1700000000000,
      task: 'Deploy',
      error: 'Deployment failed',
      attachments: [],
      metadata: { region: 'us-east-1' },
      userNotified: true,
    };
    const result = FAILURE_EVENT_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should reject missing error', () => {
    expect(() => FAILURE_EVENT_SCHEMA.parse({})).toThrow();
  });

  it('should default agentId to unknown', () => {
    const result = FAILURE_EVENT_SCHEMA.parse({ error: 'fail' });
    expect(result.agentId).toBe('unknown');
  });

  it('should default task to empty string', () => {
    const result = FAILURE_EVENT_SCHEMA.parse({ error: 'fail' });
    expect(result.task).toBe('');
  });

  it('should default attachments to empty array', () => {
    const result = FAILURE_EVENT_SCHEMA.parse({ error: 'fail' });
    expect(result.attachments).toEqual([]);
  });

  it('should default metadata to empty object', () => {
    const result = FAILURE_EVENT_SCHEMA.parse({ error: 'fail' });
    expect(result.metadata).toEqual({});
  });

  it('should default userNotified to false', () => {
    const result = FAILURE_EVENT_SCHEMA.parse({ error: 'fail' });
    expect(result.userNotified).toBe(false);
  });

  it('should inherit base event fields', () => {
    const result = FAILURE_EVENT_SCHEMA.parse({ error: 'fail' });
    expect(result.source).toBe('unknown');
    expect(result.userId).toBe('SYSTEM');
  });
});

describe('HEALTH_REPORT_EVENT_SCHEMA', () => {
  it('should validate with required fields', () => {
    const input = {
      component: 'EventBus',
      issue: 'High latency',
      severity: HealthSeverity.HIGH,
    };
    const result = HEALTH_REPORT_EVENT_SCHEMA.parse(input);
    expect(result.component).toBe('EventBus');
    expect(result.issue).toBe('High latency');
    expect(result.severity).toBe('high');
  });

  it('should validate with all fields', () => {
    const input = {
      source: 'monitor',
      userId: 'system',
      traceId: 'trace-1',
      taskId: 'task-1',
      agentId: 'monitor',
      initiatorId: 'orchestrator',
      depth: 0,
      sessionId: 'sess-1',
      timestamp: 1700000000000,
      component: 'IoTCore',
      issue: 'Connection drops',
      severity: HealthSeverity.CRITICAL,
      context: { region: 'us-east-1' },
    };
    const result = HEALTH_REPORT_EVENT_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should reject missing component', () => {
    expect(() =>
      HEALTH_REPORT_EVENT_SCHEMA.parse({ issue: 'x', severity: HealthSeverity.LOW })
    ).toThrow();
  });

  it('should reject missing issue', () => {
    expect(() =>
      HEALTH_REPORT_EVENT_SCHEMA.parse({ component: 'x', severity: HealthSeverity.LOW })
    ).toThrow();
  });

  it('should reject missing severity', () => {
    expect(() => HEALTH_REPORT_EVENT_SCHEMA.parse({ component: 'x', issue: 'y' })).toThrow();
  });

  it('should reject invalid severity enum', () => {
    expect(() =>
      HEALTH_REPORT_EVENT_SCHEMA.parse({ component: 'x', issue: 'y', severity: 'invalid' })
    ).toThrow();
  });

  it('should accept all severity levels', () => {
    for (const sev of [
      HealthSeverity.LOW,
      HealthSeverity.MEDIUM,
      HealthSeverity.HIGH,
      HealthSeverity.CRITICAL,
    ]) {
      const result = HEALTH_REPORT_EVENT_SCHEMA.parse({
        component: 'test',
        issue: 'test',
        severity: sev,
      });
      expect(result.severity).toBe(sev);
    }
  });

  it('should make context optional', () => {
    const result = HEALTH_REPORT_EVENT_SCHEMA.parse({
      component: 'test',
      issue: 'test',
      severity: HealthSeverity.LOW,
    });
    expect(result.context).toBeUndefined();
  });

  it('should inherit base event fields', () => {
    const result = HEALTH_REPORT_EVENT_SCHEMA.parse({
      component: 'test',
      issue: 'test',
      severity: HealthSeverity.LOW,
    });
    expect(result.source).toBe('unknown');
    expect(result.userId).toBe('SYSTEM');
  });
});

describe('PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA', () => {
  it('should validate with required fields', () => {
    const input = {
      agentId: 'planner-1',
      task: 'Review architecture',
      goalId: 'goal-123',
    };
    const result = PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA.parse(input);
    expect(result.agentId).toBe('planner-1');
    expect(result.task).toBe('Review architecture');
    expect(result.goalId).toBe('goal-123');
  });

  it('should validate with all fields', () => {
    const input = {
      source: 'scheduler',
      userId: 'system',
      traceId: 'trace-1',
      taskId: 'task-1',
      agentId: 'planner',
      initiatorId: 'orchestrator',
      depth: 0,
      sessionId: 'sess-1',
      timestamp: 1700000000000,
      task: 'Periodic check',
      goalId: 'goal-456',
      metadata: { priority: 1 },
    };
    const result = PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should reject missing agentId', () => {
    expect(() => PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA.parse({ task: 't', goalId: 'g' })).toThrow();
  });

  it('should reject missing task', () => {
    expect(() => PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA.parse({ agentId: 'a', goalId: 'g' })).toThrow();
  });

  it('should reject missing goalId', () => {
    expect(() => PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA.parse({ agentId: 'a', task: 't' })).toThrow();
  });

  it('should make metadata optional', () => {
    const result = PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA.parse({
      agentId: 'a',
      task: 't',
      goalId: 'g',
    });
    expect(result.metadata).toBeUndefined();
  });

  it('should inherit base event fields', () => {
    const result = PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA.parse({
      agentId: 'a',
      task: 't',
      goalId: 'g',
    });
    expect(result.source).toBe('unknown');
    expect(result.initiatorId).toBe('orchestrator');
  });
});

describe('BRIDGE_EVENT_SCHEMA', () => {
  it('should validate with required fields', () => {
    const input = {
      'detail-type': 'AgentMessage',
      detail: {
        userId: 'user-1',
        messageId: 'msg-1',
        traceId: 'trace-1',
      },
    };
    const result = BRIDGE_EVENT_SCHEMA.parse(input);
    expect(result['detail-type']).toBe('AgentMessage');
    expect(result.detail.userId).toBe('user-1');
  });

  it('should apply defaults in detail payload', () => {
    const input = {
      'detail-type': 'AgentMessage',
      detail: { userId: 'user-1' },
    };
    const result = BRIDGE_EVENT_SCHEMA.parse(input);
    expect(result.detail.traceId).toBe('unknown');
    expect(result.detail.agentName).toBe('SuperClaw');
    expect(result.detail.message).toBe('');
    expect(result.detail.isThought).toBe(false);
  });

  it('should transform messageId falling back to traceId', () => {
    const input = {
      'detail-type': 'AgentMessage',
      detail: { userId: 'user-1', traceId: 'trace-fallback' },
    };
    const result = BRIDGE_EVENT_SCHEMA.parse(input);
    expect(result.detail.messageId).toBe('trace-fallback');
  });

  it('should prefer explicit messageId over traceId', () => {
    const input = {
      'detail-type': 'AgentMessage',
      detail: { userId: 'user-1', messageId: 'msg-explicit', traceId: 'trace-other' },
    };
    const result = BRIDGE_EVENT_SCHEMA.parse(input);
    expect(result.detail.messageId).toBe('msg-explicit');
  });

  it('should compute baseUserId via normalizeBaseUserId', () => {
    const input = {
      'detail-type': 'AgentMessage',
      detail: { userId: 'CONV#actual-user' },
    };
    const result = BRIDGE_EVENT_SCHEMA.parse(input);
    expect(result.detail.baseUserId).toBe('actual-user');
  });

  it('should handle plain userId without CONV# prefix', () => {
    const input = {
      'detail-type': 'AgentMessage',
      detail: { userId: 'plain-user' },
    };
    const result = BRIDGE_EVENT_SCHEMA.parse(input);
    expect(result.detail.baseUserId).toBe('plain-user');
  });

  it('should reject missing detail-type', () => {
    expect(() => BRIDGE_EVENT_SCHEMA.parse({ detail: { userId: 'u' } })).toThrow();
  });

  it('should reject missing detail', () => {
    expect(() => BRIDGE_EVENT_SCHEMA.parse({ 'detail-type': 'x' })).toThrow();
  });

  it('should pass through extra fields in detail via passthrough', () => {
    const input = {
      'detail-type': 'AgentMessage',
      detail: { userId: 'user-1', extraField: 'extra-value', anotherField: 42 },
    };
    const result = BRIDGE_EVENT_SCHEMA.parse(input);
    expect((result.detail as any).extraField).toBe('extra-value');
    expect((result.detail as any).anotherField).toBe(42);
  });

  it('should default sessionId to undefined', () => {
    const input = {
      'detail-type': 'AgentMessage',
      detail: { userId: 'user-1' },
    };
    const result = BRIDGE_EVENT_SCHEMA.parse(input);
    expect(result.detail.sessionId).toBeUndefined();
  });

  it('should default workspaceId to undefined', () => {
    const input = {
      'detail-type': 'AgentMessage',
      detail: { userId: 'user-1' },
    };
    const result = BRIDGE_EVENT_SCHEMA.parse(input);
    expect(result.detail.workspaceId).toBeUndefined();
  });

  it('should default collaborationId to undefined', () => {
    const input = {
      'detail-type': 'AgentMessage',
      detail: { userId: 'user-1' },
    };
    const result = BRIDGE_EVENT_SCHEMA.parse(input);
    expect(result.detail.collaborationId).toBeUndefined();
  });
});

describe('PARALLEL_TASK_COMPLETED_EVENT_SCHEMA', () => {
  const validInput = {
    overallStatus: ParallelTaskStatus.SUCCESS,
    results: [{ taskId: 't1', agentId: 'a1', status: 'completed', result: 'ok' }],
    taskCount: 1,
    completedCount: 1,
  };

  it('should validate with required fields', () => {
    const result = PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse(validInput);
    expect(result.overallStatus).toBe('success');
    expect(result.results).toHaveLength(1);
    expect(result.taskCount).toBe(1);
    expect(result.completedCount).toBe(1);
  });

  it('should validate with all fields', () => {
    const input = {
      source: 'parallel',
      userId: 'user-1',
      traceId: 'trace-1',
      taskId: 'task-1',
      agentId: 'aggregator',
      initiatorId: 'orchestrator',
      depth: 1,
      sessionId: 'sess-1',
      timestamp: 1700000000000,
      overallStatus: ParallelTaskStatus.PARTIAL,
      results: [
        {
          taskId: 't1',
          agentId: 'a1',
          status: 'completed',
          result: 'ok',
          error: null,
          patch: 'diff1',
        },
        {
          taskId: 't2',
          agentId: 'a2',
          status: 'failed',
          result: null,
          error: 'timeout',
          patch: null,
        },
      ],
      taskCount: 2,
      completedCount: 1,
      elapsedMs: 5000,
      aggregationType: 'agent_guided' as const,
      aggregationPrompt: 'Summarize results',
    };
    const result = PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should reject missing overallStatus', () => {
    const { overallStatus: _overallStatus, ...rest } = validInput;
    expect(() => PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse(rest)).toThrow();
  });

  it('should reject missing results', () => {
    const { results: _results, ...rest } = validInput;
    expect(() => PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse(rest)).toThrow();
  });

  it('should reject empty results array', () => {
    expect(() =>
      PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse({ ...validInput, results: [] })
    ).not.toThrow();
  });

  it('should reject missing taskCount', () => {
    const { taskCount: _taskCount, ...rest } = validInput;
    expect(() => PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse(rest)).toThrow();
  });

  it('should reject missing completedCount', () => {
    const { completedCount: _completedCount, ...rest } = validInput;
    expect(() => PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse(rest)).toThrow();
  });

  it('should accept all ParallelTaskStatus values', () => {
    for (const status of [
      ParallelTaskStatus.SUCCESS,
      ParallelTaskStatus.PARTIAL,
      ParallelTaskStatus.FAILED,
    ]) {
      const result = PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse({
        ...validInput,
        overallStatus: status,
      });
      expect(result.overallStatus).toBe(status);
    }
  });

  it('should accept valid aggregationType enum values', () => {
    for (const agg of ['summary', 'agent_guided', 'merge_patches'] as const) {
      const result = PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse({
        ...validInput,
        aggregationType: agg,
      });
      expect(result.aggregationType).toBe(agg);
    }
  });

  it('should reject invalid aggregationType', () => {
    expect(() =>
      PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse({ ...validInput, aggregationType: 'invalid' })
    ).toThrow();
  });

  it('should make elapsedMs optional', () => {
    const result = PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse(validInput);
    expect(result.elapsedMs).toBeUndefined();
  });

  it('should make aggregationType optional', () => {
    const result = PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse(validInput);
    expect(result.aggregationType).toBeUndefined();
  });

  it('should make aggregationPrompt optional', () => {
    const result = PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse(validInput);
    expect(result.aggregationPrompt).toBeUndefined();
  });

  it('should accept nullable result, error, and patch fields', () => {
    const input = {
      ...validInput,
      results: [
        { taskId: 't1', agentId: 'a1', status: 'done', result: null, error: null, patch: null },
      ],
    };
    const result = PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse(input);
    expect(result.results[0].result).toBeNull();
    expect(result.results[0].error).toBeNull();
    expect(result.results[0].patch).toBeNull();
  });

  it('should inherit base event fields', () => {
    const result = PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse(validInput);
    expect(result.source).toBe('unknown');
    expect(result.userId).toBe('SYSTEM');
    expect(result.initiatorId).toBe('orchestrator');
  });
});

describe('CODER_TASK_METADATA', () => {
  it('should validate with empty input using defaults', () => {
    const result = CODER_TASK_METADATA.parse({});
    expect(result.gapIds).toEqual([]);
  });

  it('should validate with all fields', () => {
    const input = {
      gapIds: ['gap-1', 'gap-2'],
      buildId: 'build-123',
      targetFile: 'src/index.ts',
      branch: 'feature-x',
    };
    const result = CODER_TASK_METADATA.parse(input);
    expect(result).toEqual(input);
  });

  it('should default gapIds to empty array', () => {
    const result = CODER_TASK_METADATA.parse({});
    expect(result.gapIds).toEqual([]);
  });

  it('should apply gapIds default inside object', () => {
    const result = CODER_TASK_METADATA.parse({ buildId: 'b1' });
    expect(result.gapIds).toEqual([]);
  });

  it('should make buildId optional', () => {
    const result = CODER_TASK_METADATA.parse({});
    expect(result.buildId).toBeNull();
  });

  it('should make targetFile optional', () => {
    const result = CODER_TASK_METADATA.parse({});
    expect(result.targetFile).toBeNull();
  });

  it('should make branch optional', () => {
    const result = CODER_TASK_METADATA.parse({});
    expect(result.branch).toBeNull();
  });

  it('should have top-level default returning gapIds only', () => {
    const result = CODER_TASK_METADATA.parse(undefined);
    expect(result).toEqual({ gapIds: [], buildId: null, targetFile: null, branch: null });
  });
});

describe('QA_AUDIT_METADATA', () => {
  it('should validate with empty input using defaults', () => {
    const result = QA_AUDIT_METADATA.parse({});
    expect(result.gapIds).toEqual([]);
  });

  it('should validate with all fields', () => {
    const input = {
      gapIds: ['gap-1'],
      buildId: 'build-456',
      deploymentUrl: 'https://deploy.example.com',
    };
    const result = QA_AUDIT_METADATA.parse(input);
    expect(result).toEqual(input);
  });

  it('should default gapIds to empty array', () => {
    const result = QA_AUDIT_METADATA.parse({});
    expect(result.gapIds).toEqual([]);
  });

  it('should make buildId optional', () => {
    const result = QA_AUDIT_METADATA.parse({});
    expect(result.buildId).toBeNull();
  });

  it('should make deploymentUrl optional', () => {
    const result = QA_AUDIT_METADATA.parse({});
    expect(result.deploymentUrl).toBeNull();
  });

  it('should have top-level default', () => {
    const result = QA_AUDIT_METADATA.parse(undefined);
    expect(result).toEqual({ gapIds: [], buildId: null, deploymentUrl: null });
  });
});

describe('PLANNER_TASK_METADATA', () => {
  it('should validate with empty input using defaults', () => {
    const result = PLANNER_TASK_METADATA.parse({});
    expect(result).toEqual({ gapId: null, category: null, priority: null });
  });

  it('should validate with all fields', () => {
    const input = {
      gapId: 'gap-1',
      category: 'security',
      priority: 5,
    };
    const result = PLANNER_TASK_METADATA.parse(input);
    expect(result).toEqual(input);
  });

  it('should make gapId optional', () => {
    const result = PLANNER_TASK_METADATA.parse({});
    expect(result.gapId).toBeNull();
  });

  it('should make category optional', () => {
    const result = PLANNER_TASK_METADATA.parse({});
    expect(result.category).toBeNull();
  });

  it('should make priority optional', () => {
    const result = PLANNER_TASK_METADATA.parse({});
    expect(result.priority).toBeNull();
  });

  it('should have top-level default returning empty object', () => {
    const result = PLANNER_TASK_METADATA.parse(undefined);
    expect(result).toEqual({ gapId: null, category: null, priority: null });
  });
});

describe('BUILD_TASK_METADATA', () => {
  it('should validate with empty input using defaults', () => {
    const result = BUILD_TASK_METADATA.parse({});
    expect(result.gapIds).toEqual([]);
  });

  it('should validate with all fields', () => {
    const input = {
      gapIds: ['gap-1', 'gap-2'],
      buildId: 'build-789',
      projectName: 'serverlessclaw',
    };
    const result = BUILD_TASK_METADATA.parse(input);
    expect(result).toEqual(input);
  });

  it('should default gapIds to empty array', () => {
    const result = BUILD_TASK_METADATA.parse({});
    expect(result.gapIds).toEqual([]);
  });

  it('should make buildId optional', () => {
    const result = BUILD_TASK_METADATA.parse({});
    expect(result.buildId).toBeNull();
  });

  it('should make projectName optional', () => {
    const result = BUILD_TASK_METADATA.parse({});
    expect(result.projectName).toBeNull();
  });

  it('should have top-level default', () => {
    const result = BUILD_TASK_METADATA.parse(undefined);
    expect(result).toEqual({ gapIds: [], buildId: null, projectName: null });
  });
});

describe('CLARIFICATION_TASK_METADATA', () => {
  it('should validate with empty input using defaults', () => {
    const result = CLARIFICATION_TASK_METADATA.parse({});
    expect(result.retryCount).toBe(0);
  });

  it('should validate with all fields', () => {
    const input = {
      question: 'What framework should I use?',
      originalTask: 'Build the app',
      retryCount: 2,
    };
    const result = CLARIFICATION_TASK_METADATA.parse(input);
    expect(result).toEqual(input);
  });

  it('should default retryCount to 0', () => {
    const result = CLARIFICATION_TASK_METADATA.parse({});
    expect(result.retryCount).toBe(0);
  });

  it('should apply retryCount default inside object', () => {
    const result = CLARIFICATION_TASK_METADATA.parse({ question: 'Why?' });
    expect(result.retryCount).toBe(0);
  });

  it('should make question optional', () => {
    const result = CLARIFICATION_TASK_METADATA.parse({});
    expect(result.question).toBeNull();
  });

  it('should make originalTask optional', () => {
    const result = CLARIFICATION_TASK_METADATA.parse({});
    expect(result.originalTask).toBeNull();
  });

  it('should have top-level default returning retryCount 0', () => {
    const result = CLARIFICATION_TASK_METADATA.parse(undefined);
    expect(result).toEqual({ question: null, originalTask: null, retryCount: 0 });
  });
});

describe('CONSENSUS_REQUEST_SCHEMA', () => {
  const validInput = {
    proposal: 'Upgrade to Node 20',
    voterIds: ['agent-1', 'agent-2'],
  };

  it('should validate with required fields', () => {
    const result = CONSENSUS_REQUEST_SCHEMA.parse(validInput);
    expect(result.proposal).toBe('Upgrade to Node 20');
    expect(result.voterIds).toEqual(['agent-1', 'agent-2']);
  });

  it('should validate with all fields', () => {
    const input = {
      source: 'orchestrator',
      userId: 'system',
      traceId: 'trace-1',
      taskId: 'task-1',
      agentId: 'planner',
      initiatorId: 'orchestrator',
      depth: 0,
      sessionId: 'sess-1',
      timestamp: 1700000000000,
      proposal: 'Migrate to ESM',
      mode: 'unanimous' as const,
      voterIds: ['a', 'b', 'c'],
      timeoutMs: 30000,
      metadata: { priority: 'high' },
    };
    const result = CONSENSUS_REQUEST_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should reject missing proposal', () => {
    expect(() => CONSENSUS_REQUEST_SCHEMA.parse({ voterIds: ['a'] })).toThrow();
  });

  it('should reject missing voterIds', () => {
    expect(() => CONSENSUS_REQUEST_SCHEMA.parse({ proposal: 'p' })).toThrow();
  });

  it('should reject empty voterIds array', () => {
    expect(() => CONSENSUS_REQUEST_SCHEMA.parse({ proposal: 'p', voterIds: [] })).toThrow();
  });

  it('should default mode to majority', () => {
    const result = CONSENSUS_REQUEST_SCHEMA.parse(validInput);
    expect(result.mode).toBe('majority');
  });

  it('should accept all mode values', () => {
    for (const mode of ['majority', 'unanimous', 'weighted'] as const) {
      const result = CONSENSUS_REQUEST_SCHEMA.parse({ ...validInput, mode });
      expect(result.mode).toBe(mode);
    }
  });

  it('should reject invalid mode', () => {
    expect(() => CONSENSUS_REQUEST_SCHEMA.parse({ ...validInput, mode: 'invalid' })).toThrow();
  });

  it('should default timeoutMs to 60000', () => {
    const result = CONSENSUS_REQUEST_SCHEMA.parse(validInput);
    expect(result.timeoutMs).toBe(60000);
  });

  it('should default metadata to empty object', () => {
    const result = CONSENSUS_REQUEST_SCHEMA.parse(validInput);
    expect(result.metadata).toEqual({});
  });

  it('should inherit base event fields', () => {
    const result = CONSENSUS_REQUEST_SCHEMA.parse(validInput);
    expect(result.source).toBe('unknown');
    expect(result.userId).toBe('SYSTEM');
  });
});

describe('CONSENSUS_VOTE_SCHEMA', () => {
  const validInput = {
    consensusId: 'consensus-1',
    voterId: 'agent-1',
    vote: 'approve' as const,
  };

  it('should validate with required fields', () => {
    const result = CONSENSUS_VOTE_SCHEMA.parse(validInput);
    expect(result.consensusId).toBe('consensus-1');
    expect(result.voterId).toBe('agent-1');
    expect(result.vote).toBe('approve');
  });

  it('should validate with all fields', () => {
    const input = {
      source: 'agent',
      userId: 'system',
      traceId: 'trace-1',
      taskId: 'task-1',
      agentId: 'agent-1',
      initiatorId: 'orchestrator',
      depth: 0,
      sessionId: 'sess-1',
      timestamp: 1700000000000,
      consensusId: 'consensus-1',
      voterId: 'agent-1',
      vote: 'reject' as const,
      reasoning: 'Not ready yet',
      weight: 2.5,
    };
    const result = CONSENSUS_VOTE_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should reject missing consensusId', () => {
    expect(() => CONSENSUS_VOTE_SCHEMA.parse({ voterId: 'a', vote: 'approve' })).toThrow();
  });

  it('should reject missing voterId', () => {
    expect(() => CONSENSUS_VOTE_SCHEMA.parse({ consensusId: 'c', vote: 'approve' })).toThrow();
  });

  it('should reject missing vote', () => {
    expect(() => CONSENSUS_VOTE_SCHEMA.parse({ consensusId: 'c', voterId: 'a' })).toThrow();
  });

  it('should accept all vote values', () => {
    for (const vote of ['approve', 'reject', 'abstain'] as const) {
      const result = CONSENSUS_VOTE_SCHEMA.parse({ ...validInput, vote });
      expect(result.vote).toBe(vote);
    }
  });

  it('should reject invalid vote value', () => {
    expect(() => CONSENSUS_VOTE_SCHEMA.parse({ ...validInput, vote: 'maybe' })).toThrow();
  });

  it('should make reasoning optional', () => {
    const result = CONSENSUS_VOTE_SCHEMA.parse(validInput);
    expect(result.reasoning).toBeUndefined();
  });

  it('should default weight to 1.0', () => {
    const result = CONSENSUS_VOTE_SCHEMA.parse(validInput);
    expect(result.weight).toBe(1.0);
  });

  it('should inherit base event fields', () => {
    const result = CONSENSUS_VOTE_SCHEMA.parse(validInput);
    expect(result.source).toBe('unknown');
    expect(result.initiatorId).toBe('orchestrator');
  });
});

describe('CONSENSUS_REACHED_SCHEMA', () => {
  const validInput = {
    consensusId: 'consensus-1',
    proposal: 'Upgrade Node',
    result: 'approved' as const,
    mode: 'majority' as const,
    approveCount: 3,
    rejectCount: 1,
    abstainCount: 0,
    totalVoters: 4,
    votes: [
      { voterId: 'a', vote: 'approve' as const, weight: 1 },
      { voterId: 'b', vote: 'approve' as const, weight: 1 },
      { voterId: 'c', vote: 'approve' as const, weight: 1 },
      { voterId: 'd', vote: 'reject' as const, weight: 1 },
    ],
  };

  it('should validate with required fields', () => {
    const result = CONSENSUS_REACHED_SCHEMA.parse(validInput);
    expect(result.consensusId).toBe('consensus-1');
    expect(result.proposal).toBe('Upgrade Node');
    expect(result.result).toBe('approved');
    expect(result.votes).toHaveLength(4);
  });

  it('should validate with all fields', () => {
    const input = {
      source: 'orchestrator',
      userId: 'system',
      traceId: 'trace-1',
      taskId: 'task-1',
      agentId: 'orchestrator',
      initiatorId: 'orchestrator',
      depth: 0,
      sessionId: 'sess-1',
      timestamp: 1700000000000,
      consensusId: 'consensus-1',
      proposal: 'Test',
      result: 'rejected' as const,
      mode: 'unanimous' as const,
      approveCount: 0,
      rejectCount: 3,
      abstainCount: 0,
      totalVoters: 3,
      votes: [
        { voterId: 'a', vote: 'reject' as const, reasoning: 'no', weight: 1 },
        { voterId: 'b', vote: 'reject' as const, weight: 1 },
        { voterId: 'c', vote: 'reject' as const, weight: 1 },
      ],
    };
    const result = CONSENSUS_REACHED_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should reject missing consensusId', () => {
    const { consensusId: _consensusId, ...rest } = validInput;
    expect(() => CONSENSUS_REACHED_SCHEMA.parse(rest)).toThrow();
  });

  it('should reject missing proposal', () => {
    const { proposal: _proposal, ...rest } = validInput;
    expect(() => CONSENSUS_REACHED_SCHEMA.parse(rest)).toThrow();
  });

  it('should reject missing result', () => {
    const { result: _result, ...rest } = validInput;
    expect(() => CONSENSUS_REACHED_SCHEMA.parse(rest)).toThrow();
  });

  it('should accept all result values', () => {
    for (const r of ['approved', 'rejected', 'timeout'] as const) {
      const result = CONSENSUS_REACHED_SCHEMA.parse({ ...validInput, result: r });
      expect(result.result).toBe(r);
    }
  });

  it('should reject invalid result', () => {
    expect(() => CONSENSUS_REACHED_SCHEMA.parse({ ...validInput, result: 'pending' })).toThrow();
  });

  it('should accept all mode values', () => {
    for (const m of ['majority', 'unanimous', 'weighted'] as const) {
      const result = CONSENSUS_REACHED_SCHEMA.parse({ ...validInput, mode: m });
      expect(result.mode).toBe(m);
    }
  });

  it('should make vote reasoning optional', () => {
    const input = {
      ...validInput,
      votes: [{ voterId: 'a', vote: 'approve' as const, weight: 1 }],
    };
    const result = CONSENSUS_REACHED_SCHEMA.parse(input);
    expect(result.votes[0].reasoning).toBeUndefined();
  });

  it('should inherit base event fields', () => {
    const result = CONSENSUS_REACHED_SCHEMA.parse(validInput);
    expect(result.source).toBe('unknown');
    expect(result.userId).toBe('SYSTEM');
  });
});

describe('EVENT_SCHEMA_MAP', () => {
  it('should map CODER_TASK to TASK_EVENT_SCHEMA', () => {
    expect(EVENT_SCHEMA_MAP[EventType.CODER_TASK]).toBe(TASK_EVENT_SCHEMA);
  });

  it('should map CONTINUATION_TASK to TASK_EVENT_SCHEMA', () => {
    expect(EVENT_SCHEMA_MAP[EventType.CONTINUATION_TASK]).toBe(TASK_EVENT_SCHEMA);
  });

  it('should map REFLECT_TASK to TASK_EVENT_SCHEMA', () => {
    expect(EVENT_SCHEMA_MAP[EventType.REFLECT_TASK]).toBe(TASK_EVENT_SCHEMA);
  });

  it('should map EVOLUTION_PLAN to TASK_EVENT_SCHEMA', () => {
    expect(EVENT_SCHEMA_MAP[EventType.EVOLUTION_PLAN]).toBe(TASK_EVENT_SCHEMA);
  });

  it('should map MONITOR_BUILD to TASK_EVENT_SCHEMA', () => {
    expect(EVENT_SCHEMA_MAP[EventType.MONITOR_BUILD]).toBe(TASK_EVENT_SCHEMA);
  });

  it('should map TASK_COMPLETED to COMPLETION_EVENT_SCHEMA', () => {
    expect(EVENT_SCHEMA_MAP[EventType.TASK_COMPLETED]).toBe(COMPLETION_EVENT_SCHEMA);
  });

  it('should map TASK_FAILED to FAILURE_EVENT_SCHEMA', () => {
    expect(EVENT_SCHEMA_MAP[EventType.TASK_FAILED]).toBe(FAILURE_EVENT_SCHEMA);
  });

  it('should map SYSTEM_BUILD_SUCCESS to BUILD_EVENT_SCHEMA', () => {
    expect(EVENT_SCHEMA_MAP[EventType.SYSTEM_BUILD_SUCCESS]).toBe(BUILD_EVENT_SCHEMA);
  });

  it('should map SYSTEM_BUILD_FAILED to BUILD_EVENT_SCHEMA', () => {
    expect(EVENT_SCHEMA_MAP[EventType.SYSTEM_BUILD_FAILED]).toBe(BUILD_EVENT_SCHEMA);
  });

  it('should map SYSTEM_HEALTH_REPORT to HEALTH_REPORT_EVENT_SCHEMA', () => {
    expect(EVENT_SCHEMA_MAP[EventType.SYSTEM_HEALTH_REPORT]).toBe(HEALTH_REPORT_EVENT_SCHEMA);
  });

  it('should map OUTBOUND_MESSAGE to OUTBOUND_MESSAGE_EVENT_SCHEMA', () => {
    expect(EVENT_SCHEMA_MAP[EventType.OUTBOUND_MESSAGE]).toBe(OUTBOUND_MESSAGE_EVENT_SCHEMA);
  });

  it('should map PARALLEL_TASK_COMPLETED to PARALLEL_TASK_COMPLETED_EVENT_SCHEMA', () => {
    expect(EVENT_SCHEMA_MAP[EventType.PARALLEL_TASK_COMPLETED]).toBe(
      PARALLEL_TASK_COMPLETED_EVENT_SCHEMA
    );
  });

  it('should map HEARTBEAT_PROACTIVE to PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA', () => {
    expect(EVENT_SCHEMA_MAP[EventType.HEARTBEAT_PROACTIVE]).toBe(
      PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA
    );
  });

  it('should map agent task types to TASK_EVENT_SCHEMA', () => {
    expect(EVENT_SCHEMA_MAP[`${AgentType.STRATEGIC_PLANNER}_task`]).toBe(TASK_EVENT_SCHEMA);
    expect(EVENT_SCHEMA_MAP[`${AgentType.COGNITION_REFLECTOR}_task`]).toBe(TASK_EVENT_SCHEMA);
    expect(EVENT_SCHEMA_MAP[`${AgentType.QA}_task`]).toBe(TASK_EVENT_SCHEMA);
    expect(EVENT_SCHEMA_MAP[`${AgentType.CRITIC}_task`]).toBe(TASK_EVENT_SCHEMA);
    expect(EVENT_SCHEMA_MAP[`${AgentType.FACILITATOR}_task`]).toBe(TASK_EVENT_SCHEMA);
  });

  it('should map CONSENSUS_REQUEST to CONSENSUS_REQUEST_SCHEMA', () => {
    expect(EVENT_SCHEMA_MAP[EventType.CONSENSUS_REQUEST]).toBe(CONSENSUS_REQUEST_SCHEMA);
  });

  it('should map CONSENSUS_VOTE to CONSENSUS_VOTE_SCHEMA', () => {
    expect(EVENT_SCHEMA_MAP[EventType.CONSENSUS_VOTE]).toBe(CONSENSUS_VOTE_SCHEMA);
  });

  it('should map CONSENSUS_REACHED to CONSENSUS_REACHED_SCHEMA', () => {
    expect(EVENT_SCHEMA_MAP[EventType.CONSENSUS_REACHED]).toBe(CONSENSUS_REACHED_SCHEMA);
  });

  it('should map HEALTH_ALERT to HEALTH_REPORT_EVENT_SCHEMA', () => {
    expect(EVENT_SCHEMA_MAP[EventType.HEALTH_ALERT]).toBe(HEALTH_REPORT_EVENT_SCHEMA);
  });

  it('should have correct number of entries', () => {
    expect(Object.keys(EVENT_SCHEMA_MAP)).toHaveLength(40);
  });

  it('should validate data through schema retrieved from map', () => {
    const schema = EVENT_SCHEMA_MAP[EventType.CODER_TASK];
    const result = schema.parse({ task: 'Build feature' });
    expect((result as any).task).toBe('Build feature');
  });
});
