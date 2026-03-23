import { describe, it, expect } from 'vitest';
// import { EventType } from '../lib/types/agent';
import {
  TASK_EVENT_SCHEMA,
  COMPLETION_EVENT_SCHEMA,
  FAILURE_EVENT_SCHEMA,
  BUILD_EVENT_SCHEMA,
  HEALTH_REPORT_EVENT_SCHEMA,
  OUTBOUND_MESSAGE_EVENT_SCHEMA,
} from '../lib/schema/events';

describe('Event Contract Verification', () => {
  const common = {
    userId: 'user-123',
    traceId: 'trace-456',
    sessionId: 'session-789',
    depth: 1,
  };

  describe('TASK_EVENT_SCHEMA (CODER_TASK, CONTINUATION_TASK, etc.)', () => {
    it('should validate a correct task event', () => {
      const payload = {
        ...common,
        agentId: 'coder',
        task: 'Implement new feature',
      };
      expect(() => TASK_EVENT_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should fail if task is missing', () => {
      const payload = { ...common, agentId: 'coder' };
      expect(() => TASK_EVENT_SCHEMA.parse(payload)).toThrow();
    });
  });

  describe('COMPLETION_EVENT_SCHEMA (TASK_COMPLETED)', () => {
    it('should validate a correct completion event', () => {
      const payload = {
        ...common,
        agentId: 'coder',
        task: 'Fix bug',
        response: 'Bug fixed successfully',
      };
      expect(() => COMPLETION_EVENT_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should fail if response is missing', () => {
      const payload = { ...common, agentId: 'coder', task: 'Fix bug' };
      expect(() => COMPLETION_EVENT_SCHEMA.parse(payload)).toThrow();
    });
  });

  describe('FAILURE_EVENT_SCHEMA (TASK_FAILED)', () => {
    it('should validate a correct failure event', () => {
      const payload = {
        ...common,
        agentId: 'coder',
        task: 'Refactor code',
        error: 'Timeout while processing requested changes',
      };
      expect(() => FAILURE_EVENT_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should fail if error is missing', () => {
      const payload = { ...common, agentId: 'coder', task: 'Refactor' };
      expect(() => FAILURE_EVENT_SCHEMA.parse(payload)).toThrow();
    });
  });

  describe('BUILD_EVENT_SCHEMA (SYSTEM_BUILD_FAILED, SYSTEM_BUILD_SUCCESS)', () => {
    it('should validate a correct build event', () => {
      const payload = {
        ...common,
        buildId: 'build-001',
        projectName: 'serverlessclaw',
        task: 'Deploy fix',
      };
      expect(() => BUILD_EVENT_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should fail if buildId is missing', () => {
      const payload = { ...common, projectName: 'test' };
      expect(() => BUILD_EVENT_SCHEMA.parse(payload)).toThrow();
    });
  });

  describe('HEALTH_REPORT_EVENT_SCHEMA (SYSTEM_HEALTH_REPORT)', () => {
    it('should validate a correct health report', () => {
      const payload = {
        ...common,
        component: 'Database',
        issue: 'Connection timeout',
        severity: 'critical',
      };
      expect(() => HEALTH_REPORT_EVENT_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should fail if severity is invalid', () => {
      const payload = {
        ...common,
        component: 'DB',
        issue: 'Error',
        severity: 'ULTRA_CRITICAL', // Invalid enum value
      };
      expect(() => HEALTH_REPORT_EVENT_SCHEMA.parse(payload)).toThrow();
    });
  });

  describe('OUTBOUND_MESSAGE_EVENT_SCHEMA (OUTBOUND_MESSAGE)', () => {
    it('should validate a correct outbound message', () => {
      const payload = {
        ...common,
        message: 'Hello from SuperClaw!',
        agentName: 'SuperClaw',
      };
      expect(() => OUTBOUND_MESSAGE_EVENT_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should fail if message is missing', () => {
      const payload = { ...common, agentName: 'Agent' };
      expect(() => OUTBOUND_MESSAGE_EVENT_SCHEMA.parse(payload)).toThrow();
    });
  });
});
