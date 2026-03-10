import {
  BedrockRuntimeClient,
  ConverseCommand,
  Message as BedrockMessage,
  SystemContentBlock,
  Tool as BedrockTool,
  ContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import { IProvider, Message, ITool, ReasoningProfile, MessageRole, BedrockModel } from '../types';
import { Resource } from 'sst';

interface BedrockResource {
  AwsRegion: { value: string };
}

export class BedrockProvider implements IProvider {
  constructor(private modelId: string = BedrockModel.CLAUDE_4_6) {}

  async call(
    messages: Message[],
    tools?: ITool[],
    profile: ReasoningProfile = ReasoningProfile.STANDARD
  ): Promise<Message> {
    const typedResource = Resource as unknown as BedrockResource;
    const client = new BedrockRuntimeClient({
      region: typedResource.AwsRegion?.value || 'us-east-1',
    });

    // Fallback if profile not supported
    const capabilities = await this.getCapabilities();
    if (!capabilities.supportedReasoningProfiles.includes(profile)) {
      console.warn(
        `Profile ${profile} not supported for model ${this.modelId}, falling back to STANDARD`
      );
      profile = ReasoningProfile.STANDARD;
    }

    // 2026 Bedrock Optimization: Converse API System/User mapping
    const bedrockMessages: BedrockMessage[] = messages
      .filter((m) => m.role !== MessageRole.SYSTEM && m.role !== MessageRole.DEVELOPER)
      .map((m) => {
        let role: 'user' | 'assistant' = 'user';
        if (m.role === MessageRole.ASSISTANT) role = 'assistant';

        const content: ContentBlock[] = [{ text: m.content || '' }];

        if (m.tool_calls) {
          m.tool_calls.forEach((tc) => {
            content.push({
              toolUse: {
                toolUseId: tc.id,
                name: tc.function.name,
                input: JSON.parse(tc.function.arguments),
              },
            });
          });
        }

        if (m.role === MessageRole.TOOL) {
          content.push({
            toolResult: {
              toolUseId: m.tool_call_id!,
              content: [{ text: m.content || '' }],
              status: 'success',
            },
          });
        }

        return { role, content };
      });

    const system: SystemContentBlock[] = messages
      .filter((m) => m.role === MessageRole.SYSTEM || m.role === MessageRole.DEVELOPER)
      .map((m) => ({ text: m.content || '' }));

    const bedrockTools: BedrockTool[] | undefined = tools?.map((t) => ({
      toolSpec: {
        name: t.name,
        description: t.description,
        inputSchema: {
          json: t.parameters as any,
        },
      },
    }));

    // Map profile to Claude 4.6 Thinking budget
    let thinkingBudget = 1024;
    let thinkingEnabled = true;

    if (profile === ReasoningProfile.FAST) {
      thinkingBudget = 0;
      thinkingEnabled = false;
    } else if (profile === ReasoningProfile.THINKING) {
      thinkingBudget = 4096;
    } else if (profile === ReasoningProfile.DEEP) {
      thinkingBudget = 16384;
    }

    const command = new ConverseCommand({
      modelId: this.modelId,
      messages: bedrockMessages,
      system,
      toolConfig: bedrockTools ? { tools: bedrockTools } : undefined,
      inferenceConfig: {
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9,
      },
      additionalModelRequestFields: {
        ...(thinkingEnabled
          ? {
              thinking: {
                type: 'enabled',
                budget_tokens: thinkingBudget,
              },
            }
          : {}),
      },
    });

    const response = await client.send(command);

    if (response.output?.message) {
      const msg = response.output.message;
      return {
        role: MessageRole.ASSISTANT,
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
      } as Message;
    }

    return { role: MessageRole.ASSISTANT, content: 'Empty response from Bedrock.' } as Message;
  }

  async getCapabilities() {
    const isClaude46 = this.modelId.includes(BedrockModel.CLAUDE_4_6);
    return {
      supportedReasoningProfiles: isClaude46
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
