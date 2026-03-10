import {
  IProvider,
  Message,
  ITool,
  ReasoningProfile,
  MessageRole,
  OpenRouterModel,
} from '../types';
import { Resource } from 'sst';

interface OpenRouterResource {
  OpenRouterApiKey: { value: string };
}

export class OpenRouterProvider implements IProvider {
  constructor(private model: string = OpenRouterModel.GEMINI_3_FLASH) {}

  async call(
    messages: Message[],
    tools?: ITool[],
    profile: ReasoningProfile = ReasoningProfile.STANDARD
  ): Promise<Message> {
    const apiKey = (Resource as unknown as OpenRouterResource).OpenRouterApiKey?.value || '';
    const baseUrl = 'https://openrouter.ai/api/v1';

    // Fallback if profile not supported
    const capabilities = await this.getCapabilities();
    if (!capabilities.supportedReasoningProfiles.includes(profile)) {
      console.warn(
        `Profile ${profile} not supported for OpenRouter model ${this.model}, falling back to STANDARD`
      );
      profile = ReasoningProfile.STANDARD;
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages,
      // 2026 OpenRouter Enhancements:
      // Provider routing preferences (prefer speed/cost)
      route: profile === ReasoningProfile.FAST ? 'latency' : 'fallback',
      // Allow provider-specific transformations (e.g. prompt caching)
      provider: {
        allow_fallbacks: true,
        data_collection: 'deny', // Privacy first
        // 2026: Enable prompt caching for high-volume sessions
        prompt_cache: true,
      },
      // Map profile to provider-specific reasoning if supported
      ...(profile === ReasoningProfile.THINKING || profile === ReasoningProfile.DEEP
        ? { include_reasoning: true }
        : {}),
    };

    if (tools && tools.length > 0) {
      body['tools'] = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/serverlessclaw/serverlessclaw',
        'X-Title': 'Serverless Claw',
        // 2026 Optimization: Request caching if available on provider
        'X-OpenRouter-Caching': 'true',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter Provider error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      choices?: { message: Message }[];
    };
    const message = data.choices?.[0]?.message;

    if (!message) {
      return { role: MessageRole.ASSISTANT, content: 'Empty response from provider.' } as Message;
    }

    return {
      role: MessageRole.ASSISTANT,
      content: message.content || '',
      tool_calls: message.tool_calls,
    } as Message;
  }

  async getCapabilities() {
    // OpenRouter is a passthrough; we can either have a generic set or a specific list
    // For standardized models, we allow standard and fast.
    const isStandardized = Object.values(OpenRouterModel).includes(this.model as any);

    return {
      supportedReasoningProfiles: isStandardized
        ? [ReasoningProfile.FAST, ReasoningProfile.STANDARD]
        : [ReasoningProfile.FAST, ReasoningProfile.STANDARD],
    };
  }
}
