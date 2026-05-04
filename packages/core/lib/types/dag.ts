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
  nodes: Record<string, TaskNode>;
  readyQueue: string[];
  completedTasks: string[];
  failedTasks: string[];
  outputs: Record<string, unknown>;
}
