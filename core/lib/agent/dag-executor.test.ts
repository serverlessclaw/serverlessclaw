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
import type { ParallelTaskDefinition } from './schema';

/**
 * Helper to create a simple task definition
 */
function makeTask(
  taskId: string,
  agentId: string = 'coder',
  dependsOn: string[] = []
): ParallelTaskDefinition {
  return {
    taskId,
    agentId,
    task: `Task ${taskId}`,
    dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
  };
}

describe('dag-executor', () => {
  describe('buildDependencyGraph', () => {
    it('should create nodes for all tasks', () => {
      const tasks = [makeTask('a'), makeTask('b'), makeTask('c')];
      const state = buildDependencyGraph(tasks);

      expect(Object.keys(state.nodes)).toHaveLength(3);
      expect(state.nodes['a']).toBeDefined();
      expect(state.nodes['b']).toBeDefined();
      expect(state.nodes['c']).toBeDefined();
    });

    it('should mark tasks with no dependencies as ready', () => {
      const tasks = [makeTask('a'), makeTask('b', 'coder', ['a'])];
      const state = buildDependencyGraph(tasks);

      expect(state.readyQueue).toContain('a');
      expect(state.readyQueue).not.toContain('b');
      expect(state.nodes['a'].status).toBe('ready');
      expect(state.nodes['b'].status).toBe('pending');
    });

    it('should build correct dependency relationships', () => {
      const tasks = [makeTask('a'), makeTask('b', 'coder', ['a']), makeTask('c', 'coder', ['a'])];
      const state = buildDependencyGraph(tasks);

      // a should have b and c as dependents
      expect(state.nodes['a'].dependents).toContain('b');
      expect(state.nodes['a'].dependents).toContain('c');

      // b and c should depend on a
      expect(state.nodes['b'].dependencies).toEqual(['a']);
      expect(state.nodes['c'].dependencies).toEqual(['a']);
    });

    it('should handle chain dependencies (a → b → c)', () => {
      const tasks = [makeTask('a'), makeTask('b', 'coder', ['a']), makeTask('c', 'coder', ['b'])];
      const state = buildDependencyGraph(tasks);

      expect(state.readyQueue).toEqual(['a']);
      expect(state.nodes['b'].dependencies).toEqual(['a']);
      expect(state.nodes['c'].dependencies).toEqual(['b']);
      expect(state.nodes['a'].dependents).toContain('b');
      expect(state.nodes['b'].dependents).toContain('c');
    });

    it('should handle diamond dependencies (a → b,c → d)', () => {
      const tasks = [
        makeTask('a'),
        makeTask('b', 'coder', ['a']),
        makeTask('c', 'coder', ['a']),
        makeTask('d', 'coder', ['b', 'c']),
      ];
      const state = buildDependencyGraph(tasks);

      expect(state.readyQueue).toEqual(['a']);
      expect(state.nodes['d'].dependencies).toEqual(['b', 'c']);
      expect(state.nodes['a'].dependents).toContain('b');
      expect(state.nodes['a'].dependents).toContain('c');
    });

    it('should warn about non-existent dependencies', () => {
      const tasks = [makeTask('a', 'coder', ['nonexistent'])];
      const state = buildDependencyGraph(tasks);

      // Task should still be created but with the bad dependency
      expect(state.nodes['a']).toBeDefined();
      expect(state.nodes['a'].dependencies).toEqual(['nonexistent']);
      // No dependents added to nonexistent node
    });

    it('should initialize empty outputs and task lists', () => {
      const tasks = [makeTask('a')];
      const state = buildDependencyGraph(tasks);

      expect(state.completedTasks).toEqual([]);
      expect(state.failedTasks).toEqual([]);
      expect(state.outputs).toEqual({});
    });
  });

  describe('validateDependencyGraph', () => {
    it('should return true for valid graph (no cycles)', () => {
      const tasks = [makeTask('a'), makeTask('b', 'coder', ['a']), makeTask('c', 'coder', ['b'])];
      const state = buildDependencyGraph(tasks);

      expect(validateDependencyGraph(state)).toBe(true);
    });

    it('should return true for diamond graph', () => {
      const tasks = [
        makeTask('a'),
        makeTask('b', 'coder', ['a']),
        makeTask('c', 'coder', ['a']),
        makeTask('d', 'coder', ['b', 'c']),
      ];
      const state = buildDependencyGraph(tasks);

      expect(validateDependencyGraph(state)).toBe(true);
    });

    it('should return false for direct cycle (a → b → a)', () => {
      const tasks = [makeTask('a', 'coder', ['b']), makeTask('b', 'coder', ['a'])];
      const state = buildDependencyGraph(tasks);

      expect(validateDependencyGraph(state)).toBe(false);
    });

    it('should return false for indirect cycle (a → b → c → a)', () => {
      const tasks = [
        makeTask('a', 'coder', ['c']),
        makeTask('b', 'coder', ['a']),
        makeTask('c', 'coder', ['b']),
      ];
      const state = buildDependencyGraph(tasks);

      expect(validateDependencyGraph(state)).toBe(false);
    });

    it('should return true for empty graph', () => {
      const state = buildDependencyGraph([]);

      expect(validateDependencyGraph(state)).toBe(true);
    });

    it('should return true for single node with no dependencies', () => {
      const state = buildDependencyGraph([makeTask('a')]);

      expect(validateDependencyGraph(state)).toBe(true);
    });

    it('should return true for self-referencing dependency (a → a)', () => {
      // Self-reference should be caught as a cycle
      const tasks = [makeTask('a', 'coder', ['a'])];
      const state = buildDependencyGraph(tasks);

      expect(validateDependencyGraph(state)).toBe(false);
    });
  });

  describe('getReadyTasks', () => {
    it('should return tasks with no dependencies initially', () => {
      const tasks = [makeTask('a'), makeTask('b'), makeTask('c', 'coder', ['a'])];
      const state = buildDependencyGraph(tasks);

      const ready = getReadyTasks(state);

      expect(ready).toHaveLength(2);
      expect(ready.map((t) => t.taskId)).toContain('a');
      expect(ready.map((t) => t.taskId)).toContain('b');
    });

    it('should return empty when no tasks are ready', () => {
      const tasks = [makeTask('a', 'coder', ['b']), makeTask('b', 'coder', ['a'])];
      // Note: this is a cycle but we're testing getReadyTasks behavior
      const state = buildDependencyGraph(tasks);

      const ready = getReadyTasks(state);

      // Both have dependencies that aren't completed
      expect(ready).toHaveLength(0);
    });

    it('should mark returned tasks as running', () => {
      const tasks = [makeTask('a'), makeTask('b')];
      const state = buildDependencyGraph(tasks);

      getReadyTasks(state);

      expect(state.nodes['a'].status).toBe('running');
      expect(state.nodes['b'].status).toBe('running');
    });

    it('should not return already running or completed tasks', () => {
      const tasks = [makeTask('a'), makeTask('b')];
      const state = buildDependencyGraph(tasks);

      // First call returns both
      const first = getReadyTasks(state);
      expect(first).toHaveLength(2);

      // Second call returns nothing (both are running)
      const second = getReadyTasks(state);
      expect(second).toHaveLength(0);
    });

    it('should return dependent tasks after dependency completes', () => {
      const tasks = [makeTask('a'), makeTask('b', 'coder', ['a'])];
      const state = buildDependencyGraph(tasks);

      // Initially only 'a' is ready
      const initial = getReadyTasks(state);
      expect(initial).toHaveLength(1);
      expect(initial[0].taskId).toBe('a');

      // Complete 'a'
      completeTask(state, 'a', 'result-a');

      // Now 'b' should be ready
      const after = getReadyTasks(state);
      expect(after).toHaveLength(1);
      expect(after[0].taskId).toBe('b');
    });

    it('should handle diamond dependency resolution', () => {
      const tasks = [
        makeTask('a'),
        makeTask('b', 'coder', ['a']),
        makeTask('c', 'coder', ['a']),
        makeTask('d', 'coder', ['b', 'c']),
      ];
      const state = buildDependencyGraph(tasks);

      // Initially only 'a' is ready
      let ready = getReadyTasks(state);
      expect(ready).toHaveLength(1);

      // Complete 'a' → 'b' and 'c' become ready
      completeTask(state, 'a', 'done');
      ready = getReadyTasks(state);
      expect(ready).toHaveLength(2);
      expect(ready.map((t) => t.taskId)).toContain('b');
      expect(ready.map((t) => t.taskId)).toContain('c');

      // Complete 'b' → 'd' still waiting for 'c'
      completeTask(state, 'b', 'done');
      ready = getReadyTasks(state);
      expect(ready).toHaveLength(0);

      // Complete 'c' → 'd' becomes ready
      completeTask(state, 'c', 'done');
      ready = getReadyTasks(state);
      expect(ready).toHaveLength(1);
      expect(ready[0].taskId).toBe('d');
    });
  });

  describe('completeTask', () => {
    it('should mark task as completed and record output', () => {
      const tasks = [makeTask('a')];
      const state = buildDependencyGraph(tasks);

      completeTask(state, 'a', { data: 'result' });

      expect(state.nodes['a'].status).toBe('completed');
      expect(state.nodes['a'].result).toEqual({ data: 'result' });
      expect(state.outputs['a']).toEqual({ data: 'result' });
      expect(state.completedTasks).toContain('a');
    });

    it('should set completedAt timestamp', () => {
      const tasks = [makeTask('a')];
      const state = buildDependencyGraph(tasks);
      const before = Date.now();

      completeTask(state, 'a', 'done');

      expect(state.nodes['a'].completedAt).toBeGreaterThanOrEqual(before);
    });

    it('should make dependent tasks ready when all deps complete', () => {
      const tasks = [makeTask('a'), makeTask('b', 'coder', ['a']), makeTask('c', 'coder', ['a'])];
      const state = buildDependencyGraph(tasks);

      completeTask(state, 'a', 'done');

      // b and c should now be in ready queue
      expect(state.readyQueue).toContain('b');
      expect(state.readyQueue).toContain('c');
      expect(state.nodes['b'].status).toBe('ready');
      expect(state.nodes['c'].status).toBe('ready');
    });

    it('should not make task ready if not all dependencies complete', () => {
      const tasks = [makeTask('a'), makeTask('b'), makeTask('c', 'coder', ['a', 'b'])];
      const state = buildDependencyGraph(tasks);

      // Complete only 'a'
      completeTask(state, 'a', 'done');

      // 'c' should not be ready (still waiting for 'b')
      expect(state.nodes['c'].status).toBe('pending');
      expect(state.readyQueue).not.toContain('c');
    });

    it('should handle non-existent task gracefully', () => {
      const tasks = [makeTask('a')];
      const state = buildDependencyGraph(tasks);

      // Should not throw
      expect(() => completeTask(state, 'nonexistent', 'done')).not.toThrow();
    });

    it('should not duplicate completed task in list', () => {
      const tasks = [makeTask('a')];
      const state = buildDependencyGraph(tasks);

      completeTask(state, 'a', 'done');
      completeTask(state, 'a', 'done-again');

      const count = state.completedTasks.filter((id) => id === 'a').length;
      expect(count).toBe(1);
    });
  });

  describe('failTask', () => {
    it('should mark task as failed', () => {
      const tasks = [makeTask('a')];
      const state = buildDependencyGraph(tasks);

      failTask(state, 'a', 'Something went wrong');

      expect(state.nodes['a'].status).toBe('failed');
      expect(state.nodes['a'].error).toBe('Something went wrong');
      expect(state.failedTasks).toContain('a');
    });

    it('should cascade failure to all dependents', () => {
      const tasks = [makeTask('a'), makeTask('b', 'coder', ['a']), makeTask('c', 'coder', ['a'])];
      const state = buildDependencyGraph(tasks);

      failTask(state, 'a', 'Root failure');

      expect(state.nodes['b'].status).toBe('failed');
      expect(state.nodes['c'].status).toBe('failed');
      expect(state.failedTasks).toContain('b');
      expect(state.failedTasks).toContain('c');
    });

    it('should cascade failure through chain dependencies', () => {
      const tasks = [
        makeTask('a'),
        makeTask('b', 'coder', ['a']),
        makeTask('c', 'coder', ['b']),
        makeTask('d', 'coder', ['c']),
      ];
      const state = buildDependencyGraph(tasks);

      failTask(state, 'a', 'Root failure');

      expect(state.nodes['b'].status).toBe('failed');
      expect(state.nodes['c'].status).toBe('failed');
      expect(state.nodes['d'].status).toBe('failed');
    });

    it('should not fail already completed or ready tasks', () => {
      const tasks = [makeTask('a'), makeTask('b', 'coder', ['a']), makeTask('c', 'coder', ['b'])];
      const state = buildDependencyGraph(tasks);

      // Complete 'a' and 'b' (c becomes ready but not completed)
      completeTask(state, 'a', 'done');
      completeTask(state, 'b', 'done');

      // Now fail 'a' - should not cascade to completed 'b' or ready 'c'
      failTask(state, 'a', 'Late failure');

      // 'b' was already completed, so it should stay completed
      expect(state.nodes['b'].status).toBe('completed');
      // 'c' was ready (not pending), so it should not be failed by cascade
      expect(state.nodes['c'].status).toBe('ready');
    });

    it('should handle non-existent task gracefully', () => {
      const tasks = [makeTask('a')];
      const state = buildDependencyGraph(tasks);

      expect(() => failTask(state, 'nonexistent', 'error')).not.toThrow();
    });

    it('should set dependency failure message on cascaded tasks', () => {
      const tasks = [makeTask('a'), makeTask('b', 'coder', ['a'])];
      const state = buildDependencyGraph(tasks);

      failTask(state, 'a', 'Root cause');

      expect(state.nodes['b'].error).toContain('Dependency a failed');
    });

    it('should not duplicate failed task in list', () => {
      const tasks = [makeTask('a')];
      const state = buildDependencyGraph(tasks);

      failTask(state, 'a', 'error');
      failTask(state, 'a', 'error-again');

      const count = state.failedTasks.filter((id) => id === 'a').length;
      expect(count).toBe(1);
    });
  });

  describe('getTaskOutput', () => {
    it('should return output for completed task', () => {
      const tasks = [makeTask('a')];
      const state = buildDependencyGraph(tasks);

      completeTask(state, 'a', { data: 'result' });

      expect(getTaskOutput(state, 'a')).toEqual({ data: 'result' });
    });

    it('should return undefined for pending task', () => {
      const tasks = [makeTask('a')];
      const state = buildDependencyGraph(tasks);

      expect(getTaskOutput(state, 'a')).toBeUndefined();
    });

    it('should return undefined for non-existent task', () => {
      const tasks = [makeTask('a')];
      const state = buildDependencyGraph(tasks);

      expect(getTaskOutput(state, 'nonexistent')).toBeUndefined();
    });
  });

  describe('isExecutionComplete', () => {
    it('should return false when tasks are pending', () => {
      const tasks = [makeTask('a'), makeTask('b')];
      const state = buildDependencyGraph(tasks);

      expect(isExecutionComplete(state)).toBe(false);
    });

    it('should return false when tasks are running', () => {
      const tasks = [makeTask('a')];
      const state = buildDependencyGraph(tasks);
      getReadyTasks(state); // marks as running

      expect(isExecutionComplete(state)).toBe(false);
    });

    it('should return false when tasks are ready', () => {
      const tasks = [makeTask('a')];
      const state = buildDependencyGraph(tasks);
      // 'a' is in ready queue

      expect(isExecutionComplete(state)).toBe(false);
    });

    it('should return true when all tasks completed', () => {
      const tasks = [makeTask('a'), makeTask('b')];
      const state = buildDependencyGraph(tasks);

      completeTask(state, 'a', 'done');
      completeTask(state, 'b', 'done');

      expect(isExecutionComplete(state)).toBe(true);
    });

    it('should return true when all tasks failed', () => {
      const tasks = [makeTask('a'), makeTask('b')];
      const state = buildDependencyGraph(tasks);

      failTask(state, 'a', 'error');
      failTask(state, 'b', 'error');

      expect(isExecutionComplete(state)).toBe(true);
    });

    it('should return true when mix of completed and failed', () => {
      const tasks = [makeTask('a'), makeTask('b')];
      const state = buildDependencyGraph(tasks);

      completeTask(state, 'a', 'done');
      failTask(state, 'b', 'error');

      expect(isExecutionComplete(state)).toBe(true);
    });

    it('should return true for empty graph', () => {
      const state = buildDependencyGraph([]);

      expect(isExecutionComplete(state)).toBe(true);
    });
  });

  describe('getExecutionSummary', () => {
    it('should return correct counts for initial state', () => {
      const tasks = [makeTask('a'), makeTask('b'), makeTask('c')];
      const state = buildDependencyGraph(tasks);

      const summary = getExecutionSummary(state);

      expect(summary.total).toBe(3);
      // 'a', 'b', 'c' are all in readyQueue (no deps)
      expect(summary.ready).toBe(3);
      expect(summary.completed).toBe(0);
      expect(summary.failed).toBe(0);
      expect(summary.pending).toBe(0);
    });

    it('should return correct counts after some completions', () => {
      const tasks = [makeTask('a'), makeTask('b', 'coder', ['a']), makeTask('c', 'coder', ['a'])];
      const state = buildDependencyGraph(tasks);

      // Complete 'a'
      completeTask(state, 'a', 'done');
      // 'b' and 'c' are now in readyQueue

      const summary = getExecutionSummary(state);

      expect(summary.total).toBe(3);
      expect(summary.completed).toBe(1);
      expect(summary.ready).toBe(2);
    });

    it('should return correct counts after failures', () => {
      const tasks = [makeTask('a'), makeTask('b')];
      const state = buildDependencyGraph(tasks);

      completeTask(state, 'a', 'done');
      failTask(state, 'b', 'error');

      const summary = getExecutionSummary(state);

      expect(summary.total).toBe(2);
      expect(summary.completed).toBe(1);
      expect(summary.failed).toBe(1);
    });

    it('should count running tasks as ready', () => {
      const tasks = [makeTask('a')];
      const state = buildDependencyGraph(tasks);
      getReadyTasks(state); // marks as running

      const summary = getExecutionSummary(state);

      expect(summary.ready).toBe(1); // running is counted as ready
    });
  });

  describe('createTaskWithDependencyContext', () => {
    it('should return original task when no dependencies', () => {
      const task = makeTask('a');
      const result = createTaskWithDependencyContext(task, {});

      expect(result).toBe(task.task);
    });

    it('should enrich task with dependency outputs', () => {
      const task = makeTask('b', 'coder', ['a']);
      const outputs = { a: 'result from a' };

      const result = createTaskWithDependencyContext(task, outputs);

      expect(result).toContain(task.task);
      expect(result).toContain('[DEPENDENCY CONTEXT]');
      expect(result).toContain('Output from a');
      expect(result).toContain('result from a');
    });

    it('should include multiple dependency outputs', () => {
      const task = makeTask('d', 'coder', ['b', 'c']);
      const outputs = {
        b: 'result from b',
        c: { data: 'structured result from c' },
      };

      const result = createTaskWithDependencyContext(task, outputs);

      expect(result).toContain('Output from b');
      expect(result).toContain('result from b');
      expect(result).toContain('Output from c');
      expect(result).toContain('"data": "structured result from c"');
    });

    it('should skip missing dependency outputs', () => {
      const task = makeTask('b', 'coder', ['a']);
      const outputs = {}; // 'a' output not available

      const result = createTaskWithDependencyContext(task, outputs);

      expect(result).toContain(task.task);
      expect(result).toContain('[DEPENDENCY CONTEXT]');
      // Should not contain "Output from a" since it's not in outputs
      expect(result).not.toContain('Output from a');
    });

    it('should handle empty dependsOn array', () => {
      const task: ParallelTaskDefinition = {
        taskId: 'a',
        agentId: 'coder',
        task: 'Do something',
        dependsOn: [],
      };

      const result = createTaskWithDependencyContext(task, {});

      expect(result).toBe(task.task);
    });
  });
});
