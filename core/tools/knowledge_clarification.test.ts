import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { seekClarification, provideClarification } from './knowledge';
import { EventType } from '../lib/types/index';

const ebMock = mockClient(EventBridgeClient);

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    AgentBus: { name: 'test-bus' },
  },
}));

describe('Clarification Tools', () => {
  beforeEach(() => {
    ebMock.reset();
    vi.clearAllMocks();
  });

  describe('seekClarification', () => {
    it('should emit CLARIFICATION_REQUEST event', async () => {
      ebMock.on(PutEventsCommand).resolves({});

      const result = await seekClarification.execute({
        userId: 'user-1',
        question: 'What is the color of the sky?',
        originalTask: 'Design the sky',
        initiatorId: 'planner',
        traceId: 'trace-123',
        depth: 1,
      });

      expect(result).toContain('TASK_PAUSED');

      const ebCalls = ebMock.commandCalls(PutEventsCommand);
      expect(ebCalls).toHaveLength(1);

      const entry = ebCalls[0].args[0].input.Entries![0];
      expect(entry.DetailType).toBe(EventType.CLARIFICATION_REQUEST);

      const payload = JSON.parse(entry.Detail!);
      expect(payload).toMatchObject({
        userId: 'user-1',
        question: 'What is the color of the sky?',
        originalTask: 'Design the sky',
        initiatorId: 'planner',
        traceId: 'trace-123',
        depth: 2,
      });
    });

    it('should use "task" if "originalTask" is missing', async () => {
      ebMock.on(PutEventsCommand).resolves({});

      await seekClarification.execute({
        userId: 'user-1',
        question: 'Question?',
        task: 'Original Task',
      });

      const payload = JSON.parse(
        ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0].Detail!
      );
      expect(payload.originalTask).toBe('Original Task');
    });
  });

  describe('provideClarification', () => {
    it('should emit CONTINUATION_TASK event', async () => {
      ebMock.on(PutEventsCommand).resolves({});

      const result = await provideClarification.execute({
        userId: 'user-1',
        agentId: 'coder',
        answer: 'The sky is blue.',
        originalTask: 'Design the sky',
        initiatorId: 'planner',
        traceId: 'trace-123',
        depth: 5,
      });

      expect(result).toContain('Clarification provided');

      const ebCalls = ebMock.commandCalls(PutEventsCommand);
      expect(ebCalls).toHaveLength(1);

      const entry = ebCalls[0].args[0].input.Entries![0];
      expect(entry.DetailType).toBe(EventType.CONTINUATION_TASK);

      const payload = JSON.parse(entry.Detail!);
      expect(payload).toMatchObject({
        userId: 'user-1',
        agentId: 'coder',
        task: expect.stringContaining('The sky is blue.'),
        traceId: 'trace-123',
        depth: 6,
        isContinuation: true,
      });
    });
  });
});
