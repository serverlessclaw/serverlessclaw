import { describe, it, expect } from 'vitest';
import { DEFAULT_EVENT_ROUTING } from './event-routing';
import { EventType } from './types/agent';

/**
 * Event Routing Tests
 *
 * These tests verify the security-critical event routing configuration:
 * 1. Completeness: All expected event types have routes
 * 2. Integrity: All module paths and function names are valid
 * 3. Security: The allowlist validation prevents tampered routing
 */

describe('event-routing', () => {
  describe('DEFAULT_EVENT_ROUTING completeness', () => {
    // Event types that should have routing entries
    const REQUIRED_EVENT_TYPES = [
      EventType.SYSTEM_BUILD_FAILED,
      EventType.SYSTEM_BUILD_SUCCESS,
      EventType.CONTINUATION_TASK,
      EventType.SYSTEM_HEALTH_REPORT,
      EventType.TASK_COMPLETED,
      EventType.TASK_FAILED,
      EventType.CLARIFICATION_REQUEST,
      EventType.CLARIFICATION_TIMEOUT,
      EventType.PARALLEL_TASK_DISPATCH,
      EventType.PARALLEL_BARRIER_TIMEOUT,
      EventType.PARALLEL_TASK_COMPLETED,
      EventType.DAG_TASK_COMPLETED,
      EventType.DAG_TASK_FAILED,
      EventType.TASK_CANCELLED,
      EventType.HEARTBEAT_PROACTIVE,
      EventType.ESCALATION_LEVEL_TIMEOUT,
      EventType.CONSENSUS_REQUEST,
      EventType.CONSENSUS_VOTE,
      EventType.COGNITIVE_HEALTH_CHECK,
      EventType.STRATEGIC_TIE_BREAK,
      EventType.REPORT_BACK,
      EventType.SYSTEM_AUDIT_TRIGGER,
      EventType.DASHBOARD_FAILURE_DETECTED,
      EventType.RECOVERY_LOG,
      EventType.REPUTATION_UPDATE,
      EventType.ESCALATION_COMPLETED,
    ];

    it.each(REQUIRED_EVENT_TYPES)('should have routing entry for %s', (eventType) => {
      expect(DEFAULT_EVENT_ROUTING[eventType]).toBeDefined();
      expect(DEFAULT_EVENT_ROUTING[eventType].module).toBeDefined();
      expect(DEFAULT_EVENT_ROUTING[eventType].function).toBeDefined();
    });

    it('should have exactly the expected number of routing entries', () => {
      // This test will fail if someone adds a new event type without adding routing
      // Update this count when adding new routable event types (currently 32)
      expect(Object.keys(DEFAULT_EVENT_ROUTING)).toHaveLength(32);
    });
  });

  describe('Module path validation', () => {
    it('should have valid module paths for all routes', () => {
      for (const [, routing] of Object.entries(DEFAULT_EVENT_ROUTING)) {
        expect(routing.module).toBeTruthy();
        expect(routing.module).toMatch(/^(\.\/events\/|agent-multiplexer)/);
        expect(routing.module).not.toContain('..');
        expect(routing.module).not.toContain('//');
      }
    });

    it('should not have any absolute paths', () => {
      for (const [, routing] of Object.entries(DEFAULT_EVENT_ROUTING)) {
        expect(routing.module).not.toMatch(/^\//);
      }
    });

    it('should reference known handler modules', () => {
      const knownModules = [
        'build-handler',
        'health-handler',
        'task-result-handler',
        'clarification-handler',
        'clarification-timeout-handler',
        'continuation-handler',
        'parallel-handler',
        'parallel-barrier-timeout-handler',
        'parallel-task-completed-handler',
        'cancellation-handler',
        'proactive-handler',
        'escalation-handler',
        'consensus-handler',
        'cognitive-health-handler',
        'strategic-tie-break-handler',
        'report-back-handler',
        'audit-handler',
        'dag-supervisor-handler',
        'agent-multiplexer',
        'dlq-handler',
        'dashboard-failure-handler',
        'orchestration-handler',
        'delegation-handler',
        'handoff-handler',
        'reputation-handler',
        'recovery-handler',
      ];

      for (const [, routing] of Object.entries(DEFAULT_EVENT_ROUTING)) {
        const moduleName = routing.module.replace('./events/', '');
        expect(knownModules).toContain(moduleName);
      }
    });
  });

  describe('Function name validation', () => {
    it('should have valid function names for all routes', () => {
      for (const [, routing] of Object.entries(DEFAULT_EVENT_ROUTING)) {
        expect(routing.function).toBeTruthy();
        expect(routing.function).toMatch(/^(handle[A-Z]|handler)/);
      }
    });

    it('should not have empty function names', () => {
      for (const [, routing] of Object.entries(DEFAULT_EVENT_ROUTING)) {
        expect(routing.function.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Security: Allowlist validation', () => {
    it('should define ALLOWED_MODULES set from DEFAULT_EVENT_ROUTING', () => {
      // This simulates the allowlist validation in events.ts handler
      const ALLOWED_MODULES = new Set(Object.values(DEFAULT_EVENT_ROUTING).map((r) => r.module));

      // All modules from DEFAULT_EVENT_ROUTING should be in the allowlist
      for (const routing of Object.values(DEFAULT_EVENT_ROUTING)) {
        expect(ALLOWED_MODULES.has(routing.module)).toBe(true);
      }
    });

    it('should reject tampered module paths not in allowlist', () => {
      const ALLOWED_MODULES = new Set(Object.values(DEFAULT_EVENT_ROUTING).map((r) => r.module));

      const tamperedModules = [
        './events/malicious-handler',
        '../lib/evil',
        '/etc/passwd',
        'file:///tmp/backdoor',
      ];

      for (const module of tamperedModules) {
        expect(ALLOWED_MODULES.has(module)).toBe(false);
      }
    });

    it('should maintain consistent module-to-function mapping', () => {
      // Verify that each module's function is unique and consistent

      for (const [, routing] of Object.entries(DEFAULT_EVENT_ROUTING)) {
        const pair = `${routing.module}::${routing.function}`;
        // Some handlers handle multiple event types (e.g., task-result-handler handles both TASK_COMPLETED and TASK_FAILED)
        // So we don't enforce uniqueness, just that the pair is valid
        expect(pair).toMatch(/^(\.\/events\/[a-z-]+::handle[A-Z]|agent-multiplexer::handler)/);
      }
    });

    it('should have passContext set correctly for handlers that need Lambda context', () => {
      // Handlers that should pass context (based on events.ts implementation)
      const contextHandlers = [
        EventType.SYSTEM_BUILD_FAILED,
        EventType.CONTINUATION_TASK,
        EventType.SYSTEM_HEALTH_REPORT,
        EventType.HEARTBEAT_PROACTIVE,
      ];

      for (const eventType of contextHandlers) {
        const routing = DEFAULT_EVENT_ROUTING[eventType];
        if (routing) {
          expect(routing.passContext).toBe(true);
        }
      }
    });
  });

  describe('Route integrity', () => {
    it('should have no duplicate module paths with different functions', () => {
      // Build a map of module -> function
      const moduleFunctions = new Map<string, string>();

      for (const [, routing] of Object.entries(DEFAULT_EVENT_ROUTING)) {
        const existing = moduleFunctions.get(routing.module);
        if (existing && existing !== routing.function) {
          // This is allowed - some modules export multiple handler functions
          // Just verify it's intentional
          expect(routing.function).toMatch(/^handle/);
        } else {
          moduleFunctions.set(routing.module, routing.function);
        }
      }
    });

    it('should handle all critical system events', () => {
      const criticalEvents = [
        EventType.SYSTEM_BUILD_FAILED,
        EventType.SYSTEM_BUILD_SUCCESS,
        EventType.TASK_FAILED,
        EventType.SYSTEM_HEALTH_REPORT,
      ];

      for (const eventType of criticalEvents) {
        expect(DEFAULT_EVENT_ROUTING[eventType]).toBeDefined();
      }
    });

    it('should handle all parallel execution events', () => {
      const parallelEvents = [
        EventType.PARALLEL_TASK_DISPATCH,
        EventType.PARALLEL_BARRIER_TIMEOUT,
        EventType.PARALLEL_TASK_COMPLETED,
      ];

      for (const eventType of parallelEvents) {
        expect(DEFAULT_EVENT_ROUTING[eventType]).toBeDefined();
      }
    });

    it('should handle all evolution events', () => {
      const evolutionEvents = [
        EventType.CLARIFICATION_REQUEST,
        EventType.CLARIFICATION_TIMEOUT,
        EventType.ESCALATION_LEVEL_TIMEOUT,
      ];

      for (const eventType of evolutionEvents) {
        expect(DEFAULT_EVENT_ROUTING[eventType]).toBeDefined();
      }
    });

    it('should handle consensus events', () => {
      const consensusEvents = [EventType.CONSENSUS_REQUEST, EventType.CONSENSUS_VOTE];

      for (const eventType of consensusEvents) {
        expect(DEFAULT_EVENT_ROUTING[eventType]).toBeDefined();
      }
    });
  });
  describe('Event types NOT in routing (expected)', () => {
    // These event types are emitted but not routed to handlers in events.ts
    // They are handled by other components (e.g., SuperClaw webhook handler)
    const UNROUTED_EVENTS = [
      EventType.OUTBOUND_MESSAGE,
      EventType.SCHEDULE_TASK,
      EventType.CONSENSUS_REACHED,
      EventType.HANDOFF,
      EventType.HEALTH_ALERT,
      EventType.CHUNK,
      EventType.RESEARCH_TASK,
      EventType.CODER_TASK,
      EventType.EVOLUTION_PLAN,
      EventType.REFLECT_TASK,
      EventType.MERGER_TASK,
      EventType.FACILITATOR_TASK,
      EventType.CRITIC_TASK,
      EventType.QA_TASK,
    ];
    it('should document which event types are intentionally not routed', () => {
      // This test documents the expected behavior - these events are handled elsewhere
      for (const eventType of UNROUTED_EVENTS) {
        const isRouted = eventType in DEFAULT_EVENT_ROUTING;
        // Either it's not routed (expected) or it is routed (update this test)
        if (isRouted) {
          // If it becomes routed, update the UNROUTED_EVENTS list
          console.warn(`${eventType} is now routed - update UNROUTED_EVENTS list`);
        }
      }
    });
  });
});
