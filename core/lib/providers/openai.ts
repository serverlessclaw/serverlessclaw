import OpenAI from 'openai';
import {
  IProvider,
  Message,
  ITool,
  ReasoningProfile,
  MessageRole,
  OpenAIModel,
} from '../types/index';
import { Resource } from 'sst';
import { logger } from '../logger';

export class OpenAIProvider implements IProvider {
  constructor(private model: string = OpenAIModel.GPT_5_4) {}

  async call(
    messages: Message[],
    tools?: ITool[],
    profile: ReasoningProfile = ReasoningProfile.STANDARD
  ): Promise<Message> {
    const apiKey = Resource.OpenAIApiKey.value;
    const client = new OpenAI({ apiKey });

    // Fallback if profile not supported
    const capabilities = await this.getCapabilities();
    if (!capabilities.supportedReasoningProfiles.includes(profile)) {
      logger.warn(
        `Profile ${profile} not supported for model ${this.model}, falling back to STANDARD`
      );
      profile = ReasoningProfile.STANDARD;
    }

    // Map internal message role to OpenAI SDK role
    const processedMessages = messages.map((m) => {
      let role: OpenAI.Chat.ChatCompletionRole = 'user';
      if (m.role === MessageRole.SYSTEM) role = 'developer';
      else if (m.role === MessageRole.ASSISTANT) role = 'assistant';
      else if (m.role === MessageRole.TOOL) role = 'tool';
      else if (m.role === MessageRole.DEVELOPER) role = 'developer';

      return {
        role,
        content: m.content || '',
        ...(m.tool_calls
          ? { tool_calls: m.tool_calls as OpenAI.Chat.ChatCompletionMessageToolCall[] }
          : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      };
    }) as OpenAI.Chat.ChatCompletionMessageParam[];

    // Map profile to reasoning_effort for gpt-5.4 models
    let reasoningEffort: OpenAI.Chat.ChatCompletionCreateParams['reasoning_effort'] = 'medium';
    if (profile === ReasoningProfile.FAST) reasoningEffort = 'low';
    if (profile === ReasoningProfile.THINKING) reasoningEffort = 'high';
    if (profile === ReasoningProfile.DEEP) reasoningEffort = 'xhigh';

    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: processedMessages,
      ...(this.model.includes(OpenAIModel.GPT_5_4) ? { reasoning_effort: reasoningEffort } : {}),
      // 2026 Optimization: Prediction removed if no content provided to avoid lint error
    };

    if (tools && tools.length > 0) {
      params.tools = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters as unknown as Record<string, unknown>,
          strict: true,
        },
      }));
      params.parallel_tool_calls = false;
    }

    const response = await client.chat.completions.create(params);
    const message = response.choices[0].message;

    if (!message) {
      return { role: MessageRole.ASSISTANT, content: 'Empty response from OpenAI.' };
    }

    return {
      role: MessageRole.ASSISTANT,
      content: message.content || '',
      tool_calls: message.tool_calls as Message['tool_calls'],
    } as Message;
  }

  async getCapabilities() {
    const isGpt54 = this.model.includes(OpenAIModel.GPT_5_4);
    return {
      supportedReasoningProfiles: isGpt54
        ? [
            ReasoningProfile.FAST,
            ReasoningProfile.STANDARD,
            ReasoningProfile.THINKING,
            ReasoningProfile.DEEP,
          ]
        : [ReasoningProfile.FAST, ReasoningProfile.STANDARD],
    };
  }
}
