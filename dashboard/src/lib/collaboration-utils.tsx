import React from 'react';
import {
  Bot,
  Code,
  Brain,
  Search,
  FlaskConical,
  Settings2,
  Loader,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
} from 'lucide-react';

export interface TaskNodeData {
  [key: string]: any;
  label: string;
  taskId: string;
  agentId: string;
  status: 'pending' | 'ready' | 'running' | 'completed' | 'failed';
  task: string;
  dependsOn?: string[];
  result?: string;
  startedAt?: number;
  completedAt?: number;
  latency?: number;
  }
export interface AgentActivity {
  agentId: string;
  agentName: string;
  activeTasks: TaskNodeData[];
  completedCount: number;
  failedCount: number;
}

export interface HandoffData {
  taskId: string;
  agentId: string;
  reason: string;
  context: string;
  timestamp: number;
}

export const getAgentIcon = (agentId: string) => {
  if (agentId === 'superclaw') return <Bot size={16} />;
  if (agentId === 'coder') return <Code size={16} />;
  if (agentId === 'strategic-planner') return <Brain size={16} />;
  if (agentId === 'cognition-reflector') return <Search size={16} />;
  if (agentId === 'qa') return <FlaskConical size={16} />;
  return <Settings2 size={16} />;
};

export const getStatusIcon = (status: string) => {
  switch (status) {
    case 'running':
      return <Loader size={12} className="animate-spin text-cyber-green" />;
    case 'completed':
      return <CheckCircle size={12} className="text-cyber-blue" />;
    case 'failed':
      return <XCircle size={12} className="text-red-500" />;
    case 'pending':
      return <Clock size={12} className="text-yellow-500" />;
    case 'ready':
      return <AlertCircle size={12} className="text-orange-500" />;
    default:
      return <Clock size={12} className="text-white/40" />;
  }
};

export const getStatusColor = (status: string) => {
  switch (status) {
    case 'running':
      return 'border-cyber-green/50 bg-cyber-green/5';
    case 'completed':
      return 'border-cyber-blue/50 bg-cyber-blue/5';
    case 'failed':
      return 'border-red-500/50 bg-red-500/5';
    case 'pending':
      return 'border-yellow-500/50 bg-yellow-500/5';
    case 'ready':
      return 'border-orange-500/50 bg-orange-500/5';
    default:
      return 'border-white/20 bg-white/5';
  }
};
