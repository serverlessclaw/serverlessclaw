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
  PLANNER = 'planner',
  REFLECTOR = 'reflector',
}

/**
 * Event Detail Types for the AgentBus.
 */
export enum EventType {
  CODER_TASK = 'coder_task',
  SYSTEM_BUILD_FAILED = 'system_build_failed',
  MONITOR_BUILD = 'monitor_build',
  RECOVERY_LOG = 'recovery_log',
  EVOLUTION_PLAN = 'evolution_plan',
  REFLECT_TASK = 'reflect_task',
  OUTBOUND_MESSAGE = 'outbound_message',
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
 * Insight Categories for memory and evolution.
 */
export enum InsightCategory {
  USER_PREFERENCE = 'user_preference',
  TACTICAL_LESSON = 'tactical_lesson',
  STRATEGIC_GAP = 'strategic_gap',
  SYSTEM_KNOWLEDGE = 'system_knowledge',
}

/**
 * Metadata for insights (Facts, Lessons, Gaps).
 */
export interface InsightMetadata {
  category: InsightCategory;
  confidence: number; // 1-10
  impact: number; // 1-10
  complexity: number; // 1-10
  risk: number; // 1-10
  urgency: number; // 1-10
  priority: number; // 1-10 (Normalized overall priority)
  expiration?: number; // timestamp
}

/**
 * Structured memory item.
 */
export interface MemoryInsight {
  id: string;
  content: string;
  metadata: InsightMetadata;
  timestamp: number;
}

/**
 * Memory Adapter interface for persistent state.
 */
export interface IMemory {
  getHistory(userId: string): Promise<Message[]>;
  addMessage(userId: string, message: Message): Promise<void>;
  clearHistory(userId: string): Promise<void>;

  // Facts (Long-term)
  getDistilledMemory(userId: string): Promise<string>;
  updateDistilledMemory(userId: string, facts: string): Promise<void>;

  // Gaps & Evolution
  setGap(gapId: string, details: string, metadata?: InsightMetadata): Promise<void>;

  // Lessons (Tactical)
  addLesson(userId: string, lesson: string, metadata?: InsightMetadata): Promise<void>;
  getLessons(userId: string): Promise<string[]>;

  // Smart Recall (Search)
  searchInsights(
    userId: string,
    query: string,
    category?: InsightCategory
  ): Promise<MemoryInsight[]>;
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

/**
 * SST Resource types for better safety.
 */
export interface SSTResource {
  AgentBus: { name: string };
  TelegramBotToken: { value: string };
}
