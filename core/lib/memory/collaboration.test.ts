import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoMemory } from './dynamo-memory';

// Mock AgentRegistry
vi.mock('../registry', () => ({
  AgentRegistry: {
    getRetentionDays: vi.fn().mockResolvedValue(30),
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
    ddbMock.on(PutCommand).resolves({});

    await memory.addCollaborationParticipant(collabId, 'agent-1', 'agent', {
      type: 'agent',
      id: 'agent-2',
      role: 'editor',
    });

    const putCalls = ddbMock.commandCalls(PutCommand);
    // 1 for updating collab metadata, 1 for new participant index
    expect(putCalls.length).toBe(2);

    const updatedCollab = putCalls.find((c) => c.args[0].input.Item?.type === 'COLLABORATION')
      ?.args[0].input.Item;
    expect(updatedCollab?.participants).toHaveLength(2);
    expect(updatedCollab?.participants.some((p: any) => p.id === 'agent-2')).toBe(true);
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
    ddbMock.on(PutCommand).resolves({});

    await memory.closeCollaboration(collabId, 'agent-1', 'agent');

    const putCall = ddbMock.commandCalls(PutCommand)[0];
    expect(putCall.args[0].input.Item?.status).toBe('closed');
  });
});
