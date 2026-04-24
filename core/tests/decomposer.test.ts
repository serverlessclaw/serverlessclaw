import { describe, it, expect } from 'vitest';
import { decomposePlan } from '../lib/agent/decomposer';
import { AgentType } from '../lib/types/agent';

describe('decomposePlan', () => {
  const planId = 'PLAN-TEST-001';
  const gapIds = ['GAP-1', 'GAP-2', 'GAP-3'];

  describe('short plan handling', () => {
    it('should dispatch short plan as single task without decomposition', async () => {
      const shortPlan = 'Fix the bug';
      const result = await decomposePlan(shortPlan, planId, gapIds);

      expect(result.wasDecomposed).toBe(false);
      expect(result.totalSubTasks).toBe(1);
      expect(result.subTasks[0].task).toBe(shortPlan);
      expect(result.subTasks[0].planId).toBe(planId);
    });

    it('should force decomposition even for short plans when force=true', async () => {
      const shortPlan = `1. Fix the authentication bug
2. Update the database schema
3. Deploy the changes`;
      const result = await decomposePlan(shortPlan, planId, gapIds, { force: true });

      expect(result.totalSubTasks).toBe(3);
      expect(result.wasDecomposed).toBe(true);
    });
  });

  describe('heuristic decomposition by step markers', () => {
    it('should decompose plan with numbered steps', async () => {
      const plan = `
1. Create the user authentication module with JWT support including proper token generation, validation, refresh mechanisms, and secure storage on the client side with httpOnly cookies and CSRF protection for the entire application stack
2. Update the API gateway to include auth middleware that intercepts all incoming requests, validates tokens against the user store, checks permissions using the RBAC model, and returns appropriate error codes for unauthorized access attempts
3. Write unit tests for the auth module covering token generation, validation, expiration, refresh flows, concurrent sessions, and security edge cases like brute force protection and account lockout policies
4. Update documentation with new auth flow including OpenAPI specifications, migration guides, example code snippets for all supported client SDKs, and troubleshooting guides for common integration issues
      `.trim();

      const result = await decomposePlan(plan, planId, gapIds);

      expect(result.wasDecomposed).toBe(true);
      expect(result.totalSubTasks).toBeGreaterThan(1);
      expect(result.subTasks[0].task).toContain('authentication');
    });

    it('should decompose plan with bullet points', async () => {
      const plan = `
- Implement user registration endpoint with email verification, password strength validation, CAPTCHA protection, and rate limiting to prevent abuse and ensure only legitimate users can create accounts in the system
- Add email verification flow with secure token generation, expiration handling, resend mechanisms, and proper error messaging for invalid or expired verification links that users receive in their inbox
- Create password reset functionality with secure token generation, time-limited reset links, email notifications, and proper validation to ensure only the account owner can change their password without compromising security
- Set up session management with concurrent session limits, idle timeout handling, secure cookie configuration, and proper cleanup of expired sessions to prevent session fixation and hijacking attacks
      `.trim();

      const result = await decomposePlan(plan, planId, gapIds);

      expect(result.wasDecomposed).toBe(true);
      expect(result.totalSubTasks).toBeGreaterThan(1);
    });

    it('should decompose plan with bullet points', async () => {
      const plan = `
- Implement user registration endpoint with email verification, password strength validation, CAPTCHA protection, and rate limiting to prevent abuse and ensure only legitimate users can create accounts in the system
- Add email verification flow with secure token generation, expiration handling, resend mechanisms, and proper error messaging for invalid or expired verification links that users receive in their inbox
- Create password reset functionality with secure token generation, time-limited reset links, email notifications, and proper validation to ensure only the account owner can change their password without compromising security
- Set up session management with concurrent session limits, idle timeout handling, secure cookie configuration, and proper cleanup of expired sessions to prevent session fixation and hijacking attacks
      `.trim();

      const result = await decomposePlan(plan, planId, gapIds);

      expect(result.wasDecomposed).toBe(true);
      expect(result.totalSubTasks).toBeGreaterThan(1);
    });

    it('should decompose plan with Step N markers', async () => {
      const plan = `
Step 1: Setup the database schema for users including all necessary tables, indexes, and migration scripts for the new user management system that will replace the legacy authentication module with modern security practices and proper data validation at the database level to ensure data integrity and prevent SQL injection attacks across the entire application stack
Step 2: Create the API routes for user registration, login, password reset, and profile management with proper rate limiting, input validation, error handling, and comprehensive logging for audit purposes and monitoring dashboards
Step 3: Add validation middleware for all incoming requests including schema validation, authentication token verification, permission checks, and request sanitization to prevent common web vulnerabilities and ensure data consistency across all service boundaries
      `.trim();

      const result = await decomposePlan(plan, planId, gapIds);

      expect(result.wasDecomposed).toBe(true);
      expect(result.totalSubTasks).toBe(3);
    });

    it('should decompose plan with paragraph splits as fallback', async () => {
      const plan = `
First we need to create a new module for handling payments. This module should support multiple providers and be easily extensible.

Then we need to integrate Stripe as the primary payment provider. This involves setting up webhooks and handling callbacks.

Finally we should add PayPal as a secondary option for international customers.
      `.trim();

      const result = await decomposePlan(plan, planId, gapIds, { minLength: 100 });

      expect(result.wasDecomposed).toBe(true);
      expect(result.totalSubTasks).toBeGreaterThan(1);
    });
  });

  describe('maxSubTasks capping', () => {
    it('should cap sub-tasks at maxSubTasks limit', async () => {
      const plan = `
1. Task one: Implement the user authentication module with JWT support and proper token management including refresh tokens and secure storage mechanisms for the client side application that needs to handle multiple authentication flows
2. Task two: Update the API gateway configuration to include the new authentication middleware and route all existing endpoints through the new auth layer while maintaining backwards compatibility with the legacy system during the migration period
3. Task three: Write comprehensive unit tests for the authentication module covering all edge cases including token expiration, refresh flows, concurrent sessions, and security scenarios like brute force protection and account lockout policies
4. Task four: Update the API documentation with the new authentication flow including OpenAPI specifications, migration guides, and example code snippets for all supported client SDKs and programming languages
5. Task five: Deploy the authentication module to the staging environment and run the full integration test suite to verify that all existing functionality continues to work correctly with the new authentication layer in place
6. Task six: Monitor the staging deployment for at least 24 hours and collect performance metrics, error rates, and user feedback to ensure the new authentication system meets all SLA requirements and user experience expectations
7. Task seven: Promote the authentication module to production after successful staging validation and coordinate the cutover with all dependent teams to minimize disruption to ongoing operations and user experience
      `.trim();

      const result = await decomposePlan(plan, planId, gapIds, { maxSubTasks: 3, minLength: 50 });

      expect(result.totalSubTasks).toBe(3);
      expect(result.subTasks[2].task).toContain('Task seven');
    });

    it('should append remaining content to last sub-task when capped', async () => {
      const plan = `
1. First task description
2. Second task description
3. Third task description
4. Fourth task description
      `.trim();

      const result = await decomposePlan(plan, planId, gapIds, { maxSubTasks: 2, minLength: 50 });

      expect(result.totalSubTasks).toBe(2);
      expect(result.subTasks[1].task).toContain('Third');
      expect(result.subTasks[1].task).toContain('Fourth');
    });
  });

  describe('agent routing', () => {
    it('should route research tasks to RESEARCHER', async () => {
      const plan = `
1. Research the best authentication patterns for serverless
2. Investigate Auth0 vs Cognito pricing and features
      `.trim();

      const result = await decomposePlan(plan, planId, gapIds, { minLength: 50 });

      const researchTasks = result.subTasks.filter((s) => s.agentId === AgentType.RESEARCHER);
      expect(researchTasks.length).toBeGreaterThan(0);
    });

    it('should route implementation tasks to CODER', async () => {
      const plan = `
1. Implement the user registration API endpoint
2. Create database migration for users table
      `.trim();

      const result = await decomposePlan(plan, planId, gapIds, { minLength: 50 });

      const coderTasks = result.subTasks.filter((s) => s.agentId === AgentType.CODER);
      expect(coderTasks.length).toBeGreaterThan(0);
    });

    it('should use defaultAgent when intent is ambiguous', async () => {
      const plan = `
 1. Complete the first phase of the project
 2. Finalize the second phase of the project
       `.trim();

      const result = await decomposePlan(plan, planId, gapIds, {
        minLength: 50,
        defaultAgentId: AgentType.CODER,
      });

      expect(result.subTasks.every((s) => s.agentId === AgentType.CODER)).toBe(true);
    });
  });

  describe('gap distribution', () => {
    it('should distribute gapIds across sub-tasks', async () => {
      const plan = `
1. First task: Implement the core authentication module with JWT token generation, validation, and refresh mechanisms including secure password hashing with bcrypt and proper session management for distributed systems
2. Second task: Create the authorization middleware that checks user permissions against the RBAC model and enforces access control policies at the API gateway level with proper caching for performance
3. Third task: Write integration tests that verify the complete authentication and authorization flow including edge cases like token expiration, concurrent sessions, and privilege escalation attempts
      `.trim();

      const result = await decomposePlan(plan, planId, ['GAP-A', 'GAP-B'], { minLength: 30 });

      expect(result.subTasks[0].gapIds).toContain('GAP-A');
      expect(result.subTasks[1].gapIds).toContain('GAP-B');
    });
  });

  describe('complexity estimation', () => {
    it('should estimate higher complexity for longer plans', async () => {
      const shortPlan = '1. Fix a simple typo';
      const longPlan = `
1. Refactor the entire authentication module to use a new provider
2. Migrate all existing user data to the new schema with zero downtime
3. Update all dependent services to use the new authentication flow
4. Write comprehensive integration tests covering all edge cases
5. Update API documentation and migration guides for all consumers
      `.trim();

      const shortResult = await decomposePlan(shortPlan, planId, [], { force: true });
      const longResult = await decomposePlan(longPlan, planId, []);

      expect(longResult.subTasks[0].complexity).toBeGreaterThanOrEqual(
        shortResult.subTasks[0].complexity
      );
    });

    it('should increase complexity for technical keywords', async () => {
      const plan = `
1. Refactor the SST infrastructure to use new Lambda architecture
2. Migrate DynamoDB tables with zero downtime
      `.trim();

      const result = await decomposePlan(plan, planId, [], { minLength: 50 });

      expect(result.subTasks[0].complexity).toBeGreaterThanOrEqual(5);
    });
  });

  describe('no decomposition when no markers found', () => {
    it('should return single task when no step markers are present', async () => {
      const plan =
        'This is a plan without any step markers or structure, just a continuous block of text describing what needs to be done in a vague way without any clear separation points or numbered lists or bullet points or paragraphs that could be split into multiple tasks for parallel execution by different agents';

      const result = await decomposePlan(plan, planId, gapIds);

      expect(result.wasDecomposed).toBe(false);
      expect(result.totalSubTasks).toBe(1);
    });
  });

  describe('default options', () => {
    it('should use default min length of 500', async () => {
      const plan = 'x'.repeat(499);
      const result = await decomposePlan(plan, planId, gapIds);

      expect(result.wasDecomposed).toBe(false);
    });

    it('should use default max sub-tasks of 5', async () => {
      const plan = Array.from({ length: 10 }, (_, i) => `${i + 1}. Task ${i + 1}`).join('\n');
      const result = await decomposePlan(plan, planId, gapIds, { minLength: 50 });

      expect(result.totalSubTasks).toBeLessThanOrEqual(5);
    });
  });
});
