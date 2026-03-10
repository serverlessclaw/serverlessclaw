import { IProvider, Message, ITool, ReasoningProfile } from '../types';
import { Resource } from 'sst';

interface OpenRouterResource {
  OpenRouterApiKey: { value: string };
}

export class OpenRouterProvider implements IProvider {
  constructor(private model: string = 'google/gemini-3-flash-preview') {}

  async call(
    messages: Message[],
    tools?: ITool[],
    profile: ReasoningProfile = 'standard'
  ): Promise<Message> {
    const apiKey = (Resource as unknown as OpenRouterResource).OpenRouterApiKey?.value || '';
    const baseUrl = 'https://openrouter.ai/api/v1';

    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages,
      // 2026 OpenRouter Enhancements:
      // Provider routing preferences (prefer speed/cost)
      route: profile === 'fast' ? 'latency' : 'fallback',
      // Allow provider-specific transformations (e.g. prompt caching)
      provider: {
        allow_fallbacks: true,
        data_collection: 'deny', // Privacy first
        // 2026: Enable prompt caching for high-volume sessions
        prompt_cache: true,
      },
      // Map profile to provider-specific reasoning if supported
      ...(profile === 'thinking' || profile === 'deep' ? { include_reasoning: true } : {}),
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
      return { role: 'assistant', content: 'Empty response from provider.' };
    }

    return {
      role: message.role,
      content: message.content || '',
      tool_calls: message.tool_calls,
    };
  }
}
