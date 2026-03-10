export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
  TOOL = 'tool',
  DEVELOPER = 'developer',
}

export interface Message {
  role: MessageRole;
  content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

/**
 * Agent Types for orchestration.
 */
export enum AgentType {
  MAIN = 'main',
  CODER = 'coder',
  BUILD_MONITOR = 'monitor',
  EVENT_HANDLER = 'events',
  RECOVERY = 'recovery',
}

/**
 * Event Detail Types for the AgentBus.
 */
export enum EventType {
  CODER_TASK = 'coder_task',
  SYSTEM_BUILD_FAILED = 'system_build_failed',
  MONITOR_BUILD = 'monitor_build',
  RECOVERY_LOG = 'recovery_log',
}

/**
 * reasoning profiles for LLM providers.
 */
export enum ReasoningProfile {
  FAST = 'fast',
  STANDARD = 'standard',
  THINKING = 'thinking',
  DEEP = 'deep',
}

/**
 * Provider interface for LLM backends.
 */
export enum LLMProvider {
  OPENAI = 'openai',
  BEDROCK = 'bedrock',
  OPENROUTER = 'openrouter',
}

/**
 * Standardized Model IDs for OpenAI.
 */
export enum OpenAIModel {
  GPT_5_4 = 'gpt-5.4',
  GPT_5_MINI = 'gpt-5-mini',
}

/**
 * Standardized Model IDs for Bedrock.
 */
export enum BedrockModel {
  CLAUDE_4_6 = 'global.anthropic.claude-sonnet-4-6',
}

/**
 * Standardized Model IDs for OpenRouter.
 */
export enum OpenRouterModel {
  GLM_5 = 'zhipu/glm-5',
  MINIMAX_2_5 = 'minimax/minimax-2.5',
  GEMINI_3_FLASH = 'google/gemini-3-flash-preview',
}

/**
 * Memory Adapter interface for persistent state.
 */
export interface IMemory {
  getHistory(userId: string): Promise<Message[]>;
  addMessage(userId: string, message: Message): Promise<void>;
  clearHistory(userId: string): Promise<void>;
  getDistilledMemory(userId: string): Promise<string>;
  updateDistilledMemory(userId: string, facts: string): Promise<void>;
}

/**
 * Tool interface for agent capabilities.
 */
export interface ITool {
  name: string;
  description: string;
  parameters: unknown;
  execute(args: Record<string, unknown>): Promise<string>;
}

/**
 * Channel Adapter for different messaging platforms (Telegram, Discord, etc.)
 */
export interface IChannel {
  send(userId: string, text: string): Promise<void>;
}

/**
 * Provider capabilities.
 */
export interface ICapabilities {
  supportedReasoningProfiles: ReasoningProfile[];
}

export interface IProvider {
  call(messages: Message[], tools?: ITool[], profile?: ReasoningProfile): Promise<Message>;
  getCapabilities(): Promise<ICapabilities>;
}

/**
 * Lock Manager for session isolation.
 */
export interface ILockManager {
  acquire(lockId: string, ttlSeconds: number): Promise<boolean>;
  release(lockId: string): Promise<void>;
}

/**
 * Lock Manager for session isolation.
 */
export interface ILockManager {
  acquire(lockId: string, ttlSeconds: number): Promise<boolean>;
  release(lockId: string): Promise<void>;
}
