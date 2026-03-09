import { IProvider, Message, ITool } from './types';
import { Resource } from 'sst';

export class OpenAIProvider implements IProvider {
  constructor(private model: string = 'gpt-5-mini') {}

  async call(messages: Message[], tools?: ITool[]): Promise<Message> {
    const apiKey = Resource.OpenAIApiKey.value;

    const body: any = {
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

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as any;
    const message = data.choices?.[0]?.message;

    return {
      role: message.role,
      content: message.content || '',
      tool_calls: message.tool_calls,
    };
  }
}
