import OpenAI from 'openai';
import {
  IProvider,
  Message,
  ITool,
  ReasoningProfile,
  MessageRole,
  OpenAIModel,
  SSTResource,
} from '../types/index';
import { Resource } from 'sst';
import { logger } from '../logger';

const typedResource = Resource as unknown as SSTResource;

const REASONING_MAP: Record<ReasoningProfile, OpenAI.ReasoningEffort> = {
  [ReasoningProfile.FAST]: 'low',
  [ReasoningProfile.STANDARD]: 'medium',
  [ReasoningProfile.THINKING]: 'high',
  [ReasoningProfile.DEEP]: 'xhigh',
};

export class OpenAIProvider implements IProvider {
  constructor(private model: string = OpenAIModel.GPT_5_4) {}

  async call(
    messages: Message[],
    tools?: ITool[],
    profile: ReasoningProfile = ReasoningProfile.STANDARD,
    model?: string,
    _provider?: string
  ): Promise<Message> {
    const apiKey = typedResource.OpenAIApiKey.value;
    const client = new OpenAI({ apiKey });
    const activeModel = model || this.model;

    // Fallback if profile not supported
    const capabilities = await this.getCapabilities();
    if (!capabilities.supportedReasoningProfiles.includes(profile)) {
      logger.warn(
        `Profile ${profile} not supported for model ${activeModel}, falling back to STANDARD`
      );
      profile = ReasoningProfile.STANDARD;
    }

    const reasoningEffort = REASONING_MAP[profile];

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

    // Determining if we should use the new Responses API (/v1/responses)
    // gpt-5.4 doesn't support reasoning_effort + tools on /chat/completions
    const isGpt54 = activeModel.includes(OpenAIModel.GPT_5_4);
    const hasTools = tools && tools.length > 0;
    const isReasoning = profile !== ReasoningProfile.STANDARD;
    const useResponsesAPI = isGpt54 && (hasTools || isReasoning);

    if (useResponsesAPI) {
      logger.info(`Using OpenAI Responses API for model ${activeModel}`);
      const response = (await client.responses.create({
        model: activeModel as OpenAI.ResponsesModel,
        input: messages.map((m) => {
          if (m.role === MessageRole.TOOL) {
            return {
              type: 'tool_call_output',
              call_id: m.tool_call_id || '',
              output: m.content || '',
            };
          }
          let role: 'user' | 'assistant' | 'system' | 'developer' = 'user';
          if (m.role === MessageRole.SYSTEM) role = 'developer';
          else if (m.role === MessageRole.ASSISTANT) role = 'assistant';
          else if (m.role === MessageRole.DEVELOPER) role = 'developer';

          return {
            type: 'message',
            role,
            content: m.content || '',
            ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
          };
        }) as any[],
        reasoning: { effort: reasoningEffort },
        ...(hasTools
          ? {
              tools: tools.map((t) => ({
                type: 'function',
                name: t.name,
                description: t.description,
                parameters: t.parameters as unknown as Record<string, unknown>,
                strict: true,
              })),
            }
          : {}),
      })) as any; // Cast to any once at the boundary to isolate unsafe access

      // Extract output
      const content = (response.output_text as string) || '';
      const toolCalls: Message['tool_calls'] = [];

      if (Array.isArray(response.output)) {
        for (const item of response.output) {
          if (item.type === 'function_call') {
            toolCalls.push({
              id: item.call_id as string,
              type: 'function',
              function: {
                name: item.name as string,
                arguments: item.arguments as string,
              },
            });
          }
        }
      }

      return {
        role: MessageRole.ASSISTANT,
        content,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      } as Message;
    }

    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: activeModel,
      messages: processedMessages,
      ...(isGpt54 ? { reasoning_effort: reasoningEffort } : {}),
    };

    if (hasTools) {
      params.tools = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters as unknown as Record<string, unknown>,
          strict: true,
        },
      }));
      params.parallel_tool_calls = isGpt54;
      if (profile === ReasoningProfile.DEEP || profile === ReasoningProfile.THINKING) {
        params.parallel_tool_calls = false;
      }
    }

    const response = (await client.chat.completions.create(params)) as any;
    const choices = response.choices as any[];
    const message = choices?.[0]?.message;

    if (!message) {
      return { role: MessageRole.ASSISTANT, content: 'Empty response from OpenAI.' };
    }

    return {
      role: MessageRole.ASSISTANT,
      content: (message.content as string) || '',
      tool_calls: message.tool_calls as Message['tool_calls'],
    } as Message;
  }

  async getCapabilities(model?: string) {
    const activeModel = model || this.model;
    const isGpt54 = activeModel.includes(OpenAIModel.GPT_5_4);
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
