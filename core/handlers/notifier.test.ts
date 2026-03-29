import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAddMessage } = vi.hoisted(() => ({
  mockAddMessage: vi.fn().mockResolvedValue(true),
}));

const { mockGetWorkspace, mockGetHumanMembersWithChannels } = vi.hoisted(() => ({
  mockGetWorkspace: vi.fn(),
  mockGetHumanMembersWithChannels: vi.fn(),
}));

const { mockGetCollaboration } = vi.hoisted(() => ({
  mockGetCollaboration: vi.fn(),
}));

// Mock sst Resource BEFORE other imports
vi.mock('sst', () => ({
  Resource: {
    TelegramBotToken: { value: 'tg-token' },
    DiscordBotToken: { value: 'ds-token' },
    SlackBotToken: { value: 'sl-token' },
  },
}));

// Mock dependencies
vi.mock('../lib/memory', () => ({
  DynamoMemory: vi.fn().mockImplementation(function () {
    return {
      addMessage: mockAddMessage,
    };
  }),
}));

vi.mock('../lib/memory/workspace-operations', () => ({
  getWorkspace: mockGetWorkspace,
  getHumanMembersWithChannels: mockGetHumanMembersWithChannels,
}));

vi.mock('../lib/memory/collaboration-operations', () => ({
  getCollaboration: mockGetCollaboration,
}));

import { handler } from './notifier';

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock global fetch
global.fetch = vi.fn();

describe('Notifier Handler — Multi-Platform', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddMessage.mockResolvedValue(true);
    (global.fetch as any).mockResolvedValue({ ok: true, text: () => Promise.resolve('ok') });
  });

  describe('Telegram (Direct)', () => {
    it('should send to Telegram for numeric userId', async () => {
      const event = {
        detail: {
          userId: '123456789',
          message: 'Hello Telegram',
        },
      } as any;

      await handler(event);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('api.telegram.org/bottg-token/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('"chat_id":"123456789"'),
        })
      );
    });
  });

  describe('Discord (Workspace)', () => {
    it('should fan-out to Discord members', async () => {
      const mockWorkspace = { workspaceId: 'ws-1', members: [] };
      mockGetWorkspace.mockResolvedValue(mockWorkspace);
      mockGetHumanMembersWithChannels.mockReturnValue([
        {
          memberId: 'human-1',
          channels: [{ platform: 'discord', identifier: 'channel-123', enabled: true }],
        },
      ]);

      const event = {
        detail: {
          userId: 'system',
          message: 'Hello Discord',
          workspaceId: 'ws-1',
        },
      } as any;

      await handler(event);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('discord.com/api/v10/channels/channel-123/messages'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bot ds-token',
          }),
          body: expect.stringContaining('"content":"Hello Discord"'),
        })
      );
    });
  });

  describe('Slack (Workspace)', () => {
    it('should fan-out to Slack members with blocks', async () => {
      const mockWorkspace = { workspaceId: 'ws-1', members: [] };
      mockGetWorkspace.mockResolvedValue(mockWorkspace);
      mockGetHumanMembersWithChannels.mockReturnValue([
        {
          memberId: 'human-2',
          channels: [{ platform: 'slack', identifier: 'SLACK_CH_ID', enabled: true }],
        },
      ]);

      const event = {
        detail: {
          userId: 'system',
          message: 'Hello Slack',
          workspaceId: 'ws-1',
          options: [{ label: 'Approve', value: 'approve_id' }],
        },
      } as any;

      await handler(event);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://slack.com/api/chat.postMessage',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sl-token',
          }),
          body: expect.stringContaining('"channel":"SLACK_CH_ID"'),
        })
      );

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.blocks).toBeDefined();
      expect(body.blocks[0].text.text).toBe('Hello Slack');
      expect(body.blocks[1].type).toBe('actions');
    });
  });

  describe('Multi-Platform Fan-out', () => {
    it('should deliver to multiple platforms in a single workspace', async () => {
      mockGetWorkspace.mockResolvedValue({ workspaceId: 'ws-multi' });
      mockGetHumanMembersWithChannels.mockReturnValue([
        {
          memberId: 'human-multi',
          channels: [
            { platform: 'telegram', identifier: 'tg-123', enabled: true },
            { platform: 'discord', identifier: 'ds-456', enabled: true },
          ],
        },
      ]);

      const event = {
        detail: {
          userId: 'system',
          message: 'Multi-platform msg',
          workspaceId: 'ws-multi',
        },
      } as any;

      await handler(event);

      expect(global.fetch).toHaveBeenCalledTimes(2);
      const calls = (global.fetch as any).mock.calls;
      expect(calls.some((c: any) => c[0].includes('telegram'))).toBe(true);
      expect(calls.some((c: any) => c[0].includes('discord'))).toBe(true);
    });
  });

  describe('Collaboration Fan-out', () => {
    it('should fan-out to human participants of a collaboration', async () => {
      mockGetCollaboration.mockResolvedValue({
        collaborationId: 'collab-123',
        workspaceId: 'ws-1',
        participants: [
          { type: 'human', id: 'human-1', role: 'owner' },
          { type: 'agent', id: 'coder', role: 'editor' },
        ],
      });

      mockGetWorkspace.mockResolvedValue({ workspaceId: 'ws-1' });
      mockGetHumanMembersWithChannels.mockReturnValue([
        {
          memberId: 'human-1',
          channels: [{ platform: 'telegram', identifier: 'tg-999', enabled: true }],
        },
      ]);

      const event = {
        detail: {
          userId: 'system',
          message: 'Collab message',
          collaborationId: 'collab-123',
        },
      } as any;

      await handler(event);

      expect(mockGetCollaboration).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('api.telegram.org/bottg-token/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('"chat_id":"tg-999"'),
        })
      );
    });
  });
});
