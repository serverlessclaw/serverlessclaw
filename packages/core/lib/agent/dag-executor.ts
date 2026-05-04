/**
 * DAG Executor for Task Dependency Resolution
 * Handles execution of tasks with dependencies using topological sorting
 */

import { logger } from '../logger';
import { ParallelTaskDefinition } from './schema';
import { TaskNode, DAGExecutionState } from '../types/dag';

/**
 * Builds a dependency graph from task definitions
 */
export function buildDependencyGraph(tasks: ParallelTaskDefinition[]): DAGExecutionState {
  const nodes: Record<string, TaskNode> = {};
  const readyQueue: string[] = [];

  // Create nodes for all tasks
  for (const task of tasks) {
    nodes[task.taskId] = {
      task,
      dependencies: task.dependsOn ?? [],
      dependents: [],
      status: 'pending',
    };
  }

  // Build dependency relationships
  for (const [taskId, node] of Object.entries(nodes)) {
    for (const depId of node.dependencies) {
      const depNode = nodes[depId];
      if (depNode) {
        depNode.dependents.push(taskId);
      } else {
        logger.warn(`Task ${taskId} depends on non-existent task ${depId}`);
      }
    }
  }

  // Find tasks with no dependencies (ready to run)
  for (const [taskId, node] of Object.entries(nodes)) {
    if (node.dependencies.length === 0) {
      node.status = 'ready';
      readyQueue.push(taskId);
    }
  }

  return {
    nodes,
    readyQueue,
    completedTasks: [],
    failedTasks: [],
    outputs: {},
  };
}

/**
 * Validates the dependency graph for cycles
 * Returns true if valid (no cycles), false otherwise
 */
export function validateDependencyGraph(state: DAGExecutionState): boolean {
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function hasCycle(taskId: string): boolean {
    if (visiting.has(taskId)) return true;
    if (visited.has(taskId)) return false;

    visiting.add(taskId);
    const node = state.nodes[taskId];
    if (node) {
      for (const depId of node.dependencies) {
        if (hasCycle(depId)) return true;
      }
    }
    visiting.delete(taskId);
    visited.add(taskId);
    return false;
  }

  for (const taskId of Object.keys(state.nodes)) {
    if (hasCycle(taskId)) {
      logger.error(`Dependency cycle detected involving task ${taskId}`);
      return false;
    }
  }

  return true;
}

/**
 * Gets the next batch of tasks that are ready to execute
 */
export function getReadyTasks(state: DAGExecutionState): ParallelTaskDefinition[] {
  const ready: ParallelTaskDefinition[] = [];

  // Check all pending tasks to see if their dependencies are satisfied
  for (const [taskId, node] of Object.entries(state.nodes)) {
    if (node.status !== 'pending') continue;

    const allDepsCompleted = node.dependencies.every((depId) =>
      state.completedTasks.includes(depId)
    );

    if (allDepsCompleted) {
      node.status = 'ready';
      state.readyQueue.push(taskId);
    }
  }

  // Get tasks from ready queue
  while (state.readyQueue.length > 0) {
    const taskId = state.readyQueue.shift()!;
    const node = state.nodes[taskId];
    if (node && node.status === 'ready') {
      ready.push(node.task);
      node.status = 'running';
    }
  }

  return ready;
}

/**
 * Marks a task as completed with its result
 */
export function completeTask(state: DAGExecutionState, taskId: string, result: unknown): void {
  const node = state.nodes[taskId];
  if (!node) {
    logger.warn(`Cannot complete non-existent task ${taskId}`);
    return;
  }

  node.status = 'completed';
  node.result = result;
  node.completedAt = Date.now();
  if (!state.completedTasks.includes(taskId)) {
    state.completedTasks.push(taskId);
  }
  state.outputs[taskId] = result;

  // Check if any dependent tasks are now ready
  for (const dependentId of node.dependents) {
    const dependentNode = state.nodes[dependentId];
    if (dependentNode && dependentNode.status === 'pending') {
      const allDepsCompleted = dependentNode.dependencies.every((depId) =>
        state.completedTasks.includes(depId)
      );
      if (allDepsCompleted) {
        dependentNode.status = 'ready';
        state.readyQueue.push(dependentId);
      }
    }
  }

  logger.info(`Task ${taskId} completed. Dependents: ${node.dependents.join(', ')}`);
}

/**
 * Marks a task as failed
 */
export function failTask(state: DAGExecutionState, taskId: string, error: string): void {
  const node = state.nodes[taskId];
  if (!node) {
    logger.warn(`Cannot fail non-existent task ${taskId}`);
    return;
  }

  // Protection: do not downgrade a completed or already failed task
  if (node.status === 'completed' || node.status === 'failed') {
    logger.info(`Ignoring fail request for task ${taskId} (status is already ${node.status})`);
    return;
  }

  node.status = 'failed';
  node.error = error;
  if (!state.failedTasks.includes(taskId)) {
    state.failedTasks.push(taskId);
  }

  // Fail all dependent tasks recursively
  function failDependents(id: string) {
    const n = state.nodes[id];
    if (n) {
      for (const dependentId of n.dependents) {
        const dependentNode = state.nodes[dependentId];
        // Only cascade to pending tasks - ready/running/completed are protected
        if (dependentNode && dependentNode.status === 'pending') {
          dependentNode.status = 'failed';
          dependentNode.error = `Dependency ${id} failed`;
          if (!state.failedTasks.includes(dependentId)) {
            state.failedTasks.push(dependentId);
          }
          failDependents(dependentId);
        }
      }
    }
  }

  failDependents(taskId);
  logger.error(`Task ${taskId} failed: ${error}. Dependents also failed.`);
}

/**
 * Gets the output from a completed task
 */
export function getTaskOutput(state: DAGExecutionState, taskId: string): unknown {
  return state.outputs[taskId];
}

/**
 * Checks if all tasks are complete (either completed or failed)
 */
export function isExecutionComplete(state: DAGExecutionState): boolean {
  for (const node of Object.values(state.nodes)) {
    if (node.status === 'pending' || node.status === 'ready' || node.status === 'running') {
      return false;
    }
  }
  return true;
}

/**
 * Gets execution summary
 */
export function getExecutionSummary(state: DAGExecutionState): {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  ready: number;
} {
  let completed = 0;
  let failed = 0;
  let pending = 0;
  let ready = 0;

  for (const node of Object.values(state.nodes)) {
    switch (node.status) {
      case 'completed':
        completed++;
        break;
      case 'failed':
        failed++;
        break;
      case 'pending':
        pending++;
        break;
      case 'ready':
      case 'running':
        ready++;
        break;
    }
  }

  return {
    total: Object.keys(state.nodes).length,
    completed,
    failed,
    pending,
    ready,
  };
}

/**
 * Creates a task prompt with context from dependency outputs
 */
export function createTaskWithDependencyContext(
  task: ParallelTaskDefinition,
  dependencyOutputs: Record<string, unknown>
): string {
  if (!task.dependsOn || task.dependsOn.length === 0) {
    return task.task;
  }

  let enrichedTask = task.task + '\n\n[DEPENDENCY CONTEXT]:\n';

  for (const depId of task.dependsOn) {
    const output = dependencyOutputs[depId];
    if (output !== undefined) {
      enrichedTask += `\n--- Output from ${depId} ---\n`;
      enrichedTask += typeof output === 'string' ? output : JSON.stringify(output, null, 2);
      enrichedTask += '\n';
    }
  }

  return enrichedTask;
}
