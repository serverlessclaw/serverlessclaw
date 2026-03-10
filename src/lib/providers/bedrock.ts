import { IProvider, Message, ITool } from '../types';
import { Resource } from 'sst';

interface BedrockResource {
  AwsRegion: { value: string };
}

export class BedrockProvider implements IProvider {
  constructor(private modelId: string = 'anthropic.claude-4-6-sonnet-20260215-v1:0') {}

  async call(messages: Message[], tools?: ITool[]): Promise<Message> {
    const { BedrockRuntimeClient, ConverseCommand } =
      await import('@aws-sdk/client-bedrock-runtime');

    const typedResource = Resource as unknown as BedrockResource;
    const client = new BedrockRuntimeClient({
      region: typedResource.AwsRegion?.value || 'us-east-1',
    });

    const bedrockMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: [{ text: m.content || '' }],
      }));

    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => ({ text: m.content || '' }));

    const bedrockTools = tools?.map((t) => ({
      toolSpec: {
        name: t.name,
        description: t.description,
        inputSchema: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          json: t.parameters as any,
        },
      },
    }));

    const command = new ConverseCommand({
      modelId: this.modelId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: bedrockMessages as any[],
      system,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toolConfig: bedrockTools ? { tools: bedrockTools as any[] } : undefined,
    });

    const response = await client.send(command);

    if (response.output?.message) {
      const msg = response.output.message;
      return {
        role: 'assistant',
        content: msg.content?.[0]?.text || '',
        tool_calls: msg.content
          ?.filter((c) => c.toolUse)
          .map((c) => ({
            id: c.toolUse!.toolUseId!,
            type: 'function',
            function: {
              name: c.toolUse!.name!,
              arguments: JSON.stringify(c.toolUse!.input),
            },
          })),
      };
    }

    return { role: 'assistant', content: 'Empty response from Bedrock.' };
  }
}
