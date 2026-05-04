import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Context } from 'aws-lambda';
import { handler } from './heartbeat';
import {
  EventBridgeClient,
  PutEventsCommand,
  PutEventsCommandInput,
} from '@aws-sdk/client-eventbridge';
import { mockClient } from 'aws-sdk-client-mock';
import { EventType, ProactiveHeartbeatPayload } from '../lib/types/agent';

const eventBridgeMock = mockClient(EventBridgeClient);

vi.mock('sst', () => ({
  Resource: {
    AgentBus: { name: 'test-bus' },
  },
}));

describe('HeartbeatHandler', () => {
  beforeEach(() => {
    eventBridgeMock.reset();
    vi.clearAllMocks();
    // Resource mock
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

    await handler(event as unknown as ProactiveHeartbeatPayload, {} as unknown as Context);

    expect(eventBridgeMock.commandCalls(PutEventsCommand)).toHaveLength(1);
    const call = eventBridgeMock.call(0);
    const input = call.args[0].input as PutEventsCommandInput;

    expect(input.Entries![0].DetailType).toBe(EventType.HEARTBEAT_PROACTIVE);
    const detail = JSON.parse(input.Entries![0].Detail!);
    expect(detail.agentId).toBe('test-agent');
    expect(detail.goalId).toBe('test-goal');
  });

  it('should throw and report health issue if mandatory fields are missing', async () => {
    eventBridgeMock.on(PutEventsCommand).resolves({});

    // Missing task and goalId
    const event = {
      agentId: 'test-agent',
    };

    await expect(
      handler(event as unknown as ProactiveHeartbeatPayload, {} as unknown as Context)
    ).rejects.toThrow('Invalid heartbeat payload: missing mandatory fields');

    // Health report is emitted via EventBridge
    const calls = eventBridgeMock.commandCalls(PutEventsCommand);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const healthCall = calls.find(
      (c) => JSON.parse(c.args[0].input.Entries![0].Detail!).component === 'HeartbeatHandler'
    );
    expect(healthCall).toBeDefined();
  });
});
