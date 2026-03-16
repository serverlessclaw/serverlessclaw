import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Context } from 'aws-lambda';
import { handleProactiveHeartbeat } from './proactive-handler';
import {
  EventBridgeClient,
  PutEventsCommand,
  PutEventsCommandInput,
} from '@aws-sdk/client-eventbridge';
import { mockClient } from 'aws-sdk-client-mock';
import { AgentType, EventType } from '../../lib/types/agent';

const eventBridgeMock = mockClient(EventBridgeClient);

describe('ProactiveHandler', () => {
  beforeEach(() => {
    eventBridgeMock.reset();
    vi.clearAllMocks();
    // Resource mock
    vi.mock('sst', () => ({
      Resource: {
        AgentBus: { name: 'test-bus' },
      },
    }));
  });

  it('should dispatch a task to the responsible agent when a heartbeat is received', async () => {
    eventBridgeMock.on(PutEventsCommand).resolves({});

    const payload = {
      agentId: AgentType.CODER,
      task: 'Fix the bug',
      goalId: 'GOAL#123',
      userId: 'user-1',
      traceId: 'trace-abc',
      metadata: { priority: 'high' },
    };

    await handleProactiveHeartbeat(
      payload as unknown as Record<string, unknown>,
      {} as unknown as Context
    );

    expect(eventBridgeMock.commandCalls(PutEventsCommand)).toHaveLength(1);
    const call = eventBridgeMock.call(0);
    const input = call.args[0].input as PutEventsCommandInput;

    expect(input.Entries![0].DetailType).toBe(EventType.TASK_COMPLETED); // emitTaskEvent defaults to TASK_COMPLETED if no error
    const detail = JSON.parse(input.Entries![0].Detail!);

    expect(detail.agentId).toBe(AgentType.CODER);
    expect(detail.task).toBe('Fix the bug');
    expect(detail.initiatorId).toBe('SYSTEM#SCHEDULER');
    expect(detail.metadata.goalId).toBe('GOAL#123');
    expect(detail.metadata.isProactive).toBe(true);
  });

  it('should handle errors gracefully during dispatch', async () => {
    eventBridgeMock.on(PutEventsCommand).rejects(new Error('EB Down'));

    const payload = {
      agentId: AgentType.STRATEGIC_PLANNER,
      task: 'Review',
      goalId: 'GOAL#456',
    };

    // Should not throw, just log the error
    await expect(
      handleProactiveHeartbeat(
        payload as unknown as Record<string, unknown>,
        {} as unknown as Context
      )
    ).resolves.not.toThrow();
  });
});
