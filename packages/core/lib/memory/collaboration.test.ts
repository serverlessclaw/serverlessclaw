import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoMemory } from './dynamo-memory';

// Mock AgentRegistry
vi.mock('../registry', () => ({
  AgentRegistry: {
    getRetentionDays: vi.fn().mockResolvedValue(30),
    getAgentConfig: vi.fn().mockResolvedValue({ enabled: true }),
  },
}));

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
    ConfigTable: { name: 'test-config-table' },
  },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('DynamoMemory Collaboration', () => {
  let memory: DynamoMemory;

  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
    memory = new DynamoMemory();
  });

  it('should create a collaboration', async () => {
    ddbMock.on(PutCommand).resolves({});

    const input = {
      name: 'Test Collab',
      description: 'Testing',
      ttlDays: 7,
    };

    const collab = await memory.createCollaboration('agent-1', 'agent', input);

    expect(collab).toBeDefined();
    expect(collab.name).toBe('Test Collab');
    expect(collab.owner.id).toBe('agent-1');
    expect(collab.participants).toHaveLength(1);
    expect(collab.participants[0].id).toBe('agent-1');

    const calls = ddbMock.commandCalls(PutCommand);
    // 1 for collab metadata, 1 for owner index
    expect(calls.length).toBeGreaterThanOrEqual(2);

    const collabItem = calls.find((c) => c.args[0].input.Item?.type === 'COLLABORATION')?.args[0]
      .input.Item;
    expect(collabItem?.userId).toContain('COLLAB#');

    const indexItem = calls.find((c) => c.args[0].input.Item?.type === 'COLLABORATION_INDEX')
      ?.args[0].input.Item;
    expect(indexItem?.userId).toBe('COLLAB_INDEX#agent#agent-1');
  });

  it('should add a participant', async () => {
    const collabId = 'collab-123';
    const existingCollab = {
      collaborationId: collabId,
      name: 'Test Collab',
      participants: [{ type: 'agent', id: 'agent-1', role: 'owner' }],
      status: 'active',
      syntheticUserId: 'shared#collab#collab-123',
    };

    ddbMock.on(QueryCommand).resolves({ Items: [existingCollab] });
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    await memory.addCollaborationParticipant(collabId, 'agent-1', 'agent', {
      type: 'agent',
      id: 'agent-2',
      role: 'editor',
    });

    // 1 for updating collab metadata (UpdateCommand), 1 for new participant index (PutCommand)
    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    const putCalls = ddbMock.commandCalls(PutCommand);
    expect(updateCalls.length).toBe(1);
    expect(putCalls.length).toBe(1);

    const indexItem = putCalls[0].args[0].input.Item;
    expect(indexItem?.userId).toBe('COLLAB_INDEX#agent#agent-2');
  });

  it('should list collaborations for participant', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { collaborationId: 'c1', role: 'owner', collaborationName: 'Collab 1' },
        { collaborationId: 'c2', role: 'editor', collaborationName: 'Collab 2' },
      ],
    });

    const list = await memory.listCollaborationsForParticipant('agent-1', 'agent');

    expect(list).toHaveLength(2);
    expect(list[0].collaborationId).toBe('c1');
    expect(list[1].collaborationId).toBe('c2');
  });

  it('should check collaboration access', async () => {
    const collabId = 'collab-123';
    const existingCollab = {
      collaborationId: collabId,
      participants: [
        { type: 'agent', id: 'agent-1', role: 'owner' },
        { type: 'agent', id: 'agent-2', role: 'viewer' },
      ],
      status: 'active',
    };

    ddbMock.on(QueryCommand).resolves({ Items: [existingCollab] });

    // Owner should have access
    const hasOwnerAccess = await memory.checkCollaborationAccess(collabId, 'agent-1', 'agent');
    expect(hasOwnerAccess).toBe(true);

    // Viewer should have access for general check
    const hasViewerAccess = await memory.checkCollaborationAccess(collabId, 'agent-2', 'agent');
    expect(hasViewerAccess).toBe(true);

    // Viewer should NOT have editor access
    const hasEditorAccess = await memory.checkCollaborationAccess(
      collabId,
      'agent-2',
      'agent',
      'editor'
    );
    expect(hasEditorAccess).toBe(false);

    // Non-participant should NOT have access
    const hasNonParticipantAccess = await memory.checkCollaborationAccess(
      collabId,
      'agent-3',
      'agent'
    );
    expect(hasNonParticipantAccess).toBe(false);
  });

  it('should close a collaboration', async () => {
    const collabId = 'collab-123';
    const existingCollab = {
      collaborationId: collabId,
      participants: [{ type: 'agent', id: 'agent-1', role: 'owner' }],
      status: 'active',
    };

    ddbMock.on(QueryCommand).resolves({ Items: [existingCollab] });
    ddbMock.on(UpdateCommand).resolves({});

    await memory.closeCollaboration(collabId, 'agent-1', 'agent');

    const updateCall = ddbMock.commandCalls(UpdateCommand)[0];
    expect(updateCall.args[0].input.UpdateExpression).toContain('#status = :closed');
  });
});
