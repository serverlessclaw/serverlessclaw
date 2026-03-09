export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
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
  parameters: any;
  execute(args: any): Promise<string>;
}

/**
 * Channel Adapter for different messaging platforms (Telegram, Discord, etc.)
 */
export interface IChannel {
  send(userId: string, text: string): Promise<void>;
}

/**
 * Provider interface for LLM backends.
 */
export interface IProvider {
  call(messages: Message[], tools?: ITool[]): Promise<Message>;
}

/**
 * Lock Manager for session isolation.
 */
export interface ILockManager {
  acquire(lockId: string, ttlSeconds: number): Promise<boolean>;
  release(lockId: string): Promise<void>;
}
