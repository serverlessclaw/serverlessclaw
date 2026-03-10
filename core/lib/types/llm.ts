import { ITool } from './agent.js';

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

export enum ReasoningProfile {
  FAST = 'fast',
  STANDARD = 'standard',
  THINKING = 'thinking',
  DEEP = 'deep',
}

export enum LLMProvider {
  OPENAI = 'openai',
  BEDROCK = 'bedrock',
  OPENROUTER = 'openrouter',
}

export enum OpenAIModel {
  GPT_5_4 = 'gpt-5.4',
  GPT_5_MINI = 'gpt-5-mini',
}

export enum BedrockModel {
  CLAUDE_4_6 = 'global.anthropic.claude-sonnet-4-6',
}

export enum OpenRouterModel {
  GLM_5 = 'zhipu/glm-5',
  MINIMAX_2_5 = 'minimax/minimax-2.5',
  GEMINI_3_FLASH = 'google/gemini-3-flash-preview',
}

export interface ICapabilities {
  supportedReasoningProfiles: ReasoningProfile[];
}

export interface IProvider {
  call(messages: Message[], tools?: ITool[], profile?: ReasoningProfile): Promise<Message>;
  getCapabilities(): Promise<ICapabilities>;
}
