import { IMemory, IProvider, ITool, Message } from './types';

export class Agent {
  constructor(
    private memory: IMemory,
    private provider: IProvider,
    private tools: ITool[],
    private systemPrompt: string = `
      You are the Main Manager Agent of the Serverless Claw stack. 
      You are capable of autonomous self-evolution and multi-agent orchestration.
      
      - SYSTEM NOTIFICATIONS: If you receive a message starting with 'SYSTEM_NOTIFICATION', it means an automated process (like a build failure) needs your attention. 
        1. Notify the user immediately about the failure.
        2. Analyze the provided logs to understand the error.
        3. Delegate the fix to the 'coder' agent using 'dispatch_task'.
        4. Inform the user of your plan.

      - RECOVERY EVENTS: If you see 'SYSTEM_RECOVERY_LOG' in your context, it means the Dead Man's Switch had to perform an emergency rollback because the system was down. Acknowledge this to the user and explain that you are back online.

      - Use 'dispatch_task' to delegate complex coding or infra changes to the 'coder' agent.
      - DEPLOY THEN VERIFY: After 'trigger_deployment', always call 'check_health' with the API URL to confirm success.
      - ROLLBACK SIGNAL: If 'trigger_deployment' returns CIRCUIT_BREAKER_ACTIVE or 'check_health' returns HEALTH_FAILED, you MUST call 'trigger_rollback' immediately and notify the user on Telegram.
      - HUMAN-IN-THE-LOOP: If a sub-agent reports 'MANUAL_APPROVAL_REQUIRED' or if you notice changes to 'sst.config.ts', you MUST stop and ask the human user for explicit approval on Telegram.
      - PROTECT THE CORE: Never allow deletion of the 'AgentBus' or 'MemoryTable' without 3 separate confirmations.
      - You think step by step and maintain a high standard of safety.
    `
  ) {}

  async process(userId: string, userText: string): Promise<string> {
    // 1. Get history and distilled memory
    const history = await this.memory.getHistory(userId);
    const distilled = await this.memory.getDistilledMemory(userId);

    // 2. Check for recent Recovery Events (Dead Man's Switch)
    let recoveryContext = '';
    try {
      const recoveryData = await this.memory.getDistilledMemory('RECOVERY');
      if (recoveryData) {
        recoveryContext = `\n\nSYSTEM_RECOVERY_LOG: Recent emergency rollback occurred. Details: ${recoveryData}`;
        // Clear it so we don't keep reporting it in every turn
        await this.memory.updateDistilledMemory('RECOVERY', '');
      }
    } catch (e) {
      console.error('Error checking recovery context:', e);
    }

    // 3. Add user message
    const userMessage: Message = { role: 'user', content: userText };
    await this.memory.addMessage(userId, userMessage);

    // 4. Complete context (inject distilled facts as a system instruction)
    const contextPrompt =
      distilled || recoveryContext
        ? `${this.systemPrompt}${recoveryContext}\n\nLONG-TERM USER FACTS:\n${distilled}`
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

    // 5. Save response
    await this.memory.addMessage(userId, { role: 'assistant', content: responseText });

    // 6. Trigger Reflection (async)
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
