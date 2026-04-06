import { Context } from 'aws-lambda';
import { AgentEvent } from '../../lib/types/agent';

/**
 * Technical Research Agent Handler Wrapper.
 * Forwards the event to the standalone Researcher agent in core/agents.
 *
 * @param eventDetail - The event detail.
 * @param context - The AWS Lambda context.
 */
export const handleResearchTask = async (
  eventDetail: Record<string, unknown>,
  context: Context
): Promise<void> => {
  const { handler } = await import('../../agents/researcher');
  const event = {
    detail: eventDetail,
    source: 'agent.researcher',
  } as unknown as AgentEvent;

  await handler(event, context);
};
