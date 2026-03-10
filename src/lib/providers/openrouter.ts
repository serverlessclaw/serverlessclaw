import { IProvider, Message, ITool } from '../types';
import { Resource } from 'sst';

interface OpenRouterResource {
  OpenRouterApiKey: { value: string };
}

export class OpenRouterProvider implements IProvider {
  constructor(private model: string = 'google/gemini-3-flash-preview') {}

  async call(messages: Message[], tools?: ITool[]): Promise<Message> {
    const apiKey = (Resource as unknown as OpenRouterResource).OpenRouterApiKey?.value || '';
    const baseUrl = 'https://openrouter.ai/api/v1';

    const body: {
      model: string;
      messages: Message[];
      tools?: {
        type: 'function';
        function: {
          name: string;
          description: string;
          parameters: unknown;
        };
      }[];
    } = {
      model: this.model,
      messages: messages,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
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
