import { IProvider, Message, ITool, ReasoningProfile } from '../types';
import { Resource } from 'sst';

export class OpenAIProvider implements IProvider {
  constructor(private model: string = 'gpt-5.4') {}

  async call(
    messages: Message[],
    tools?: ITool[],
    profile: ReasoningProfile = 'standard'
  ): Promise<Message> {
    const apiKey = Resource.OpenAIApiKey.value;
    const baseUrl = 'https://api.openai.com/v1';

    // 2026 Optimization: Handle System vs Developer messages
    // OpenAI now recommends 'developer' role for top-level instructions
    const processedMessages = messages.map((m) => ({
      ...m,
      role: m.role === 'system' ? 'developer' : m.role,
    }));

    // Map profile to reasoning_effort for gpt-5.4 models
    let reasoningEffort = 'medium';
    if (profile === 'fast') reasoningEffort = 'low';
    if (profile === 'thinking') reasoningEffort = 'high';
    if (profile === 'deep') reasoningEffort = 'xhigh';

    const body: Record<string, unknown> = {
      model: this.model,
      messages: processedMessages,
      // 2026 Optimization: Reasoning Effort
      // High for gpt-5.4 logic, medium for general tasks
      ...(this.model.includes('gpt-5') ? { reasoning_effort: reasoningEffort } : {}),
      // 2026 Optimization: Predictive Outputs
      // Set for latency optimization on repetitive tasks
      ...(profile === 'fast' ? { prediction: { type: 'content' } } : {}),
    };

    if (tools && tools.length > 0) {
      body['tools'] = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          // 2026 Optimization: Strict Mode (Structured Outputs)
          // Ensures model follows the JSON schema exactly
          strict: true,
        },
      }));

      // Control parallel tool calling to prevent resource exhaustion
      body['parallel_tool_calls'] = false;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI Provider error: ${response.status} - ${error}`);
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
