import { describe, it, expect } from 'vitest';
import { DEFAULT_EVENT_ROUTING } from './event-routing';
import { EventType } from './types/agent';

describe('event-routing', () => {
  describe('DEFAULT_EVENT_ROUTING', () => {
    it('should export a routing table object', () => {
      expect(DEFAULT_EVENT_ROUTING).toBeDefined();
      expect(typeof DEFAULT_EVENT_ROUTING).toBe('object');
    });

    it('should map SYSTEM_BUILD_FAILED to build-handler', () => {
      const entry = DEFAULT_EVENT_ROUTING[EventType.SYSTEM_BUILD_FAILED];
      expect(entry).toBeDefined();
      expect(entry.module).toBe('./events/build-handler');
      expect(entry.function).toBe('handleBuildFailure');
      expect(entry.passContext).toBe(true);
    });

    it('should map SYSTEM_BUILD_SUCCESS to build-handler', () => {
      const entry = DEFAULT_EVENT_ROUTING[EventType.SYSTEM_BUILD_SUCCESS];
      expect(entry).toBeDefined();
      expect(entry.module).toBe('./events/build-handler');
      expect(entry.function).toBe('handleBuildSuccess');
      expect(entry.passContext).toBeUndefined();
    });

    it('should map CONTINUATION_TASK to continuation-handler', () => {
      const entry = DEFAULT_EVENT_ROUTING[EventType.CONTINUATION_TASK];
      expect(entry).toBeDefined();
      expect(entry.module).toBe('./events/continuation-handler');
      expect(entry.function).toBe('handleContinuationTask');
      expect(entry.passContext).toBe(true);
    });

    it('should map SYSTEM_HEALTH_REPORT to health-handler', () => {
      const entry = DEFAULT_EVENT_ROUTING[EventType.SYSTEM_HEALTH_REPORT];
      expect(entry).toBeDefined();
      expect(entry.module).toBe('./events/health-handler');
      expect(entry.function).toBe('handleHealthReport');
      expect(entry.passContext).toBe(true);
    });

    it('should map TASK_COMPLETED to task-result-handler', () => {
      const entry = DEFAULT_EVENT_ROUTING[EventType.TASK_COMPLETED];
      expect(entry).toBeDefined();
      expect(entry.module).toBe('./events/task-result-handler');
      expect(entry.function).toBe('handleTaskResult');
    });

    it('should map TASK_FAILED to task-result-handler', () => {
      const entry = DEFAULT_EVENT_ROUTING[EventType.TASK_FAILED];
      expect(entry).toBeDefined();
      expect(entry.module).toBe('./events/task-result-handler');
      expect(entry.function).toBe('handleTaskResult');
    });

    it('should map CLARIFICATION_REQUEST to clarification-handler', () => {
      const entry = DEFAULT_EVENT_ROUTING[EventType.CLARIFICATION_REQUEST];
      expect(entry).toBeDefined();
      expect(entry.module).toBe('./events/clarification-handler');
      expect(entry.function).toBe('handleClarificationRequest');
    });

    it('should map CLARIFICATION_TIMEOUT to clarification-timeout-handler', () => {
      const entry = DEFAULT_EVENT_ROUTING[EventType.CLARIFICATION_TIMEOUT];
      expect(entry).toBeDefined();
      expect(entry.module).toBe('./events/clarification-timeout-handler');
      expect(entry.function).toBe('handleClarificationTimeout');
    });

    it('should map PARALLEL_TASK_DISPATCH to parallel-handler', () => {
      const entry = DEFAULT_EVENT_ROUTING[EventType.PARALLEL_TASK_DISPATCH];
      expect(entry).toBeDefined();
      expect(entry.module).toBe('./events/parallel-handler');
      expect(entry.function).toBe('handleParallelDispatch');
    });

    it('should map PARALLEL_BARRIER_TIMEOUT to parallel-barrier-timeout-handler', () => {
      const entry = DEFAULT_EVENT_ROUTING[EventType.PARALLEL_BARRIER_TIMEOUT];
      expect(entry).toBeDefined();
      expect(entry.module).toBe('./events/parallel-barrier-timeout-handler');
      expect(entry.function).toBe('handleParallelBarrierTimeout');
    });

    it('should map PARALLEL_TASK_COMPLETED to parallel-task-completed-handler', () => {
      const entry = DEFAULT_EVENT_ROUTING[EventType.PARALLEL_TASK_COMPLETED];
      expect(entry).toBeDefined();
      expect(entry.module).toBe('./events/parallel-task-completed-handler');
      expect(entry.function).toBe('handleParallelTaskCompleted');
    });

    it('should map TASK_CANCELLED to cancellation-handler', () => {
      const entry = DEFAULT_EVENT_ROUTING[EventType.TASK_CANCELLED];
      expect(entry).toBeDefined();
      expect(entry.module).toBe('./events/cancellation-handler');
      expect(entry.function).toBe('handleTaskCancellation');
    });

    it('should map HEARTBEAT_PROACTIVE to proactive-handler', () => {
      const entry = DEFAULT_EVENT_ROUTING[EventType.HEARTBEAT_PROACTIVE];
      expect(entry).toBeDefined();
      expect(entry.module).toBe('./events/proactive-handler');
      expect(entry.function).toBe('handleProactiveHeartbeat');
      expect(entry.passContext).toBe(true);
    });

    it('should map ESCALATION_LEVEL_TIMEOUT to escalation-handler', () => {
      const entry = DEFAULT_EVENT_ROUTING[EventType.ESCALATION_LEVEL_TIMEOUT];
      expect(entry).toBeDefined();
      expect(entry.module).toBe('./events/escalation-handler');
      expect(entry.function).toBe('handleEscalationLevelTimeout');
    });

    it('should map CONSENSUS_REQUEST to consensus-handler', () => {
      const entry = DEFAULT_EVENT_ROUTING[EventType.CONSENSUS_REQUEST];
      expect(entry).toBeDefined();
      expect(entry.module).toBe('./events/consensus-handler');
      expect(entry.function).toBe('handleConsensus');
    });

    it('should map CONSENSUS_VOTE to consensus-handler', () => {
      const entry = DEFAULT_EVENT_ROUTING[EventType.CONSENSUS_VOTE];
      expect(entry).toBeDefined();
      expect(entry.module).toBe('./events/consensus-handler');
      expect(entry.function).toBe('handleConsensus');
    });

    it('should map COGNITIVE_HEALTH_CHECK to cognitive-health-handler', () => {
      const entry = DEFAULT_EVENT_ROUTING[EventType.COGNITIVE_HEALTH_CHECK];
      expect(entry).toBeDefined();
      expect(entry.module).toBe('./events/cognitive-health-handler');
      expect(entry.function).toBe('handleCognitiveHealthCheck');
    });

    it('should have module and function for every entry', () => {
      for (const entry of Object.values(DEFAULT_EVENT_ROUTING)) {
        expect(entry.module).toBeDefined();
        expect(typeof entry.module).toBe('string');
        expect(entry.function).toBeDefined();
        expect(typeof entry.function).toBe('string');
      }
    });

    it('should not have entries for non-routable event types', () => {
      expect(DEFAULT_EVENT_ROUTING[EventType.CHUNK]).toBeUndefined();
      expect(DEFAULT_EVENT_ROUTING[EventType.REFLECT_TASK]).toBeUndefined();
      expect(DEFAULT_EVENT_ROUTING[EventType.OUTBOUND_MESSAGE]).toBeUndefined();
      expect(DEFAULT_EVENT_ROUTING[EventType.CODER_TASK]).toBeUndefined();
    });
  });
});
