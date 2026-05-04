import { describe, it, expect } from 'vitest';
import { collaborationSchema } from './schema';

describe('Collaboration Domain Tool Schemas', () => {
  const expectedToolNames = [
    'createCollaboration',
    'joinCollaboration',
    'getCollaborationContext',
    'writeToCollaboration',
    'listMyCollaborations',
    'closeCollaboration',
    'seekClarification',
    'provideClarification',
    'createWorkspace',
    'inviteMember',
    'updateMemberRole',
    'removeMember',
    'getWorkspace',
    'listWorkspaces',
    'broadcastMessage',
    'sendMessage',
    'getMessages',
  ];

  it('should export all expected tool definitions', () => {
    const keys = Object.keys(collaborationSchema);
    for (const name of expectedToolNames) {
      expect(keys).toContain(name);
    }
    expect(keys).toHaveLength(expectedToolNames.length);
  });

  it('should have required fields: name, description, parameters for every tool', () => {
    for (const [key, tool] of Object.entries(collaborationSchema)) {
      expect(tool.name, `${key} missing name`).toBeTruthy();
      expect(tool.description, `${key} missing description`).toBeTruthy();
      expect(tool.parameters, `${key} missing parameters`).toBeDefined();
    }
  });

  it('should have parameters with type "object" and properties for every tool', () => {
    for (const [key, tool] of Object.entries(collaborationSchema)) {
      expect(tool.parameters.type, `${key} parameters.type`).toBe('object');
      expect(tool.parameters.properties, `${key} parameters.properties`).toBeDefined();
      expect(typeof tool.parameters.properties, `${key} parameters.properties is object`).toBe(
        'object'
      );
    }
  });

  it('should have tool names matching their schema keys', () => {
    for (const [key, tool] of Object.entries(collaborationSchema)) {
      expect(tool.name, `key "${key}" does not match tool.name "${tool.name}"`).toBe(key);
    }
  });

  it('should have required parameter fields listed correctly', () => {
    const requiredByTool: Record<string, string[]> = {
      createCollaboration: ['name'],
      joinCollaboration: ['collaborationId'],
      getCollaborationContext: ['collaborationId'],
      writeToCollaboration: ['collaborationId', 'content'],
      listMyCollaborations: [],
      closeCollaboration: ['collaborationId'],
      seekClarification: ['question', 'originalTask'],
      provideClarification: ['agentId', 'answer', 'originalTask'],
      createWorkspace: ['name', 'ownerId', 'ownerDisplayName'],
      inviteMember: ['workspaceId', 'inviterId', 'memberId', 'type', 'displayName', 'role'],
      updateMemberRole: ['workspaceId', 'updaterId', 'targetMemberId', 'newRole'],
      removeMember: ['workspaceId', 'removerId', 'targetMemberId'],
      getWorkspace: ['workspaceId'],
      listWorkspaces: [],
      broadcastMessage: ['message'],
      sendMessage: ['message', 'userId'],
      getMessages: ['sessionId'],
    };

    for (const [name, expected] of Object.entries(requiredByTool)) {
      const tool = collaborationSchema[name];
      expect(tool).toBeDefined();
      expect(tool.parameters.required).toEqual(expected);
    }
  });

  it('should have additionalProperties: false for all tools', () => {
    for (const [key, tool] of Object.entries(collaborationSchema)) {
      expect(
        tool.parameters.additionalProperties,
        `Tool "${key}" missing additionalProperties: false`
      ).toBe(false);
    }
  });
});
