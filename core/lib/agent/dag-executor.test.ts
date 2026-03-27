/**
 * Tests for DAG Executor - Task Dependency Resolution
 */

import { describe, it, expect } from 'vitest';
import {
  buildDependencyGraph,
  validateDependencyGraph,
  getReadyTasks,
  completeTask,
  failTask,
  getTaskOutput,
  isExecutionComplete,
  getExecutionSummary,
  createTaskWithDependencyContext,
} from './dag-executor';
import { ParallelTaskDefinition } from './schema';

describe('DAG Executor', () => {
  describe('buildDependencyGraph', () => {
    it('should build a simple linear dependency chain', () => {
      const tasks: ParallelTaskDefinition[] = [
        { taskId: 'task1', agentId: 'coder', task: 'Write code' },
        { taskId: 'task2', agentId: 'qa', task: 'Test code', dependsOn: ['task1'] },
        { taskId: 'task3', agentId: 'deployer', task: 'Deploy code', dependsOn: ['task2'] },
      ];

      const state = buildDependencyGraph(tasks);

      expect(state.nodes.size).toBe(3);
      expect(state.readyQueue).toContain('task1');
      expect(state.readyQueue).not.toContain('task2');
      expect(state.readyQueue).not.toContain('task3');
    });

    it('should handle parallel tasks with no dependencies', () => {
      const tasks: ParallelTaskDefinition[] = [
        { taskId: 'task1', agentId: 'coder', task: 'Write frontend' },
        { taskId: 'task2', agentId: 'coder', task: 'Write backend' },
        { taskId: 'task3', agentId: 'qa', task: 'Test all', dependsOn: ['task1', 'task2'] },
      ];

      const state = buildDependencyGraph(tasks);

      expect(state.readyQueue).toContain('task1');
      expect(state.readyQueue).toContain('task2');
      expect(state.readyQueue).not.toContain('task3');
    });

    it('should handle diamond dependency pattern', () => {
      const tasks: ParallelTaskDefinition[] = [
        { taskId: 'A', agentId: 'agent', task: 'Task A' },
        { taskId: 'B', agentId: 'agent', task: 'Task B', dependsOn: ['A'] },
        { taskId: 'C', agentId: 'agent', task: 'Task C', dependsOn: ['A'] },
        { taskId: 'D', agentId: 'agent', task: 'Task D', dependsOn: ['B', 'C'] },
      ];

      const state = buildDependencyGraph(tasks);

      expect(state.readyQueue).toEqual(['A']);
      expect(state.nodes.get('A')?.dependents).toContain('B');
      expect(state.nodes.get('A')?.dependents).toContain('C');
    });
  });

  describe('validateDependencyGraph', () => {
    it('should detect cycles', () => {
      const tasks: ParallelTaskDefinition[] = [
        { taskId: 'A', agentId: 'agent', task: 'Task A', dependsOn: ['C'] },
        { taskId: 'B', agentId: 'agent', task: 'Task B', dependsOn: ['A'] },
        { taskId: 'C', agentId: 'agent', task: 'Task C', dependsOn: ['B'] },
      ];

      const state = buildDependencyGraph(tasks);
      const isValid = validateDependencyGraph(state);

      expect(isValid).toBe(false);
    });

    it('should pass for valid DAG', () => {
      const tasks: ParallelTaskDefinition[] = [
        { taskId: 'A', agentId: 'agent', task: 'Task A' },
        { taskId: 'B', agentId: 'agent', task: 'Task B', dependsOn: ['A'] },
        { taskId: 'C', agentId: 'agent', task: 'Task C', dependsOn: ['A'] },
      ];

      const state = buildDependencyGraph(tasks);
      const isValid = validateDependencyGraph(state);

      expect(isValid).toBe(true);
    });
  });

  describe('getReadyTasks', () => {
    it('should return tasks with satisfied dependencies', () => {
      const tasks: ParallelTaskDefinition[] = [
        { taskId: 'A', agentId: 'agent', task: 'Task A' },
        { taskId: 'B', agentId: 'agent', task: 'Task B', dependsOn: ['A'] },
        { taskId: 'C', agentId: 'agent', task: 'Task C', dependsOn: ['A'] },
      ];

      const state = buildDependencyGraph(tasks);

      // First batch: only A is ready
      let ready = getReadyTasks(state);
      expect(ready.map((t) => t.taskId)).toEqual(['A']);

      // Complete A
      completeTask(state, 'A', 'result A');

      // Second batch: B and C are ready
      ready = getReadyTasks(state);
      expect(ready.map((t) => t.taskId)).toContain('B');
      expect(ready.map((t) => t.taskId)).toContain('C');
    });

    it('should not return tasks with unsatisfied dependencies', () => {
      const tasks: ParallelTaskDefinition[] = [
        { taskId: 'A', agentId: 'agent', task: 'Task A' },
        { taskId: 'B', agentId: 'agent', task: 'Task B' },
        { taskId: 'C', agentId: 'agent', task: 'Task C', dependsOn: ['A', 'B'] },
      ];

      const state = buildDependencyGraph(tasks);

      // Complete only A
      completeTask(state, 'A', 'result A');

      // C should not be ready yet (B not complete)
      const ready = getReadyTasks(state);
      expect(ready.map((t) => t.taskId)).toContain('B');
      expect(ready.map((t) => t.taskId)).not.toContain('C');
    });
  });

  describe('completeTask', () => {
    it('should mark task as completed and store result', () => {
      const tasks: ParallelTaskDefinition[] = [{ taskId: 'A', agentId: 'agent', task: 'Task A' }];

      const state = buildDependencyGraph(tasks);
      completeTask(state, 'A', 'result from A');

      expect(state.nodes.get('A')?.status).toBe('completed');
      expect(state.nodes.get('A')?.result).toBe('result from A');
      expect(getTaskOutput(state, 'A')).toBe('result from A');
      expect(state.completedTasks.has('A')).toBe(true);
    });

    it('should make dependent tasks ready', () => {
      const tasks: ParallelTaskDefinition[] = [
        { taskId: 'A', agentId: 'agent', task: 'Task A' },
        { taskId: 'B', agentId: 'agent', task: 'Task B', dependsOn: ['A'] },
      ];

      const state = buildDependencyGraph(tasks);
      completeTask(state, 'A', 'result A');

      expect(state.readyQueue).toContain('B');
    });
  });

  describe('failTask', () => {
    it('should mark task as failed', () => {
      const tasks: ParallelTaskDefinition[] = [{ taskId: 'A', agentId: 'agent', task: 'Task A' }];

      const state = buildDependencyGraph(tasks);
      failTask(state, 'A', 'Task A failed');

      expect(state.nodes.get('A')?.status).toBe('failed');
      expect(state.nodes.get('A')?.error).toBe('Task A failed');
      expect(state.failedTasks.has('A')).toBe(true);
    });

    it('should cascade failure to dependents', () => {
      const tasks: ParallelTaskDefinition[] = [
        { taskId: 'A', agentId: 'agent', task: 'Task A' },
        { taskId: 'B', agentId: 'agent', task: 'Task B', dependsOn: ['A'] },
        { taskId: 'C', agentId: 'agent', task: 'Task C', dependsOn: ['B'] },
      ];

      const state = buildDependencyGraph(tasks);
      failTask(state, 'A', 'Task A failed');

      expect(state.nodes.get('B')?.status).toBe('failed');
      expect(state.nodes.get('C')?.status).toBe('failed');
      expect(state.failedTasks.has('B')).toBe(true);
      expect(state.failedTasks.has('C')).toBe(true);
    });
  });

  describe('isExecutionComplete', () => {
    it('should return true when all tasks are completed', () => {
      const tasks: ParallelTaskDefinition[] = [
        { taskId: 'A', agentId: 'agent', task: 'Task A' },
        { taskId: 'B', agentId: 'agent', task: 'Task B', dependsOn: ['A'] },
      ];

      const state = buildDependencyGraph(tasks);
      completeTask(state, 'A', 'result A');
      completeTask(state, 'B', 'result B');

      expect(isExecutionComplete(state)).toBe(true);
    });

    it('should return false when tasks are pending', () => {
      const tasks: ParallelTaskDefinition[] = [
        { taskId: 'A', agentId: 'agent', task: 'Task A' },
        { taskId: 'B', agentId: 'agent', task: 'Task B', dependsOn: ['A'] },
      ];

      const state = buildDependencyGraph(tasks);
      completeTask(state, 'A', 'result A');

      expect(isExecutionComplete(state)).toBe(false);
    });

    it('should return true when all tasks are completed or failed', () => {
      const tasks: ParallelTaskDefinition[] = [
        { taskId: 'A', agentId: 'agent', task: 'Task A' },
        { taskId: 'B', agentId: 'agent', task: 'Task B', dependsOn: ['A'] },
      ];

      const state = buildDependencyGraph(tasks);
      completeTask(state, 'A', 'result A');
      failTask(state, 'B', 'Task B failed');

      expect(isExecutionComplete(state)).toBe(true);
    });
  });

  describe('getExecutionSummary', () => {
    it('should return correct counts', () => {
      const tasks: ParallelTaskDefinition[] = [
        { taskId: 'A', agentId: 'agent', task: 'Task A' },
        { taskId: 'B', agentId: 'agent', task: 'Task B', dependsOn: ['A'] },
        { taskId: 'C', agentId: 'agent', task: 'Task C', dependsOn: ['A'] },
      ];

      const state = buildDependencyGraph(tasks);
      completeTask(state, 'A', 'result A');
      failTask(state, 'B', 'Task B failed');
      // C is still pending

      const summary = getExecutionSummary(state);

      expect(summary.total).toBe(3);
      expect(summary.completed).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.pending).toBe(0);
      expect(summary.ready).toBe(1);
    });
  });

  describe('createTaskWithDependencyContext', () => {
    it('should enrich task with dependency outputs', () => {
      const task: ParallelTaskDefinition = {
        taskId: 'B',
        agentId: 'agent',
        task: 'Process data',
        dependsOn: ['A'],
      };

      const outputs = new Map<string, unknown>();
      outputs.set('A', { data: 'result from A' });

      const enrichedTask = createTaskWithDependencyContext(task, outputs);

      expect(enrichedTask).toContain('Process data');
      expect(enrichedTask).toContain('DEPENDENCY CONTEXT');
      expect(enrichedTask).toContain('Output from A');
      expect(enrichedTask).toContain('result from A');
    });

    it('should return original task if no dependencies', () => {
      const task: ParallelTaskDefinition = {
        taskId: 'A',
        agentId: 'agent',
        task: 'Do something',
      };

      const outputs = new Map<string, unknown>();
      const enrichedTask = createTaskWithDependencyContext(task, outputs);

      expect(enrichedTask).toBe('Do something');
    });
  });

  describe('Complex DAG scenarios', () => {
    it('should handle multi-level pipeline', () => {
      const tasks: ParallelTaskDefinition[] = [
        { taskId: 'fetch', agentId: 'agent', task: 'Fetch data' },
        { taskId: 'validate', agentId: 'agent', task: 'Validate data', dependsOn: ['fetch'] },
        { taskId: 'transform', agentId: 'agent', task: 'Transform data', dependsOn: ['validate'] },
        { taskId: 'store', agentId: 'agent', task: 'Store data', dependsOn: ['transform'] },
      ];

      const state = buildDependencyGraph(tasks);

      // Execute in order
      let ready = getReadyTasks(state);
      expect(ready.map((t) => t.taskId)).toEqual(['fetch']);

      completeTask(state, 'fetch', 'fetched data');
      ready = getReadyTasks(state);
      expect(ready.map((t) => t.taskId)).toEqual(['validate']);

      completeTask(state, 'validate', 'validated data');
      ready = getReadyTasks(state);
      expect(ready.map((t) => t.taskId)).toEqual(['transform']);

      completeTask(state, 'transform', 'transformed data');
      ready = getReadyTasks(state);
      expect(ready.map((t) => t.taskId)).toEqual(['store']);

      completeTask(state, 'store', 'stored data');
      expect(isExecutionComplete(state)).toBe(true);
    });

    it('should handle parallel fan-out and fan-in', () => {
      const tasks: ParallelTaskDefinition[] = [
        { taskId: 'split', agentId: 'agent', task: 'Split work' },
        { taskId: 'worker1', agentId: 'agent', task: 'Worker 1', dependsOn: ['split'] },
        { taskId: 'worker2', agentId: 'agent', task: 'Worker 2', dependsOn: ['split'] },
        { taskId: 'worker3', agentId: 'agent', task: 'Worker 3', dependsOn: ['split'] },
        {
          taskId: 'merge',
          agentId: 'agent',
          task: 'Merge results',
          dependsOn: ['worker1', 'worker2', 'worker3'],
        },
      ];

      const state = buildDependencyGraph(tasks);

      // Split is ready
      let ready = getReadyTasks(state);
      expect(ready.map((t) => t.taskId)).toEqual(['split']);

      completeTask(state, 'split', 'split result');

      // All workers are ready
      ready = getReadyTasks(state);
      expect(ready.map((t) => t.taskId)).toContain('worker1');
      expect(ready.map((t) => t.taskId)).toContain('worker2');
      expect(ready.map((t) => t.taskId)).toContain('worker3');

      completeTask(state, 'worker1', 'worker1 result');
      completeTask(state, 'worker2', 'worker2 result');

      // Merge not ready yet (worker3 still running from previous getReadyTasks call)
      ready = getReadyTasks(state);
      expect(ready.map((t) => t.taskId)).not.toContain('worker3');
      expect(ready.map((t) => t.taskId)).not.toContain('merge');

      completeTask(state, 'worker3', 'worker3 result');

      // Now merge is ready
      ready = getReadyTasks(state);
      expect(ready.map((t) => t.taskId)).toEqual(['merge']);
    });
  });
});
