import { describe, it, expect } from 'vitest';
import { EventType, AgentType } from '../lib/types/agent';
import {
  TASK_EVENT_SCHEMA,
  COMPLETION_EVENT_SCHEMA,
  FAILURE_EVENT_SCHEMA,
  BUILD_EVENT_SCHEMA,
  HEALTH_REPORT_EVENT_SCHEMA,
  OUTBOUND_MESSAGE_EVENT_SCHEMA,
  PARALLEL_TASK_COMPLETED_EVENT_SCHEMA,
  CONSENSUS_REQUEST_SCHEMA,
  CONSENSUS_VOTE_SCHEMA,
  CONSENSUS_REACHED_SCHEMA,
  PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA,
  EVENT_SCHEMA_MAP,
  CODER_TASK_METADATA,
  QA_AUDIT_METADATA,
  PLANNER_TASK_METADATA,
  BUILD_TASK_METADATA,
  CLARIFICATION_TASK_METADATA,
  REPUTATION_UPDATE_SCHEMA,
  PARALLEL_TASK_DISPATCH_SCHEMA,
  CODER_TASK_COMPLETED_SCHEMA,
  TASK_CANCELLED_SCHEMA,
  HANDOFF_SCHEMA,
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

  describe('PARALLEL_TASK_COMPLETED_EVENT_SCHEMA', () => {
    it('should validate a correct parallel completion event (summary)', () => {
      const payload = {
        ...common,
        overallStatus: 'success',
        results: [
          { taskId: 't1', agentId: 'a1', status: 'success', result: 'done' },
          { taskId: 't2', agentId: 'a2', status: 'failed', error: 'boom' },
        ],
        taskCount: 2,
        completedCount: 2,
        aggregationType: 'summary',
      };
      expect(() => PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should validate a correct parallel completion event (agent_guided)', () => {
      const payload = {
        ...common,
        overallStatus: 'partial',
        results: [{ taskId: 't1', agentId: 'a1', status: 'success', result: 'ok' }],
        taskCount: 1,
        completedCount: 1,
        aggregationType: 'agent_guided',
        aggregationPrompt: 'Please summarize this.',
      };
      expect(() => PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should validate a correct parallel completion event (merge_patches)', () => {
      const payload = {
        ...common,
        overallStatus: 'success',
        results: [
          {
            taskId: 't1',
            agentId: 'coder-a',
            status: 'success',
            result: 'Done',
            patch: 'diff --git a/file.ts b/file.ts\n+change',
          },
        ],
        taskCount: 1,
        completedCount: 1,
        aggregationType: 'merge_patches',
      };
      expect(() => PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should fail if overallStatus is invalid', () => {
      const payload = {
        ...common,
        overallStatus: 'UNKNOWN',
        results: [],
        taskCount: 0,
        completedCount: 0,
      };
      expect(() => PARALLEL_TASK_COMPLETED_EVENT_SCHEMA.parse(payload)).toThrow();
    });
  });

  // =========================================================================
  // Evolution Event Contracts
  // =========================================================================

  describe('EVOLUTION_PLAN (Reflector → Planner)', () => {
    it('should validate a correct evolution plan event', () => {
      const payload = {
        ...common,
        agentId: 'cognition-reflector',
        task: 'Strategic gap: Slack message search capability',
        metadata: {
          gapId: 'gap-001',
          details: 'The system cannot search Slack messages',
          category: 'STRATEGIC_GAP',
          impact: 8,
          urgency: 5,
        },
      };
      expect(() => TASK_EVENT_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should fail if task is missing (required field)', () => {
      const payload = {
        ...common,
        agentId: 'cognition-reflector',
        metadata: { gapId: 'gap-001' },
      };
      expect(() => TASK_EVENT_SCHEMA.parse(payload)).toThrow();
    });
  });

  describe('REFLECT_TASK (Trigger → Reflector)', () => {
    it('should validate a correct reflect task event', () => {
      const payload = {
        ...common,
        agentId: 'cognition-reflector',
        task: 'Analyze session for insights',
      };
      expect(() => TASK_EVENT_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should validate reflect task with conversation context in metadata', () => {
      const payload = {
        ...common,
        agentId: 'cognition-reflector',
        task: 'Session reflection',
        metadata: {
          conversation: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' },
          ],
        },
      };
      expect(() => TASK_EVENT_SCHEMA.parse(payload)).not.toThrow();
    });
  });

  describe('SYSTEM_BUILD_SUCCESS (BuildMonitor → System)', () => {
    it('should validate a correct build success event', () => {
      const payload = {
        ...common,
        buildId: 'build-12345',
        projectName: 'serverlessclaw',
        task: 'Deploy Slack integration',
        gapIds: ['gap-001'],
      };
      expect(() => BUILD_EVENT_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should fail if buildId is missing', () => {
      const payload = {
        ...common,
        projectName: 'serverlessclaw',
      };
      expect(() => BUILD_EVENT_SCHEMA.parse(payload)).toThrow();
    });
  });

  describe('SYSTEM_BUILD_FAILED (BuildMonitor → System)', () => {
    it('should validate a correct build failure event', () => {
      const payload = {
        ...common,
        buildId: 'build-12345',
        projectName: 'serverlessclaw',
        task: 'Deploy Slack integration',
        errorLogs: 'Error: TypeScript compilation failed\n  at index.ts:42',
        gapIds: ['gap-001', 'gap-002'],
      };
      expect(() => BUILD_EVENT_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should validate build failure without errorLogs (optional)', () => {
      const payload = {
        ...common,
        buildId: 'build-12345',
        projectName: 'serverlessclaw',
      };
      expect(() => BUILD_EVENT_SCHEMA.parse(payload)).not.toThrow();
    });
  });

  // =========================================================================
  // EVENT_SCHEMA_MAP Verification
  // =========================================================================

  describe('EVENT_SCHEMA_MAP — Evolution & Swarm Events', () => {
    it('should map EVOLUTION_PLAN to TASK_EVENT_SCHEMA', () => {
      expect(EVENT_SCHEMA_MAP[EventType.EVOLUTION_PLAN as string]).toBe(TASK_EVENT_SCHEMA);
    });

    it('should map HEARTBEAT_PROACTIVE to PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA', () => {
      expect(EVENT_SCHEMA_MAP[EventType.HEARTBEAT_PROACTIVE as string]).toBe(
        PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA
      );
    });

    it('should map CONSENSUS_REQUEST to CONSENSUS_REQUEST_SCHEMA', () => {
      expect(EVENT_SCHEMA_MAP[EventType.CONSENSUS_REQUEST as string]).toBe(
        CONSENSUS_REQUEST_SCHEMA
      );
    });

    it('should map CONSENSUS_VOTE to CONSENSUS_VOTE_SCHEMA', () => {
      expect(EVENT_SCHEMA_MAP[EventType.CONSENSUS_VOTE as string]).toBe(CONSENSUS_VOTE_SCHEMA);
    });

    it('should map CONSENSUS_REACHED to CONSENSUS_REACHED_SCHEMA', () => {
      expect(EVENT_SCHEMA_MAP[EventType.CONSENSUS_REACHED as string]).toBe(
        CONSENSUS_REACHED_SCHEMA
      );
    });
  });

  describe('PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA', () => {
    it('should validate a correct proactive heartbeat', () => {
      const payload = {
        ...common,
        agentId: 'monitor',
        task: 'Periodic check',
        goalId: 'goal-1',
      };
      expect(() => PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should fail if goalId is missing', () => {
      const payload = { ...common, agentId: 'monitor', task: 'check' };
      expect(() => PROACTIVE_HEARTBEAT_PAYLOAD_SCHEMA.parse(payload)).toThrow();
    });
  });

  describe('CONSENSUS Protocol Schemas', () => {
    describe('CONSENSUS_REQUEST_SCHEMA', () => {
      it('should validate a correct consensus request', () => {
        const payload = {
          ...common,
          proposal: 'Upgrade to SST v3',
          mode: 'majority',
          voterIds: ['coder', 'qa', 'architect'],
          timeoutMs: 30000,
        };
        expect(() => CONSENSUS_REQUEST_SCHEMA.parse(payload)).not.toThrow();
      });

      it('should fail if voterIds is empty', () => {
        const payload = { ...common, proposal: 'test', voterIds: [] };
        expect(() => CONSENSUS_REQUEST_SCHEMA.parse(payload)).toThrow();
      });
    });

    describe('CONSENSUS_VOTE_SCHEMA', () => {
      it('should validate a correct vote', () => {
        const payload = {
          ...common,
          consensusId: 'con-123',
          voterId: 'coder',
          vote: 'approve',
          reasoning: 'Looks good',
          weight: 1.5,
        };
        expect(() => CONSENSUS_VOTE_SCHEMA.parse(payload)).not.toThrow();
      });

      it('should fail if vote is invalid', () => {
        const payload = { ...common, consensusId: 'con-1', voterId: 'v1', vote: 'YES' };
        expect(() => CONSENSUS_VOTE_SCHEMA.parse(payload)).toThrow();
      });
    });

    describe('CONSENSUS_REACHED_SCHEMA', () => {
      it('should validate a correct consensus result', () => {
        const payload = {
          ...common,
          consensusId: 'con-123',
          proposal: 'Upgrade',
          result: 'approved',
          mode: 'majority',
          approveCount: 2,
          rejectCount: 1,
          abstainCount: 0,
          totalVoters: 3,
          votes: [{ voterId: 'coder', vote: 'approve', weight: 1.0 }],
        };
        expect(() => CONSENSUS_REACHED_SCHEMA.parse(payload)).not.toThrow();
      });
    });
  });

  // =========================================================================
  // Typed Metadata Schemas (Evolution)
  // =========================================================================

  describe('CODER_TASK_METADATA', () => {
    it('should validate coder metadata with gapIds', () => {
      const payload = { gapIds: ['gap-001', 'gap-002'], buildId: 'build-001' };
      const result = CODER_TASK_METADATA.parse(payload);
      expect(result.gapIds).toEqual(['gap-001', 'gap-002']);
      expect(result.buildId).toBe('build-001');
    });

    it('should default gapIds to empty array', () => {
      const result = CODER_TASK_METADATA.parse({});
      expect(result.gapIds).toEqual([]);
    });
  });

  describe('QA_AUDIT_METADATA', () => {
    it('should validate QA metadata with gapIds', () => {
      const payload = { gapIds: ['gap-001'], deploymentUrl: 'https://example.com' };
      const result = QA_AUDIT_METADATA.parse(payload);
      expect(result.gapIds).toEqual(['gap-001']);
      expect(result.deploymentUrl).toBe('https://example.com');
    });

    it('should default gapIds to empty array', () => {
      const result = QA_AUDIT_METADATA.parse({});
      expect(result.gapIds).toEqual([]);
    });
  });

  describe('PLANNER_TASK_METADATA', () => {
    it('should validate planner metadata with gapId', () => {
      const payload = { gapId: 'gap-001', category: 'STRATEGIC_GAP', priority: 8 };
      const result = PLANNER_TASK_METADATA.parse(payload);
      expect(result.gapId).toBe('gap-001');
      expect(result.priority).toBe(8);
    });

    it('should default to empty object', () => {
      const result = PLANNER_TASK_METADATA.parse({});
      expect(result).toEqual({});
    });
  });

  describe('BUILD_TASK_METADATA', () => {
    it('should validate build metadata with gapIds', () => {
      const payload = { gapIds: ['gap-001'], buildId: 'build-001', projectName: 'serverlessclaw' };
      const result = BUILD_TASK_METADATA.parse(payload);
      expect(result.gapIds).toEqual(['gap-001']);
      expect(result.projectName).toBe('serverlessclaw');
    });

    it('should default gapIds to empty array', () => {
      const result = BUILD_TASK_METADATA.parse({});
      expect(result.gapIds).toEqual([]);
    });
  });

  describe('CLARIFICATION_TASK_METADATA', () => {
    it('should validate clarification metadata', () => {
      const payload = { question: 'What is X?', originalTask: 'Do Y', retryCount: 1 };
      const result = CLARIFICATION_TASK_METADATA.parse(payload);
      expect(result.question).toBe('What is X?');
      expect(result.retryCount).toBe(1);
    });

    it('should default retryCount to 0', () => {
      const result = CLARIFICATION_TASK_METADATA.parse({});
      expect(result.retryCount).toBe(0);
    });
  });

  // =========================================================================
  // Missing Schema Contracts (Coverage Gap Fix)
  // =========================================================================

  describe('REPUTATION_UPDATE_SCHEMA', () => {
    it('should validate a correct reputation update event', () => {
      const payload = {
        ...common,
        agentId: 'coder',
        success: true,
        durationMs: 1500,
      };
      expect(() => REPUTATION_UPDATE_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should validate a failed reputation update with error', () => {
      const payload = {
        ...common,
        agentId: 'qa',
        success: false,
        durationMs: 5000,
        error: 'Timeout exceeded',
        taskComplexity: 7,
      };
      expect(() => REPUTATION_UPDATE_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should fail if agentId is missing', () => {
      const payload = { ...common, success: true, durationMs: 1000 };
      expect(() => REPUTATION_UPDATE_SCHEMA.parse(payload)).toThrow();
    });

    it('should fail if success is missing', () => {
      const payload = { ...common, agentId: 'coder', durationMs: 1000 };
      expect(() => REPUTATION_UPDATE_SCHEMA.parse(payload)).toThrow();
    });

    it('should map REPUTATION_UPDATE in EVENT_SCHEMA_MAP', () => {
      expect(EVENT_SCHEMA_MAP[EventType.REPUTATION_UPDATE as string]).toBe(
        REPUTATION_UPDATE_SCHEMA
      );
    });
  });

  describe('PARALLEL_TASK_DISPATCH_SCHEMA', () => {
    it('should validate a correct parallel dispatch event', () => {
      const payload = {
        ...common,
        tasks: [
          { taskId: 't1', agentId: 'coder', task: 'Build feature A' },
          { taskId: 't2', agentId: 'critic', task: 'Review feature A' },
        ],
        barrierTimeoutMs: 300000,
        aggregationType: 'summary',
      };
      expect(() => PARALLEL_TASK_DISPATCH_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should validate parallel dispatch with dependencies', () => {
      const payload = {
        ...common,
        tasks: [
          { taskId: 't1', agentId: 'coder', task: 'Build', dependsOn: [] },
          { taskId: 't2', agentId: 'qa', task: 'Test', dependsOn: ['t1'] },
        ],
      };
      expect(() => PARALLEL_TASK_DISPATCH_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should validate parallel dispatch with merge_patches aggregation', () => {
      const payload = {
        ...common,
        tasks: [{ taskId: 't1', agentId: 'coder', task: 'Patch' }],
        aggregationType: 'merge_patches',
        aggregationPrompt: 'Merge the patches',
      };
      expect(() => PARALLEL_TASK_DISPATCH_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should fail if tasks array is missing', () => {
      const payload = { ...common };
      expect(() => PARALLEL_TASK_DISPATCH_SCHEMA.parse(payload)).toThrow();
    });

    it('should accept empty tasks array (schema allows it)', () => {
      const payload = { ...common, tasks: [] };
      expect(() => PARALLEL_TASK_DISPATCH_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should map PARALLEL_TASK_DISPATCH in EVENT_SCHEMA_MAP', () => {
      expect(EVENT_SCHEMA_MAP[EventType.PARALLEL_TASK_DISPATCH as string]).toBe(
        PARALLEL_TASK_DISPATCH_SCHEMA
      );
    });
  });

  describe('CODER_TASK_COMPLETED_SCHEMA', () => {
    it('should validate a correct coder task completion event', () => {
      const payload = {
        ...common,
        task: 'Implement feature X',
        response: 'Feature implemented successfully',
        patchApplied: true,
        gapIds: ['gap-001'],
      };
      expect(() => CODER_TASK_COMPLETED_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should validate coder completion without optional fields', () => {
      const payload = {
        ...common,
        task: 'Fix bug',
      };
      expect(() => CODER_TASK_COMPLETED_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should map CODER_TASK_COMPLETED in EVENT_SCHEMA_MAP', () => {
      expect(EVENT_SCHEMA_MAP[EventType.CODER_TASK_COMPLETED as string]).toBe(
        CODER_TASK_COMPLETED_SCHEMA
      );
    });
  });

  describe('TASK_CANCELLED_SCHEMA', () => {
    it('should validate a correct task cancellation event', () => {
      const payload = {
        ...common,
        taskId: 'task-123',
        reason: 'User requested cancellation',
      };
      expect(() => TASK_CANCELLED_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should validate cancellation with parallel dispatch ID', () => {
      const payload = {
        ...common,
        reason: 'Cancel all parallel tasks',
        parallelDispatchId: 'dispatch-456',
      };
      expect(() => TASK_CANCELLED_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should validate cancellation without optional fields', () => {
      const payload = { ...common };
      expect(() => TASK_CANCELLED_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should map TASK_CANCELLED in EVENT_SCHEMA_MAP', () => {
      expect(EVENT_SCHEMA_MAP[EventType.TASK_CANCELLED as string]).toBe(TASK_CANCELLED_SCHEMA);
    });
  });

  describe('HANDOFF_SCHEMA', () => {
    it('should validate a correct handoff event', () => {
      const payload = {
        ...common,
        handoffType: 'approval',
        message: 'Please approve this deployment',
        expiresAt: Date.now() + 3600000,
      };
      expect(() => HANDOFF_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should validate handoff with clarification type', () => {
      const payload = {
        ...common,
        handoffType: 'clarification',
        message: 'What does this error mean?',
      };
      expect(() => HANDOFF_SCHEMA.parse(payload)).not.toThrow();
    });

    it('should fail if handoffType is invalid', () => {
      const payload = { ...common, handoffType: 'invalid_type' };
      expect(() => HANDOFF_SCHEMA.parse(payload)).toThrow();
    });

    it('should map HANDOFF in EVENT_SCHEMA_MAP', () => {
      expect(EVENT_SCHEMA_MAP[EventType.HANDOFF as string]).toBe(HANDOFF_SCHEMA);
    });
  });

  describe('EVENT_SCHEMA_MAP completeness', () => {
    it('should have schemas for all critical event types', () => {
      const criticalEventTypes = [
        EventType.CODER_TASK,
        EventType.CONTINUATION_TASK,
        EventType.TASK_COMPLETED,
        EventType.TASK_FAILED,
        EventType.SYSTEM_BUILD_SUCCESS,
        EventType.SYSTEM_BUILD_FAILED,
        EventType.SYSTEM_HEALTH_REPORT,
        EventType.OUTBOUND_MESSAGE,
        EventType.PARALLEL_TASK_COMPLETED,
        EventType.HEARTBEAT_PROACTIVE,
        EventType.CONSENSUS_REQUEST,
        EventType.CONSENSUS_VOTE,
        EventType.CONSENSUS_REACHED,
        EventType.REPUTATION_UPDATE,
        EventType.PARALLEL_TASK_DISPATCH,
        EventType.CODER_TASK_COMPLETED,
        EventType.TASK_CANCELLED,
        EventType.HANDOFF,
        EventType.MERGER_TASK,
        EventType.RESEARCH_TASK,
      ];

      for (const eventType of criticalEventTypes) {
        expect(EVENT_SCHEMA_MAP[eventType as string]).toBeDefined();
      }
    });

    it('should have a schema for every agent task type', () => {
      const agentTaskTypes = [
        `${AgentType.STRATEGIC_PLANNER}_task`,
        `${AgentType.COGNITION_REFLECTOR}_task`,
        `${AgentType.QA}_task`,
        `${AgentType.CRITIC}_task`,
        `${AgentType.FACILITATOR}_task`,
        `${AgentType.RESEARCHER}_task`,
        `${AgentType.MERGER}_task`,
      ];

      for (const taskType of agentTaskTypes) {
        expect(EVENT_SCHEMA_MAP[taskType]).toBeDefined();
      }
    });
  });
});
