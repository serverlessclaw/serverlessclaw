/**
 * Schema-Type Drift Detection Tests
 *
 * Ensures that the Zod-inferred types (from core/lib/schema/events.ts)
 * remain compatible with the hand-written interfaces (from core/lib/types/agent.ts).
 *
 * If these tests fail, it means someone changed a Zod schema without updating
 * the corresponding hand-written type, or vice versa. Fix by aligning them.
 *
 * @module schema-type-drift
 */
import { describe, it, expect } from 'vitest';
import type {
  AgentPayloadInferred,
  TaskEventPayload,
  BuildEventPayload,
  CompletionEventPayload,
  FailureEventPayload,
  HealthReportEventPayload,
} from '../lib/schema/events';
import {
  BASE_EVENT_SCHEMA,
  AGENT_PAYLOAD_SCHEMA,
  COMPLETION_EVENT_SCHEMA,
  FAILURE_EVENT_SCHEMA,
  OUTBOUND_MESSAGE_EVENT_SCHEMA,
  EVENT_SCHEMA_MAP,
} from '../lib/schema/events';
import type {
  AgentPayload as WrittenAgentPayload,
  TaskEvent as WrittenTaskEvent,
  BuildEvent as WrittenBuildEvent,
  CompletionEvent as WrittenCompletionEvent,
  FailureEvent as WrittenFailureEvent,
  HealthReportEvent as WrittenHealthReportEvent,
} from '../lib/types/agent';

