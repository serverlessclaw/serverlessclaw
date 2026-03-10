export interface IAgentConfig {
  id: string;
  name: string;
  systemPrompt: string;
  model?: string;
  tools?: string[]; // Names of tools this agent can use
  enabled: boolean;
  isBackbone?: boolean;
}

export enum AgentType {
  MAIN = 'main',
  CODER = 'coder',
  BUILD_MONITOR = 'monitor',
  EVENT_HANDLER = 'events',
  RECOVERY = 'recovery',
  PLANNER = 'planner',
  REFLECTOR = 'reflector',
}

export enum EventType {
  CODER_TASK = 'coder_task',
  SYSTEM_BUILD_FAILED = 'system_build_failed',
  MONITOR_BUILD = 'monitor_build',
  RECOVERY_LOG = 'recovery_log',
  EVOLUTION_PLAN = 'evolution_plan',
  REFLECT_TASK = 'reflect_task',
  OUTBOUND_MESSAGE = 'outbound_message',
}

export enum EvolutionMode {
  AUTO = 'auto',
  HITL = 'hitl',
}

export interface ITool {
  name: string;
  description: string;
  parameters: unknown;
  execute(args: Record<string, unknown>): Promise<string>;
}

export interface IChannel {
  send(userId: string, text: string): Promise<void>;
}
