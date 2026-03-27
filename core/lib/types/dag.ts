import { ParallelTaskDefinition } from '../agent/schema';

export interface TaskNode {
  task: ParallelTaskDefinition;
  dependencies: string[];
  dependents: string[];
  status: 'pending' | 'ready' | 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
  completedAt?: number;
}

export interface DAGExecutionState {
  nodes: Map<string, TaskNode>;
  readyQueue: string[];
  completedTasks: Set<string>;
  failedTasks: Set<string>;
  outputs: Map<string, unknown>;
}
