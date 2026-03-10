import { IProvider, Message, ITool } from '../types';
import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

import { OpenAIProvider } from './openai';
import { BedrockProvider } from './bedrock';
import { OpenRouterProvider } from './openrouter';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface ProviderResource {
  ActiveProvider?: { value: string };
  ActiveModel?: { value: string };
  ConfigTable: { name: string };
}

export class ProviderManager implements IProvider {
  static async getActiveProvider(): Promise<IProvider> {
    const typedResource = Resource as unknown as ProviderResource;
    let providerType = typedResource.ActiveProvider?.value || 'openai';
    let model = typedResource.ActiveModel?.value;

    try {
      const { Item } = await db.send(
        new GetCommand({
          TableName: typedResource.ConfigTable.name,
          Key: { key: 'active_provider' },
        })
      );
      if (Item && Item.value) {
        providerType = Item.value;
      }

      const { Item: modelItem } = await db.send(
        new GetCommand({
          TableName: typedResource.ConfigTable.name,
          Key: { key: 'active_model' },
        })
      );
      if (modelItem && modelItem.value) {
        model = modelItem.value;
      }
    } catch (e) {
      console.warn('Could not fetch hot config from ConfigTable, falling back to secrets:', e);
    }

    switch (providerType) {
      case 'bedrock':
        // Native Bedrock for high-performance Claude 4.6
        return new BedrockProvider(model || 'anthropic.claude-4-6-sonnet-20260215-v1:0');

      case 'openrouter':
        // Aggregator for cost-effective models: Gemini 3 Flash, GLM-5, Minimax 2.5
        return new OpenRouterProvider(model || 'google/gemini-3-flash-preview');

      case 'openai':
      default:
        // Native OpenAI for GPT-5.4 (Power) and GPT-5-mini (Efficiency)
        return new OpenAIProvider(model || 'gpt-5.4');
    }
  }

  async call(messages: Message[], tools?: ITool[]): Promise<Message> {
    const provider = await ProviderManager.getActiveProvider();
    return provider.call(messages, tools);
  }
}
