import { IMemory, IProvider, ITool, Message } from './types';

export class Agent {
  constructor(
    private memory: IMemory,
    private provider: IProvider,
    private tools: ITool[],
    private systemPrompt: string = 'You are a helpful AI agent. You think step by step. Use tools if needed.'
  ) {}

  async process(userId: string, userText: string): Promise<string> {
    // 1. Get history
    const history = await this.memory.getHistory(userId);

    // 2. Add user message
    const userMessage: Message = { role: 'user', content: userText };
    await this.memory.addMessage(userId, userMessage);

    // 3. Complete context
    const messages: Message[] = [
      { role: 'system', content: this.systemPrompt },
      ...history,
      userMessage,
    ];

    let responseText = '';
    let iterations = 0;
    const maxIterations = 5;

    while (iterations < maxIterations) {
      const aiResponse = await this.provider.call(messages, this.tools);

      if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
        messages.push(aiResponse);

        for (const toolCall of aiResponse.tool_calls) {
          const tool = this.tools.find((t) => t.name === toolCall.function.name);
          if (tool) {
            const args = JSON.parse(toolCall.function.arguments);
            const result = await tool.execute(args);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: result,
            });
          }
        }
        iterations++;
      } else {
        responseText = aiResponse.content;
        break;
      }
    }

    if (!responseText) responseText = 'Sorry, I reached my iteration limit.';

    // 4. Save response
    await this.memory.addMessage(userId, { role: 'assistant', content: responseText });

    return responseText;
  }
}
