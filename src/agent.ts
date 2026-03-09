import { IMemory, IProvider, ITool, Message } from './types';

export class Agent {
  constructor(
    private memory: IMemory,
    private provider: IProvider,
    private tools: ITool[],
    private systemPrompt: string = 'You are a helpful AI agent. You think step by step. Use tools if needed.'
  ) {}

  async process(userId: string, userText: string): Promise<string> {
    // 1. Get history and distilled memory
    const history = await this.memory.getHistory(userId);
    const distilled = await this.memory.getDistilledMemory(userId);

    // 2. Add user message
    const userMessage: Message = { role: 'user', content: userText };
    await this.memory.addMessage(userId, userMessage);

    // 3. Complete context (inject distilled facts as a system instruction)
    const contextPrompt = distilled
      ? `${this.systemPrompt}\n\nLONG-TERM USER FACTS:\n${distilled}`
      : this.systemPrompt;

    const messages: Message[] = [
      { role: 'system', content: contextPrompt },
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

    // 5. Trigger Reflection (async)
    this.reflect(userId, [...messages, { role: 'assistant', content: responseText }]).catch(
      console.error
    );

    return responseText;
  }

  private async reflect(userId: string, conversation: Message[]) {
    const existingFacts = await this.memory.getDistilledMemory(userId);

    const reflectionPrompt = `
      You are an observer analyzing a conversation. 
      Your goal is to extract key facts about the user to maintain long-term memory.
      
      EXISTING FACTS:
      ${existingFacts || 'None'}

      CONVERSATION:
      ${conversation.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}

      Update the EXISTING FACTS with any new information found in the CONVERSATION.
      Be concise. Only include permanent facts (e.g., location, preferences, names, past events). 
      Return the full updated list of facts.
    `;

    const summaryResponse = await this.provider.call([
      { role: 'system', content: reflectionPrompt },
    ]);

    if (summaryResponse.content) {
      await this.memory.updateDistilledMemory(userId, summaryResponse.content);
    }
  }
}
