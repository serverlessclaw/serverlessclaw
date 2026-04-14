import { describe, it, expect } from 'vitest';
import { TaskNodeData } from './collaboration-utils';

describe('Collaboration Attachments Logic', () => {
  it('should correctly handle TaskNodeData with attachments', () => {
    const task: TaskNodeData = {
      taskId: 'task-123',
      label: 'test-task',
      agentId: 'coder',
      status: 'completed',
      task: 'Fix the bug',
      attachments: [
        { type: 'image', name: 'screenshot.png', url: 'https://s3.amazonaws.com/bucket/1.png' },
        { type: 'file', name: 'logs.txt', url: 'https://s3.amazonaws.com/bucket/logs.txt' }
      ]
    };

    expect(task.attachments).toBeDefined();
    expect(task.attachments?.length).toBe(2);
    expect(task.attachments?.[0].name).toBe('screenshot.png');
  });

  it('should handle missing attachments gracefully', () => {
    const task: TaskNodeData = {
      taskId: 'task-456',
      label: 'test-task-no-files',
      agentId: 'coder',
      status: 'pending',
      task: 'Analyze code',
    };

    expect(task.attachments).toBeUndefined();
  });
});
