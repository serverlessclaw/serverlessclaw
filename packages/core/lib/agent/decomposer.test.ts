import { describe, it, expect } from 'vitest';
import { decomposePlan } from './decomposer';
import { AGENT_TYPES } from '../types/agent';

describe('Plan Decomposer', () => {
  const planId = 'test-plan';
  const gapIds = ['gap-1'];

  it('should decompose a plan using ### Goal: headers', async () => {
    const plan = `
      I have designed a mission to evolve the system.
      
      ### Goal: RESEARCHER - Initial Audit
      Analyze the current auth implementation in core/lib/auth.ts.
      
      ### Goal: CODER - Migration
      Refactor the auth logic to use the new provider.
      
      ### Goal: CODER - Cleanup
      Remove the old legacy files.
    `;

    const result = await decomposePlan(plan, planId, gapIds);

    expect(result.wasDecomposed).toBe(true);
    expect(result.subTasks).toHaveLength(3);
    expect(result.subTasks[0].agentId).toBe(AGENT_TYPES.RESEARCHER);
    expect(result.subTasks[1].agentId).toBe(AGENT_TYPES.CODER);
    expect(result.subTasks[2].agentId).toBe(AGENT_TYPES.CODER);
    expect(result.subTasks[0].task).toContain('### Goal: RESEARCHER - Initial Audit');
  });

  it('should fall back to numbered lists if headers are missing', async () => {
    const plan = `
      1. First step is research.
      2. Second step is coding.
      3. Third step is cleanup.
    `;

    const result = await decomposePlan(plan, planId, gapIds, { force: true });

    expect(result.wasDecomposed).toBe(true);
    expect(result.subTasks).toHaveLength(3);
  });

  it('should assign a default agent if intent is ambiguous', async () => {
    const plan = `
      ### Goal: Generic Task
      Just do something simple.
    `;

    const result = await decomposePlan(plan, planId, gapIds, { force: true });
    expect(result.subTasks[0].agentId).toBe(AGENT_TYPES.CODER); // Default
  });

  it('should not split if the plan is too short and not forced', async () => {
    const plan = 'Short plan.';
    const result = await decomposePlan(plan, planId, gapIds);
    expect(result.wasDecomposed).toBe(false);
    expect(result.subTasks).toHaveLength(1);
  });
});
