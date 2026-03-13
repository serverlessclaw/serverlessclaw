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
import { normalizeProfile, capEffort } from './utils';

interface OpenAIResponse {
  output_text?: string;
  output?: Array<{
    type: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  }>;
}

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
    const capabilities = await this.getCapabilities(activeModel);
    profile = normalizeProfile(profile, capabilities, activeModel);

    const reasoningEffort = capEffort(
      REASONING_MAP[profile] as string,
      capabilities.maxReasoningEffort
    );

    // Map internal message role to OpenAI SDK role
    const processedMessages = messages.map((m) => {
      let role: OpenAI.Chat.ChatCompletionRole = 'user';
      if (m.role === MessageRole.SYSTEM) role = 'developer';
      else if (m.role === MessageRole.ASSISTANT) role = 'assistant';
      else if (m.role === MessageRole.TOOL) role = 'tool';
      else if (m.role === MessageRole.DEVELOPER) role = 'developer';

      const content: OpenAI.Chat.ChatCompletionContentPart[] = [];
      if (m.content) {
        content.push({ type: 'text', text: m.content });
      }

      if (m.attachments) {
        m.attachments.forEach((att) => {
          if (att.type === 'image') {
            content.push({
              type: 'image_url',
              image_url: {
                url: att.url || `data:${att.mimeType || 'image/png'};base64,${att.base64}`,
              },
            });
          }
        });
      }

      return {
        role,
        content: content.length === 1 && content[0].type === 'text' ? m.content : content,
        ...(m.tool_calls
          ? { tool_calls: m.tool_calls as OpenAI.Chat.ChatCompletionMessageToolCall[] }
          : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      } as OpenAI.Chat.ChatCompletionMessageParam;
    });

    // Determining if we should use the new Responses API (/v1/responses)
    // gpt-5.4 doesn't support reasoning_effort + tools on /chat/completions
    const isReasoningModel =
      activeModel.includes(OpenAIModel.GPT_5_4) || activeModel.includes(OpenAIModel.GPT_5_MINI);
    const hasTools = tools && tools.length > 0;
    const useResponsesAPI = isReasoningModel;

    if (useResponsesAPI) {
      logger.info(`Using OpenAI Responses API for model ${activeModel}`);

      // Map to the new flat Responses API input schema
      const responsesInput = messages.flatMap((m) => {
        if (m.role === MessageRole.TOOL) {
          return [
            {
              type: 'function_call_output',
              call_id: m.tool_call_id || '',
              output: m.content || '',
            },
          ];
        }

        const items: Array<Record<string, unknown>> = [];

        // 1. Add message content if present
        if (m.content || (m.attachments && m.attachments.length > 0)) {
          let role: 'user' | 'assistant' | 'system' | 'developer' = 'user';
          if (m.role === MessageRole.SYSTEM) role = 'developer';
          else if (m.role === MessageRole.ASSISTANT) role = 'assistant';
          else if (m.role === MessageRole.DEVELOPER) role = 'developer';

          const content: OpenAI.Chat.ChatCompletionContentPart[] = [];
          if (m.content) content.push({ type: 'text', text: m.content });

          if (m.attachments) {
            m.attachments.forEach((att) => {
              if (att.type === 'image') {
                content.push({
                  type: 'image_url',
                  image_url: {
                    url: att.url || `data:${att.mimeType || 'image/png'};base64,${att.base64}`,
                  },
                });
              }
            });
          }

          items.push({
            type: 'message',
            role,
            content: content.length === 1 && content[0].type === 'text' ? m.content : content,
          });
        }

        // 2. Add tool calls as separate items (flattened)
        if (m.tool_calls && m.tool_calls.length > 0) {
          for (const tc of m.tool_calls) {
            items.push({
              type: 'function_call',
              call_id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments,
            });
          }
        }

        return items;
      });

      const response = (await client.responses.create({
        model: activeModel as OpenAI.ResponsesModel,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input: responsesInput as any,
        reasoning: { effort: reasoningEffort as OpenAI.ReasoningEffort },
        ...(hasTools
          ? {
              tools: tools.map((t) => {
                if (t.type && t.type !== 'function') {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  return { type: t.type } as any;
                }
                return {
                  type: 'function',
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters as unknown as Record<string, unknown>,
                  strict: true,
                };
              }),
            }
          : {}),
      })) as unknown as OpenAIResponse; // Isolate unsafe access

      // Extract output
      const content = response.output_text || '';
      const toolCalls: Message['tool_calls'] = [];

      if (response.output && Array.isArray(response.output)) {
        for (const item of response.output) {
          if (item.type === 'function_call') {
            toolCalls.push({
              id: item.call_id || '',
              type: 'function',
              function: {
                name: item.name || '',
                arguments: item.arguments || '',
              },
            });
          }
        }
      }

      return {
        role: MessageRole.ASSISTANT,
        content,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          prompt_tokens: (response as any).usage?.prompt_tokens || 0,
          completion_tokens: (response as any).usage?.completion_tokens || 0,
          total_tokens: (response as any).usage?.total_tokens || 0,
        },
      } as Message;
    }

    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: activeModel,
      messages: processedMessages,
      ...(isReasoningModel ? { reasoning_effort: reasoningEffort as OpenAI.ReasoningEffort } : {}),
    };
    if (hasTools) {
      params.tools = tools.map((t) => {
        if (t.type && t.type !== 'function') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { type: t.type } as any;
        }
        return {
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters as unknown as Record<string, unknown>,
            strict: true,
          },
        };
      }) as OpenAI.Chat.ChatCompletionTool[];

      params.parallel_tool_calls = isReasoningModel;
      if (profile === ReasoningProfile.DEEP || profile === ReasoningProfile.THINKING) {
        params.parallel_tool_calls = false;
      }
    }

    const response = (await client.chat.completions.create(params)) as OpenAI.Chat.ChatCompletion;
    const message = response.choices?.[0]?.message;

    if (!message) {
      return { role: MessageRole.ASSISTANT, content: 'Empty response from OpenAI.' };
    }

    return {
      role: MessageRole.ASSISTANT,
      content: message.content || '',
      tool_calls: message.tool_calls as Message['tool_calls'],
      usage: response.usage
        ? {
            prompt_tokens: response.usage.prompt_tokens,
            completion_tokens: response.usage.completion_tokens,
            total_tokens: response.usage.total_tokens,
          }
        : undefined,
    } as Message;
  }

  async getCapabilities(model?: string) {
    const activeModel = model || this.model;
    const isReasoningModel =
      activeModel.includes(OpenAIModel.GPT_5_4) || activeModel.includes(OpenAIModel.GPT_5_MINI);
    const isMiniModel = activeModel.includes(OpenAIModel.GPT_5_MINI);

    return {
      supportedReasoningProfiles: isReasoningModel
        ? [
            ReasoningProfile.FAST,
            ReasoningProfile.STANDARD,
            ReasoningProfile.THINKING,
            ReasoningProfile.DEEP,
          ]
        : [ReasoningProfile.FAST, ReasoningProfile.STANDARD],
      maxReasoningEffort: isMiniModel ? 'high' : 'xhigh',
    };
  }
}
