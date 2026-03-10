import { NextRequest, NextResponse } from 'next/server';
import { DynamoMemory } from '../../../../../src/lib/memory';
import { Agent } from '../../../../../src/lib/agent';
import { ProviderManager } from '../../../../../src/lib/providers';
import { tools } from '../../../../../src/tools/index';

// We initialize these outside the handler for potential reuse,
// but they depend on Resources being available.
const memory = new DynamoMemory();
const provider = new ProviderManager();
const agent = new Agent(memory, provider, Object.values(tools));

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    const userId = 'dashboard-user'; // Fixed ID for dashboard chat

    if (!text) {
      return NextResponse.json({ error: 'Missing message' }, { status: 400 });
    }

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
