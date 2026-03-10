import { NextRequest, NextResponse } from 'next/server';
import { DynamoMemory } from '@claw/core/lib/memory.js';
import { Agent } from '@claw/core/lib/agent.js';
import { ProviderManager } from '@claw/core/lib/providers/index.js';
import { getAgentTools } from '@claw/core/tools/index.js';
import { MANAGER_SYSTEM_PROMPT } from '@claw/core/agents/manager.js';
import { MessageRole } from '@claw/core/lib/types/index.js';

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    const userId = 'dashboard-user'; // Fixed ID for dashboard chat

    if (!text) {
      return NextResponse.json({ error: 'Missing message' }, { status: 400 });
    }

    // We initialize these inside the handler because they depend on Resources 
    // being available in the environment.
    const memory = new DynamoMemory();
    const provider = new ProviderManager();
    const agentTools = await getAgentTools('main');
    const agent = new Agent(memory, provider, agentTools, MANAGER_SYSTEM_PROMPT);

    const reply = await agent.process(userId, text);

    return NextResponse.json({ reply });
  } catch (error) {
    console.error('API Chat Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
