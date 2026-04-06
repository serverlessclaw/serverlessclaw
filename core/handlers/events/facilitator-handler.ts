import { Context } from 'aws-lambda';
import { AgentEvent } from '../../lib/types/agent';

/**
 * Facilitator Agent Handler Wrapper.
 * Forwards the event to the standalone Facilitator agent in core/agents.
 *
 * @param eventDetail - The event detail.
 * @param context - The AWS Lambda context.
 */
export const handleFacilitatorTask = async (
  eventDetail: Record<string, unknown>,
  context: Context
): Promise<void> => {
  const { handler } = await import('../../agents/facilitator');
  const event = {
    detail: eventDetail as Record<string, unknown>,
    source: 'agent.facilitator',
  } as unknown as AgentEvent;

  await handler(event, context);
};
