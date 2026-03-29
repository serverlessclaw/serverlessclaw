import { describe, it, expect, vi } from 'vitest';
import { decomposePlan } from './decomposition';

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Plan Decomposition', () => {
  describe('decomposePlan', () => {
    it('should return single task for short plans', () => {
      const plan = 'Fix the login bug by updating the auth handler.';
      const result = decomposePlan(plan, 'plan-1', ['gap-1']);

      expect(result.wasDecomposed).toBe(false);
      expect(result.subTasks).toHaveLength(1);
      expect(result.subTasks[0].task).toBe(plan);
      expect(result.subTasks[0].gapIds).toEqual(['gap-1']);
    });

    it('should decompose plans with numbered steps', () => {
      const plan = `Strategic Plan: Refactor Authentication

1. Update the User model to add the new emailVerified field with a default value of false. This requires modifying the DynamoDB schema.

2. Create a new verification endpoint at /api/verify-email that accepts a token parameter and marks the user as verified.

3. Update the login flow in auth.ts to check the emailVerified field and reject unverified users with a helpful error message.

4. Write comprehensive tests for the new verification flow including edge cases for expired tokens.

5. Deploy the changes and verify the health endpoint still returns success.`;

      const result = decomposePlan(plan, 'plan-2', ['gap-1', 'gap-2']);

      expect(result.wasDecomposed).toBe(true);
      expect(result.subTasks.length).toBeGreaterThan(1);
      expect(result.subTasks[0].order).toBe(0);
      expect(result.subTasks[0].dependencies).toEqual([]);
      expect(result.subTasks[1].dependencies).toEqual([0]);
      expect(result.planId).toBe('plan-2');
    });

    it('should decompose plans with dash markers', () => {
      const plan = `Plan for Multi-Channel Notification System:

- First, analyze the existing notification code structure and identify all the places that need updates to support multiple messaging platforms simultaneously. This involves reviewing the current Telegram integration and understanding how messages flow through the system.

- Then, implement the new channel adapter interface that abstracts the differences between Telegram, Discord, Slack, and email. Each adapter must implement the send method with proper error handling and retry logic.

- Next, add integration tests to verify the channel routing logic works correctly. The tests should cover scenarios where a user has multiple channels configured and messages need to be fanned out to all enabled channels.

- Finally, update the documentation to describe the new multi-channel architecture and provide examples of how to add new channel adapters in the future.`;

      const result = decomposePlan(plan, 'plan-3', ['gap-3']);

      expect(result.wasDecomposed).toBe(true);
      expect(result.subTasks.length).toBeGreaterThan(1);
    });

    it('should cap at 5 sub-tasks maximum', () => {
      const steps = Array.from(
        { length: 10 },
        (_, i) => `${i + 1}. Step ${i + 1}: Do something important and complex here with details.`
      ).join('\n\n');

      const result = decomposePlan(steps, 'plan-4', ['gap-1']);

      expect(result.subTasks.length).toBeLessThanOrEqual(5);
    });

    it('should include plan context in sub-tasks', () => {
      const plan = `Plan for Database Migration:
1. First step one with a lot of detail about what needs to happen. We need to carefully review the existing schema and identify all breaking changes that could affect downstream consumers. This includes checking foreign key relationships and index configurations.

2. Second step two with even more detail about the implementation. After the schema review, we must write migration scripts that handle both forward and rollback scenarios. Each script needs to be tested against a production-like dataset to ensure performance is acceptable.`;

      const result = decomposePlan(plan, 'plan-5', ['gap-1']);

      expect(result.wasDecomposed).toBe(true);
      expect(result.subTasks[0].task).toContain('plan-5');
      expect(result.subTasks[0].task).toContain('sub-task 1');
      expect(result.subTasks[1].task).toContain('sub-task 2');
    });

    it('should assign gapIds to sub-tasks', () => {
      const plan = `Plan for API Refactoring:
1. Step one is very important and needs lots of detail to implement properly. We need to update the User model to add the new emailVerified field with proper defaults, update all related queries, and ensure backward compatibility with existing API consumers.

2. Step two is also important and needs attention to detail in the code. We must create a new verification endpoint that accepts tokens, validates them against the database, and updates the user status. The endpoint must handle expired tokens gracefully.`;

      const result = decomposePlan(plan, 'plan-6', ['gap-a', 'gap-b']);

      expect(result.subTasks.length).toBeGreaterThanOrEqual(2);
      expect(result.subTasks[0].gapIds).toContain('gap-a');
      expect(result.subTasks[1].gapIds).toContain('gap-b');
    });

    it('should estimate complexity for sub-tasks', () => {
      const plan = `Plan with Varying Complexity for System Upgrade:
1. Simple configuration update: change the default timeout value from 30 to 60 seconds in the config file and update the corresponding environment variable documentation. This is a trivial modification that requires no code logic changes, just a simple value swap in the settings.

2. Complex security refactor of the entire authentication and authorization system with major implications for the infrastructure. This involves rewriting the auth middleware to support OAuth2 PKCE flow, updating all IAM roles to use least-privilege principles, implementing token rotation with DynamoDB-backed session management, adding rate limiting per user, and creating comprehensive integration tests for all security-critical code paths across Lambda functions.`;

      const result = decomposePlan(plan, 'plan-7', ['gap-1']);

      expect(result.subTasks.length).toBeGreaterThanOrEqual(2);
      // All sub-tasks should have a complexity score between 1 and 10
      for (const subTask of result.subTasks) {
        expect(subTask.complexity).toBeGreaterThanOrEqual(1);
        expect(subTask.complexity).toBeLessThanOrEqual(10);
      }
    });
  });
});
