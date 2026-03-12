import {
  BedrockRuntimeClient,
  ConverseCommand,
  Message as BedrockMessage,
  SystemContentBlock,
  Tool as BedrockTool,
  ContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import {
  IProvider,
  Message,
  ITool,
  ReasoningProfile,
  MessageRole,
  BedrockModel,
} from '../types/index';
import { Resource } from 'sst';
import { logger } from '../logger';

interface BedrockResource {
  AwsRegion: { value: string };
}

interface BedrockReasoningConfig {
  thinkingBudget: number;
  thinkingEnabled: boolean;
  maxTokens: number;
  temperature: number;
}

const BEDROCK_REASONING_MAP: Record<ReasoningProfile, BedrockReasoningConfig> = {
  [ReasoningProfile.FAST]: {
    thinkingBudget: 0,
    thinkingEnabled: false,
    maxTokens: 4096,
    temperature: 0.7,
  },
  [ReasoningProfile.STANDARD]: {
    thinkingBudget: 1024,
    thinkingEnabled: true,
    maxTokens: 8192,
    temperature: 0.7,
  },
  [ReasoningProfile.THINKING]: {
    thinkingBudget: 4096,
    thinkingEnabled: true,
    maxTokens: 12288,
    temperature: 1.0,
  },
  [ReasoningProfile.DEEP]: {
    thinkingBudget: 32768,
    thinkingEnabled: true,
    maxTokens: 49152,
    temperature: 1.0,
  },
};

export class BedrockProvider implements IProvider {
  constructor(private modelId: string = BedrockModel.CLAUDE_4_6) {}

  async call(
    messages: Message[],
    tools?: ITool[],
    profile: ReasoningProfile = ReasoningProfile.STANDARD,
    model?: string,
    _provider?: string
  ): Promise<Message> {
    const typedResource = Resource as unknown as BedrockResource;
    const client = new BedrockRuntimeClient({
      region: typedResource.AwsRegion?.value || 'ap-southeast-2',
    });
    const activeModelId = model || this.modelId;

    // Fallback if profile not supported
    const capabilities = await this.getCapabilities();
    if (!capabilities.supportedReasoningProfiles.includes(profile)) {
      logger.warn(
        `Profile ${profile} not supported for model ${activeModelId}, falling back to STANDARD`
      );
      profile = ReasoningProfile.STANDARD;
    }

    const reasoningConfig = BEDROCK_REASONING_MAP[profile];

    // 2026 Bedrock Optimization: Converse API System/User mapping
    const bedrockMessages: BedrockMessage[] = messages
      .filter((m) => m.role !== MessageRole.SYSTEM && m.role !== MessageRole.DEVELOPER)
      .map((m) => {
        let role: 'user' | 'assistant' = 'user';
        if (m.role === MessageRole.ASSISTANT) role = 'assistant';

        const content: ContentBlock[] = [{ text: m.content || '' }];

        if (m.tool_calls) {
          m.tool_calls.forEach(
            (tc: { id: string; function: { name: string; arguments: string } }) => {
              content.push({
                toolUse: {
                  toolUseId: tc.id,
                  name: tc.function.name,
                  input: JSON.parse(tc.function.arguments),
                },
              });
            }
          );
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
          json: t.parameters as unknown as Record<string, unknown>,
        },
      },
    })) as unknown as BedrockTool[];

    const command = new ConverseCommand({
      modelId: activeModelId,
      messages: bedrockMessages,
      system,
      toolConfig: bedrockTools ? { tools: bedrockTools } : undefined,
      inferenceConfig: {
        maxTokens: reasoningConfig.maxTokens,
        temperature: reasoningConfig.temperature,
        topP: 0.9,
      },
      additionalModelRequestFields: {
        ...(reasoningConfig.thinkingEnabled
          ? {
              thinking: {
                type: 'enabled',
                budget_tokens: reasoningConfig.thinkingBudget,
              },
            }
          : {}),
      },
    });

    const response = await client.send(command);

    if (response.output?.message) {
      const msg = response.output.message;

      const reasoning = (msg.content as any[])
        ?.filter((c) => !!c.reasoningContent)
        .map((c) => c.reasoningContent?.reasoningText?.text || '')
        .join('\n\n');

      if (reasoning) {
        logger.debug(`[Bedrock Reasoning] for ${activeModelId}:`, reasoning);
      }

      // Aggregate all text blocks (model might return multiple)
      const content = msg.content
        ?.filter((c) => c.text)
        .map((c) => c.text)
        .join('\n\n');

      return {
        role: MessageRole.ASSISTANT,
        content: content || '',
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

  async getCapabilities(model?: string) {
    const activeModelId = model || this.modelId;
    const isClaude46 = activeModelId.includes('claude-sonnet-4-6');
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
