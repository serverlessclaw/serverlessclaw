import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decomposePlan, PlanSubTask } from './decomposition';

// Mock logger
vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * Helper to generate a plan string longer than MIN_PLAN_LENGTH_FOR_DECOMPOSITION (500)
 * with numbered step markers.
 */
function longPlan(steps: string[]): string {
  return steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
}

/** A single step that is ~150+ chars to ensure the full plan exceeds 500. */
const STEP_1 =
  'Update the User model to add emailVerified field with proper validation, type checking, and database migration scripts that handle existing records gracefully without downtime or data loss.';
const STEP_2 =
  'Create a verification endpoint at /api/verify-email with secure token generation, time-based expiration logic, rate limiting to prevent brute-force attacks, and comprehensive error responses.';
const STEP_3 =
  'Update the login flow to check emailVerified status, redirect unverified users to a resend page, and ensure backward compatibility with existing sessions and OAuth providers.';
const STEP_4 =
  'Write comprehensive tests covering all edge cases, integration scenarios, and security validations including mocked external services and header verification.';

describe('decomposePlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Short plans
  // ---------------------------------------------------------------------------
  describe('short plans (< 500 chars)', () => {
    it('should return a single sub-task without decomposition', () => {
      const shortPlan = 'Fix the search feature by updating the query logic.';
      const result = decomposePlan(shortPlan, 'plan-1', ['GAP#1']);

      expect(result.wasDecomposed).toBe(false);
      expect(result.totalSubTasks).toBe(1);
      expect(result.subTasks).toHaveLength(1);
      expect(result.subTasks[0].subTaskId).toBe('plan-1-sub-0');
      expect(result.subTasks[0].planId).toBe('plan-1');
      expect(result.subTasks[0].task).toBe(shortPlan);
      expect(result.subTasks[0].gapIds).toEqual(['GAP#1']);
      expect(result.subTasks[0].order).toBe(0);
      expect(result.subTasks[0].dependencies).toEqual([]);
    });

    it('should preserve original plan in result', () => {
      const plan = 'Short plan content.';
      const result = decomposePlan(plan, 'plan-2', ['GAP#2']);

      expect(result.originalPlan).toBe(plan);
      expect(result.planId).toBe('plan-2');
    });
  });

  // ---------------------------------------------------------------------------
  // Numbered step markers
  // ---------------------------------------------------------------------------
  describe('plans with numbered step markers', () => {
    it('should split plan into sub-tasks by numbered list', () => {
      const plan = longPlan([STEP_1, STEP_2, STEP_3, STEP_4]);

      const result = decomposePlan(plan, 'plan-3', ['GAP#10', 'GAP#11']);

      expect(result.wasDecomposed).toBe(true);
      expect(result.totalSubTasks).toBeGreaterThan(1);
      expect(result.subTasks.length).toBeLessThanOrEqual(5);

      result.subTasks.forEach((sub: PlanSubTask, index: number) => {
        expect(sub.subTaskId).toBe(`plan-3-sub-${index}`);
        expect(sub.planId).toBe('plan-3');
        expect(sub.order).toBe(index);
        expect(sub.complexity).toBeGreaterThanOrEqual(1);
        expect(sub.complexity).toBeLessThanOrEqual(10);
        expect(sub.gapIds.length).toBeGreaterThan(0);
      });

      // First sub-task has no dependencies
      expect(result.subTasks[0].dependencies).toEqual([]);

      // Subsequent sub-tasks depend on previous
      for (let i = 1; i < result.subTasks.length; i++) {
        expect(result.subTasks[i].dependencies).toContain(i - 1);
      }
    });

    it('should include plan context in each sub-task', () => {
      const plan = longPlan([STEP_1, STEP_2, STEP_3]);

      const result = decomposePlan(plan, 'plan-ctx', ['GAP#20']);

      result.subTasks.forEach((sub: PlanSubTask) => {
        expect(sub.task).toContain('sub-task');
        expect(sub.task).toContain('plan context');
        expect(sub.task).toContain('YOUR SPECIFIC TASK');
        expect(sub.task).toContain('Gap IDs');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Dash markers
  // ---------------------------------------------------------------------------
  describe('plans with dash markers', () => {
    it('should split plan into sub-tasks by dash list', () => {
      const plan =
        'Strategic Plan for System Improvement:\n' +
        `- Add Slack integration for real-time notifications with message formatting, channel routing, and emoji reactions for improved team awareness.\n` +
        `- Implement rate limiting on all API endpoints with sliding window algorithm to prevent abuse and ensure fair usage across tenants.\n` +
        `- Create automated backup system for DynamoDB tables with point-in-time recovery, cross-region replication, and lifecycle policies.\n` +
        `- Set up monitoring dashboards for system health metrics with configurable alerting thresholds and incident response runbooks.`;

      const result = decomposePlan(plan, 'plan-4', ['GAP#30']);

      expect(result.wasDecomposed).toBe(true);
      expect(result.totalSubTasks).toBeGreaterThan(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Keyword markers
  // ---------------------------------------------------------------------------
  describe('plans with keyword markers', () => {
    it('should split by "First, Then, Next, Finally" keywords', () => {
      const plan =
        'First, update the database schema to support multi-tenancy with proper row-level isolation, index optimization, and backward-compatible migrations for existing records.\n' +
        'Then, modify the API layer to extract workspace context from request headers and JWT tokens, injecting tenant scope into every database query and cache key.\n' +
        'Next, implement workspace-scoped memory operations to prevent data leakage between tenants, including isolated search indexes and separate insight namespaces.\n' +
        'Finally, write integration tests that verify workspace isolation across all endpoints, including concurrent multi-tenant access patterns and edge cases.';

      const result = decomposePlan(plan, 'plan-5', ['GAP#40', 'GAP#41']);

      expect(result.wasDecomposed).toBe(true);
      expect(result.totalSubTasks).toBeGreaterThan(1);
    });

    it('should split by horizontal rule separator', () => {
      const plan =
        'Phase 1: Infrastructure setup with detailed steps for VPC configuration, subnet allocation, security group rules, and NAT gateway provisioning for production workloads.\n' +
        '\n---\n' +
        'Phase 2: Application deployment with container orchestration, service mesh configuration, blue-green deployment strategy, and rollback procedures for zero-downtime releases.\n' +
        '\n---\n' +
        'Phase 3: Monitoring and alerting setup with custom dashboards, SLO definitions, incident response automation, and on-call rotation integration for 24/7 reliability.';

      const result = decomposePlan(plan, 'plan-6', ['GAP#50']);

      expect(result.wasDecomposed).toBe(true);
      expect(result.totalSubTasks).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Max sub-tasks capping
  // ---------------------------------------------------------------------------
  describe('max sub-tasks capping', () => {
    it('should cap at 5 sub-tasks and append remainder to last', () => {
      const steps = Array.from(
        { length: 7 },
        (_, i) =>
          `Step ${i + 1} with enough content to qualify as a real segment of meaningful length for decomposition testing and validation purposes.`
      );
      const plan = longPlan(steps);

      const result = decomposePlan(plan, 'plan-7', ['GAP#60']);

      expect(result.wasDecomposed).toBe(true);
      expect(result.totalSubTasks).toBeLessThanOrEqual(5);
      expect(result.subTasks.length).toBeLessThanOrEqual(5);

      // Last sub-task should contain overflow content
      const lastSubTask = result.subTasks[result.subTasks.length - 1];
      expect(lastSubTask.task.length).toBeGreaterThan(100);
    });
  });

  // ---------------------------------------------------------------------------
  // Complexity estimation
  // ---------------------------------------------------------------------------
  describe('complexity estimation', () => {
    it('should assign higher complexity for long segments with refactoring', () => {
      const longSegment = 'A'.repeat(2500);
      const plan = longPlan([
        `${longSegment} with refactoring and migration requirements for the legacy system.`,
        'Short step for deployment.',
      ]);

      const result = decomposePlan(plan, 'plan-8', ['GAP#70']);

      expect(result.wasDecomposed).toBe(true);
      const firstComplexity = result.subTasks[0].complexity;
      expect(firstComplexity).toBeGreaterThanOrEqual(5);
    });

    it('should reduce complexity for test-heavy segments', () => {
      const plan = longPlan([
        'Write comprehensive test coverage for the new feature with spec files, integration tests, and proper mocking of external services and dependencies for thorough validation of all code paths and edge cases.',
        'Deploy the changes to staging with canary rollout strategy, feature flags, and real-time monitoring of error rates and latency percentiles across all regions with automated alerting.',
        'Set up automated rollback triggers based on error rate thresholds and latency anomalies detected during the canary deployment window with instant notification to on-call engineers.',
      ]);

      const result = decomposePlan(plan, 'plan-9', ['GAP#80']);

      expect(result.wasDecomposed).toBe(true);
      const testSubTask = result.subTasks.find((s: PlanSubTask) =>
        s.task.toLowerCase().includes('test')
      );
      if (testSubTask) {
        expect(testSubTask.complexity).toBeLessThanOrEqual(5);
      }
    });

    it('should increase complexity for security-related segments', () => {
      const plan = longPlan([
        'Implement security hardening with auth token rotation, permission validation for all API endpoints, and comprehensive audit logging for compliance requirements across all services.',
        'Update documentation with security best practices, API versioning strategy, and developer onboarding guides for new team members joining the project and learning the codebase.',
        'Configure WAF rules and DDoS protection at the edge to handle volumetric attacks and ensure service availability during peak traffic periods with automatic scaling policies.',
      ]);

      const result = decomposePlan(plan, 'plan-10', ['GAP#90']);

      expect(result.wasDecomposed).toBe(true);
      const secSubTask = result.subTasks.find((s: PlanSubTask) =>
        s.task.toLowerCase().includes('security')
      );
      if (secSubTask) {
        expect(secSubTask.complexity).toBeGreaterThanOrEqual(4);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Gap ID distribution
  // ---------------------------------------------------------------------------
  describe('gap ID distribution', () => {
    it('should distribute gapIds across sub-tasks', () => {
      const plan = longPlan([STEP_1, STEP_2, STEP_3]);
      const gapIds = ['GAP#100', 'GAP#101', 'GAP#102'];

      const result = decomposePlan(plan, 'plan-11', gapIds);

      expect(result.wasDecomposed).toBe(true);
      result.subTasks.forEach((sub: PlanSubTask) => {
        expect(sub.gapIds.length).toBeGreaterThan(0);
      });
    });

    it('should handle single gapId across multiple sub-tasks', () => {
      const plan = longPlan([STEP_1, STEP_2, STEP_3]);

      const result = decomposePlan(plan, 'plan-12', ['GAP#SINGLE']);

      expect(result.wasDecomposed).toBe(true);
      result.subTasks.forEach((sub: PlanSubTask) => {
        expect(sub.gapIds).toContain('GAP#SINGLE');
      });
    });

    it('should handle empty gapIds array', () => {
      const plan = longPlan([STEP_1, STEP_2, STEP_3]);

      const result = decomposePlan(plan, 'plan-13', []);

      expect(result.wasDecomposed).toBe(true);
      result.subTasks.forEach((sub: PlanSubTask) => {
        expect(sub.gapIds).toEqual([]);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Sequential dependencies
  // ---------------------------------------------------------------------------
  describe('sequential dependencies', () => {
    it('should create sequential dependency chain', () => {
      const steps = Array.from(
        { length: 3 },
        (_, i) =>
          `Step ${i + 1} with enough content for decomposition to trigger properly here and there for testing and validation of sequential dependencies in the execution pipeline with proper ordering constraints.`
      );
      const plan = longPlan(steps);

      const result = decomposePlan(plan, 'plan-dep', ['GAP#110']);

      expect(result.wasDecomposed).toBe(true);
      expect(result.subTasks.length).toBeGreaterThanOrEqual(3);

      // sub-0: no deps
      expect(result.subTasks[0].dependencies).toEqual([]);
      // sub-1: depends on 0
      expect(result.subTasks[1].dependencies).toEqual([0]);
      // sub-2: depends on 1
      expect(result.subTasks[2].dependencies).toEqual([1]);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe('edge cases', () => {
    it('should handle empty plan string', () => {
      const result = decomposePlan('', 'plan-empty', []);

      expect(result.wasDecomposed).toBe(false);
      expect(result.totalSubTasks).toBe(1);
      expect(result.subTasks[0].task).toBe('');
    });

    it('should handle plan with only whitespace', () => {
      const result = decomposePlan('   \n\n   ', 'plan-whitespace', []);

      expect(result.wasDecomposed).toBe(false);
      expect(result.totalSubTasks).toBe(1);
    });

    it('should handle plan at exactly 500 characters', () => {
      const plan = 'A'.repeat(500);
      const result = decomposePlan(plan, 'plan-boundary', ['GAP#120']);

      expect(result.subTasks.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle plan above 500 chars with no markers', () => {
      const plan =
        'This is a plan that is just over five hundred characters but has no step markers or numbered lists or dashes or keywords to split on so it should remain as a single task even though it exceeds the minimum length threshold for decomposition attempts.' +
        'A'.repeat(400);
      const result = decomposePlan(plan, 'plan-no-markers', ['GAP#130']);

      // No markers found — fallback may split by paragraphs or return single
      expect(result.subTasks.length).toBeGreaterThanOrEqual(1);
    });
  });
});
