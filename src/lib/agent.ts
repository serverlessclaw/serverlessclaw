import {
  IMemory,
  IProvider,
  ITool,
  Message,
  ReasoningProfile,
  MessageRole,
  EventType,
  SSTResource,
} from './types';
import { ClawTracer } from './tracer';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Resource } from 'sst';

const typedResource = Resource as unknown as SSTResource;

export class Agent {
  private eventbridge = new EventBridgeClient({});

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
      - MODEL SWITCHING: You can switch your own provider or model at runtime using 'switch_model'. Use this if you encounter persistent errors with the current provider or if the user requests a specific model.
      - PROTECT THE CORE: Never allow deletion of the 'AgentBus' or 'MemoryTable' without 3 separate confirmations.
      - You think step by step and maintain a high standard of safety.
    `
  ) {}

  async process(
    userId: string,
    userText: string,
    profile: ReasoningProfile = ReasoningProfile.STANDARD
  ): Promise<string> {
    const tracer = new ClawTracer(userId);
    await tracer.startTrace({ userText });

    // 1. Get history, distilled facts, and tactical lessons
    const history = await this.memory.getHistory(userId);
    const distilled = await this.memory.getDistilledMemory(userId);
    const lessons = await this.memory.getLessons(userId);

    // 2. Check for recent Recovery Events (Dead Man's Switch)
    let recoveryContext = '';
    try {
      const recoveryData = await this.memory.getDistilledMemory('RECOVERY');
      if (recoveryData) {
        recoveryContext = `\n\nSYSTEM_RECOVERY_LOG: Recent emergency rollback occurred. Details: ${recoveryData}`;
        await this.memory.updateDistilledMemory('RECOVERY', '');
      }
    } catch (e) {
      console.error('Error checking recovery context:', e);
    }

    // 3. Add user message
    const userMessage: Message = { role: MessageRole.USER, content: userText };
    await this.memory.addMessage(userId, userMessage);

    // 4. Complete context (Smart Recall Index)
    let contextPrompt = this.systemPrompt;
    if (recoveryContext) contextPrompt += recoveryContext;

    const memoryIndex = `
      [MEMORY_INDEX]:
      - DISTILLED FACTS: ${distilled ? 'Available (load with recall_knowledge)' : 'None'}
      - TACTICAL LESSONS: ${lessons.length} recent available.
      
      USE 'recall_knowledge' to retrieve details if they are relevant to the user request.
    `;
    contextPrompt += `\n\n${memoryIndex}`;

    const messages: Message[] = [
      { role: MessageRole.SYSTEM, content: contextPrompt },
      ...history,
      userMessage,
    ];

    let responseText = '';
    let iterations = 0;
    const maxIterations = 5;

    try {
      while (iterations < maxIterations) {
        await tracer.addStep({ type: 'llm_call', content: { messageCount: messages.length } });
        const aiResponse = await this.provider.call(messages, this.tools, profile);

        if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
          messages.push(aiResponse);

          for (const toolCall of aiResponse.tool_calls) {
            const tool = this.tools.find((t) => t.name === toolCall.function.name);
            if (tool) {
              const args = JSON.parse(toolCall.function.arguments);
              await tracer.addStep({ type: 'tool_call', content: { tool: tool.name, args } });

              const result = await tool.execute(args);

              await tracer.addStep({ type: 'tool_result', content: { tool: tool.name, result } });

              messages.push({
                role: MessageRole.TOOL,
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
                content: result,
              });
            }
          }
          iterations++;
        } else {
          responseText = aiResponse.content || '';
          break;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await tracer.addStep({ type: 'error', content: { errorMessage } });
      responseText = `I encountered an internal error: ${errorMessage}`;
    }

    if (!responseText) responseText = 'Sorry, I reached my iteration limit.';

    // 5. Save response
    await this.memory.addMessage(userId, { role: MessageRole.ASSISTANT, content: responseText });

    // 6. Finalize Trace
    await tracer.endTrace(responseText);

    // 7. Trigger Reflection (async via EventBridge)
    try {
      await this.eventbridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'main.agent',
              DetailType: EventType.REFLECT_TASK,
              Detail: JSON.stringify({
                userId,
                conversation: [...messages, { role: MessageRole.ASSISTANT, content: responseText }],
              }),
              EventBusName: typedResource.AgentBus.name,
            },
          ],
        })
      );
      console.log('Reflection task emitted for user:', userId);
    } catch (e) {
      console.error('Failed to emit reflection task:', e);
    }

    return responseText;
  }
}
