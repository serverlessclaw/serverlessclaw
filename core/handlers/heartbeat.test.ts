import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './heartbeat';
import {
  EventBridgeClient,
  PutEventsCommand,
  PutEventsCommandInput,
} from '@aws-sdk/client-eventbridge';
import { mockClient } from 'aws-sdk-client-mock';
import { EventType } from '../lib/types/agent';

const eventBridgeMock = mockClient(EventBridgeClient);

describe('HeartbeatHandler', () => {
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

  it('should emit a proactive heartbeat event when triggered', async () => {
    eventBridgeMock.on(PutEventsCommand).resolves({});

    const event = {
      agentId: 'test-agent',
      task: 'test-task',
      goalId: 'test-goal',
      userId: 'test-user',
      metadata: { foo: 'bar' },
    };

    await handler(event as any, {} as any);

    expect(eventBridgeMock.commandCalls(PutEventsCommand)).toHaveLength(1);
    const call = eventBridgeMock.call(0);
    const input = call.args[0].input as PutEventsCommandInput;

    expect(input.Entries![0].DetailType).toBe(EventType.HEARTBEAT_PROACTIVE);
    const detail = JSON.parse(input.Entries![0].Detail!);
    expect(detail.agentId).toBe('test-agent');
    expect(detail.goalId).toBe('test-goal');
  });

  it('should log an error and skip if mandatory fields are missing', async () => {
    // Missing task and goalId
    const event = {
      agentId: 'test-agent',
    };

    await handler(event as any, {} as any);

    expect(eventBridgeMock.commandCalls(PutEventsCommand)).toHaveLength(0);
  });
});
