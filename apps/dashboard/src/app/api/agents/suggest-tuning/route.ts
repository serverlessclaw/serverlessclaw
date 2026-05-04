import { NextRequest } from 'next/server';
import { logger } from '@claw/core/lib/logger';
import { ClawTracer } from '@claw/core/lib/tracer/tracer-implementation';
import { AgentRegistry } from '@claw/core/lib/registry/AgentRegistry';
import { ProviderManager } from '@claw/core/lib/providers';
import { MessageRole } from '@claw/core/lib/types/llm';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agents/suggest-tuning
 * Analyzes a failed trace and suggests improvements to the agent configuration.
 */
export async function POST(request: NextRequest) {
  try {
    const { agentId, traceId } = await request.json();

    if (!agentId || !traceId) {
      return Response.json({ error: 'Missing agentId or traceId' }, { status: 400 });
    }

    // 1. Fetch the failed trace steps
    const traceNodes = await ClawTracer.getTrace(traceId);
    if (!traceNodes || traceNodes.length === 0) {
      return Response.json({ error: 'Trace not found' }, { status: 404 });
    }

    // Combine steps from all nodes for full context
    const fullTrace = traceNodes
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .map((node) => ({
        nodeId: node.nodeId,
        status: node.status,
        failureReason: node.failureReason,
        steps: node.steps,
        finalResponse: node.finalResponse,
      }));

    // 2. Fetch current agent config
    const config = await AgentRegistry.getAgentConfig(agentId);
    if (!config) {
      return Response.json({ error: 'Agent config not found' }, { status: 404 });
    }

    // 3. Request analysis from Tuning Critic
    const provider = new ProviderManager();
    const analysisPrompt = `
You are the Serverless Claw Tuning Critic. Your goal is to analyze a failed agent execution trace and suggest specific improvements to the agent's configuration.

CURRENT AGENT CONFIG:
Name: ${config.name}
Tools: ${config.tools?.join(', ') || 'None'}
System Prompt:
"""
${config.systemPrompt}
"""

FAILED TRACE DATA:
${JSON.stringify(fullTrace, null, 2)}

TASK:
1. Identify the root cause of the failure (logic error, tool misuse, prompt ambiguity, etc.).
2. Suggest 2-3 specific improvements to the System Prompt.
3. Suggest tool additions/removals if applicable.
4. Provide a "Remediation Script" snippet that can be applied to the prompt.

Respond in JSON format:
{
  "rootCause": "...",
  "suggestions": ["...", "..."],
  "improvedPromptSnippet": "...",
  "confidence": 0.0-1.0
}
    `;

    const response = await provider.call([
      {
        role: MessageRole.USER,
        content: analysisPrompt,
        traceId: `tuning-${traceId}-${Date.now()}`,
        messageId: `msg-tuning-${Date.now()}`,
      },
    ]);

    let suggestions;
    try {
      suggestions = JSON.parse(response.content as string);
    } catch {
      suggestions = {
        rootCause: 'Analysis failed to parse JSON',
        suggestions: [response.content as string],
        improvedPromptSnippet: '',
        confidence: 0,
      };
    }

    return Response.json({ suggestions });
  } catch (e) {
    logger.error('[API] Error generating tuning suggestions:', e);
    return Response.json({ error: 'Failed to generate suggestions' }, { status: 500 });
  }
}