describe('Schema-Type Drift Detection', () => {
  describe('Inferred → Written compatibility (schema output must satisfy hand-written interface)', () => {
    it('AgentPayload: inferred type should satisfy written interface', () => {
      // The inferred type has defaults applied, so it's a superset of the written type.
      // We verify that key fields exist and have the right shape.
      const inferred: AgentPayloadInferred = {
        source: 'unknown',
        userId: 'user-1',
        initiatorId: 'orchestrator',
        depth: 0,
        timestamp: Date.now(),
        task: '',
        response: undefined,
        metadata: {},
        attachments: [],
        isContinuation: false,
      };

      // This assignment tests structural compatibility
      const written: WrittenAgentPayload = {
        userId: inferred.userId,
        traceId: inferred.traceId ?? '',
        taskId: 'test-task',
        initiatorId: inferred.initiatorId,
        depth: inferred.depth,
        task: inferred.task,
        response: inferred.response,
        metadata: inferred.metadata,
        attachments: inferred.attachments,
        isContinuation: inferred.isContinuation,
      };

      expect(written.userId).toBe('user-1');
      expect(written.task).toBe('');
      expect(written.metadata).toEqual({});
      expect(written.attachments).toEqual([]);
    });

    it('TaskEvent: inferred type should satisfy written interface', () => {
      const inferred: TaskEventPayload = {
        source: 'unknown',
        userId: 'user-1',
        initiatorId: 'orchestrator',
        depth: 0,
        timestamp: Date.now(),
        task: 'Do something',
      };

      const written: WrittenTaskEvent = {
        userId: inferred.userId,
        traceId: inferred.traceId ?? '',
        taskId: 'test-task',
        initiatorId: inferred.initiatorId,
        depth: inferred.depth,
        task: inferred.task,
      };

      expect(written.task).toBe('Do something');
    });

    it('BuildEvent: inferred type should satisfy written interface', () => {
      const inferred: BuildEventPayload = {
        source: 'unknown',
        userId: 'user-1',
        initiatorId: 'orchestrator',
        depth: 0,
        timestamp: Date.now(),
        buildId: 'build-001',
      };

      const written: WrittenBuildEvent = {
        userId: inferred.userId,
        traceId: inferred.traceId ?? '',
        taskId: 'test-task',
        initiatorId: inferred.initiatorId,
        depth: inferred.depth,
        buildId: inferred.buildId,
        projectName: inferred.projectName ?? 'default',
      };

      expect(written.buildId).toBe('build-001');
    });

    it('CompletionEvent: inferred type should satisfy written interface', () => {
      const inferred: CompletionEventPayload = {
        source: 'unknown',
        userId: 'user-1',
        initiatorId: 'orchestrator',
        depth: 0,
        timestamp: Date.now(),
        agentId: 'coder',
        task: 'Fix bug',
        response: 'Done',
        attachments: [],
        userNotified: false,
      };

      const written: WrittenCompletionEvent = {
        userId: inferred.userId,
        traceId: inferred.traceId ?? '',
        taskId: 'test-task',
        initiatorId: inferred.initiatorId,
        depth: inferred.depth,
        agentId: inferred.agentId,
        task: inferred.task,
        response: inferred.response,
      };

      expect(written.response).toBe('Done');
      // userNotified is optional in the hand-written type but defaulted in the schema
      // Verify the schema provides the default
      expect(inferred.userNotified).toBe(false);
    });

    it('FailureEvent: inferred type should satisfy written interface', () => {
      const inferred: FailureEventPayload = {
        source: 'unknown',
        userId: 'user-1',
        initiatorId: 'orchestrator',
        depth: 0,
        timestamp: Date.now(),
        agentId: 'coder',
        task: 'Refactor',
        error: 'Timeout',
        userNotified: false,
      };

      const written: WrittenFailureEvent = {
        userId: inferred.userId,
        traceId: inferred.traceId ?? '',
        taskId: 'test-task',
        initiatorId: inferred.initiatorId,
        depth: inferred.depth,
        agentId: inferred.agentId,
        task: inferred.task,
        error: inferred.error,
      };

      expect(written.error).toBe('Timeout');
    });

    it('HealthReportEvent: inferred type should satisfy written interface', () => {
      const inferred: HealthReportEventPayload = {
        source: 'unknown',
        userId: 'user-1',
        initiatorId: 'orchestrator',
        depth: 0,
        timestamp: Date.now(),
        component: 'DynamoDB',
        issue: 'Connection timeout',
        severity: 'critical' as const,
      };

      const written: WrittenHealthReportEvent = {
        userId: inferred.userId,
        traceId: inferred.traceId ?? '',
        taskId: 'test-task',
        initiatorId: inferred.initiatorId,
        depth: inferred.depth,
        component: inferred.component,
        issue: inferred.issue,
        severity: inferred.severity,
      };

      expect(written.severity).toBe('critical');
    });
  });

  describe('Schema default guarantees (runtime behavior matches expectations)', () => {
    it('BASE_EVENT_SCHEMA should provide defaults for source, initiatorId, depth, timestamp', () => {
      const parsed = BASE_EVENT_SCHEMA.parse({ userId: 'test-user' });

      expect(parsed.source).toBe('unknown');
      expect(parsed.initiatorId).toBe('orchestrator');
      expect(parsed.depth).toBe(0);
      expect(parsed.timestamp).toBeTypeOf('number');
      expect(parsed.userId).toBe('test-user');
    });

    it('AGENT_PAYLOAD_SCHEMA should provide defaults for task, metadata, attachments, isContinuation', () => {
      const parsed = AGENT_PAYLOAD_SCHEMA.parse({ userId: 'test-user' });

      expect(parsed.task).toBe('');
      expect(parsed.metadata).toEqual({});
      expect(parsed.attachments).toEqual([]);
      expect(parsed.isContinuation).toBe(false);
    });

    it('COMPLETION_EVENT_SCHEMA should provide defaults for agentId, task, attachments, userNotified', () => {
      const parsed = COMPLETION_EVENT_SCHEMA.parse({
        userId: 'test-user',
        response: 'Done',
      });

      expect(parsed.agentId).toBe('unknown');
      expect(parsed.task).toBe('');
      expect(parsed.attachments).toEqual([]);
      expect(parsed.userNotified).toBe(false);
    });

    it('FAILURE_EVENT_SCHEMA should provide defaults for agentId, task, userNotified', () => {
      const parsed = FAILURE_EVENT_SCHEMA.parse({
        userId: 'test-user',
        error: 'Something failed',
      });

      expect(parsed.agentId).toBe('unknown');
      expect(parsed.task).toBe('');
      expect(parsed.userNotified).toBe(false);
    });

    it('OUTBOUND_MESSAGE_EVENT_SCHEMA should provide defaults for agentName, memoryContexts, attachments', () => {
      const parsed = OUTBOUND_MESSAGE_EVENT_SCHEMA.parse({
        userId: 'test-user',
        message: 'Hello',
      });

      expect(parsed.agentName).toBe('SuperClaw');
      expect(parsed.memoryContexts).toEqual([]);
      expect(parsed.attachments).toEqual([]);
    });
  });

  describe('EVENT_SCHEMA_MAP completeness', () => {
    it('should contain schemas for all major event types', () => {
      const keys = Object.keys(EVENT_SCHEMA_MAP);

      expect(keys).toContain('task_event');
      expect(keys).toContain('completion_event');
      expect(keys).toContain('failure_event');
      expect(keys).toContain('build_event');
      expect(keys).toContain('health_report_event');
      expect(keys).toContain('outbound_message');
      expect(keys).toContain('parallel_task_completed');
      expect(keys).toContain('heartbeat_proactive');
    });
  });
});
