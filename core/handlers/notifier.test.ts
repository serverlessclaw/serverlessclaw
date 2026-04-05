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

    it('should handle collaboration without workspaceId (legacy fallback)', async () => {
      mockGetCollaboration.mockResolvedValue({
        collaborationId: 'collab-legacy',
        workspaceId: null,
        participants: [
          { type: 'human', id: '123456789', role: 'owner' },
          { type: 'human', id: 'not-a-telegram-id', role: 'viewer' },
          { type: 'agent', id: 'coder', role: 'editor' },
        ],
      });

      const event = {
        detail: {
          userId: 'system',
          message: 'Legacy collab message',
          collaborationId: 'collab-legacy',
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

    it('should handle collaboration not found', async () => {
      mockGetCollaboration.mockResolvedValue(null);

      const event = {
        detail: {
          userId: 'system',
          message: 'Missing collab',
          collaborationId: 'nonexistent',
        },
      } as any;

      await handler(event);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle collaboration fan-out error gracefully', async () => {
      mockGetCollaboration.mockRejectedValue(new Error('DB error'));

      const event = {
        detail: {
          userId: 'system',
          message: 'Error collab',
          collaborationId: 'collab-error',
        },
      } as any;

      await expect(handler(event)).resolves.not.toThrow();
    });

    it('should skip disabled channels in collaboration', async () => {
      mockGetCollaboration.mockResolvedValue({
        collaborationId: 'collab-disabled',
        workspaceId: 'ws-1',
        participants: [{ type: 'human', id: 'human-disabled', role: 'owner' }],
      });

      mockGetWorkspace.mockResolvedValue({ workspaceId: 'ws-1' });
      mockGetHumanMembersWithChannels.mockReturnValue([
        {
          memberId: 'human-disabled',
          channels: [
            { platform: 'telegram', identifier: 'tg-111', enabled: false },
            { platform: 'telegram', identifier: 'tg-222', enabled: true },
          ],
        },
      ]);

      const event = {
        detail: {
          userId: 'system',
          message: 'Disabled channel test',
          collaborationId: 'collab-disabled',
        },
      } as any;

      await handler(event);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.chat_id).toBe('tg-222');
    });
  });

  describe('Single User Path', () => {
    it('should not send to non-telegram userId', async () => {
      const event = {
        detail: {
          userId: 'user-abc123',
          message: 'Hello',
        },
      } as any;

      await handler(event);

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Channel Routing', () => {
    it('should warn for unsupported platform', async () => {
      const { handler } = await import('./notifier');
      const { logger } = await import('../lib/logger');

      mockGetWorkspace.mockResolvedValue({ workspaceId: 'ws-unsupported' });
      mockGetHumanMembersWithChannels.mockReturnValue([
        {
          memberId: 'human-1',
          channels: [{ platform: 'email', identifier: 'user@example.com', enabled: true }],
        },
      ]);

      const event = {
        detail: {
          userId: 'system',
          message: 'Unsupported platform test',
          workspaceId: 'ws-unsupported',
        },
      } as any;

      await handler(event);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unsupported platform: email')
      );
    });

    it('should handle delivery error for a channel gracefully', async () => {
      const { logger } = await import('../lib/logger');

      mockGetWorkspace.mockResolvedValue({ workspaceId: 'ws-error-channel' });
      mockGetHumanMembersWithChannels.mockReturnValue([
        {
          memberId: 'human-1',
          channels: [{ platform: 'telegram', identifier: 'tg-err', enabled: true }],
        },
      ]);

      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const event = {
        detail: {
          userId: 'system',
          message: 'Channel error test',
          workspaceId: 'ws-error-channel',
        },
      } as any;

      await handler(event);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Delivery failed for telegram (tg-err)'),
        expect.any(Error)
      );
    });
  });

  describe('Telegram Delivery', () => {
    it('should throw when Telegram token is not configured', async () => {
      vi.doMock('sst', () => ({
        Resource: {
          TelegramBotToken: { value: undefined },
          DiscordBotToken: { value: 'ds-token' },
          SlackBotToken: { value: 'sl-token' },
        },
      }));

      const event = {
        detail: {
          userId: '123456789',
          message: 'No token',
        },
      } as any;

      await handler(event);
    });

    it('should send image attachment to Telegram', async () => {
      const { AttachmentType } = await import('../lib/types/llm');

      const event = {
        detail: {
          userId: '123456789',
          message: 'Check this image',
          attachments: [
            {
              type: AttachmentType.IMAGE,
              url: 'https://example.com/image.png',
              name: 'image.png',
            },
          ],
        },
      } as any;

      await handler(event);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('sendPhoto'),
        expect.objectContaining({
          body: expect.stringContaining('"photo":"https://example.com/image.png"'),
        })
      );
    });

    it('should send document attachment to Telegram', async () => {
      const { AttachmentType } = await import('../lib/types/llm');

      const event = {
        detail: {
          userId: '123456789',
          message: 'Check this doc',
          attachments: [
            {
              type: AttachmentType.FILE,
              url: 'https://example.com/doc.pdf',
              name: 'doc.pdf',
            },
          ],
        },
      } as any;

      await handler(event);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('sendDocument'),
        expect.objectContaining({
          body: expect.stringContaining('"document":"https://example.com/doc.pdf"'),
        })
      );
    });

    it('should skip attachments without URL', async () => {
      const { AttachmentType } = await import('../lib/types/llm');

      const event = {
        detail: {
          userId: '123456789',
          message: 'Message with bad attachment',
          attachments: [
            {
              type: AttachmentType.IMAGE,
              url: undefined as any,
              name: 'bad.png',
            },
          ],
        },
      } as any;

      await handler(event);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should send Telegram message with inline keyboard options', async () => {
      const event = {
        detail: {
          userId: '123456789',
          message: 'Choose an option',
          options: [
            { label: 'Yes', value: 'yes_action' },
            { label: 'No', value: 'no_action' },
          ],
        },
      } as any;

      await handler(event);

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.reply_markup.inline_keyboard).toBeDefined();
      expect(body.reply_markup.inline_keyboard[0]).toHaveLength(2);
      expect(body.reply_markup.inline_keyboard[0][0]).toEqual({
        text: 'Yes',
        callback_data: 'yes_action',
      });
    });
  });

  describe('Discord Delivery', () => {
    it('should throw when Discord token is not configured', async () => {
      mockGetWorkspace.mockResolvedValue({ workspaceId: 'ws-no-discord' });
      mockGetHumanMembersWithChannels.mockReturnValue([
        {
          memberId: 'human-1',
          channels: [{ platform: 'discord', identifier: 'ch-123', enabled: true }],
        },
      ]);

      vi.resetModules();
      vi.doMock('sst', () => ({
        Resource: {
          TelegramBotToken: { value: 'tg-token' },
          DiscordBotToken: { value: undefined },
          SlackBotToken: { value: 'sl-token' },
        },
      }));
    });

    it('should send Discord message with image embeds', async () => {
      const { AttachmentType } = await import('../lib/types/llm');

      mockGetWorkspace.mockResolvedValue({ workspaceId: 'ws-discord-img' });
      mockGetHumanMembersWithChannels.mockReturnValue([
        {
          memberId: 'human-1',
          channels: [{ platform: 'discord', identifier: 'ch-img', enabled: true }],
        },
      ]);

      const event = {
        detail: {
          userId: 'system',
          message: 'Check this image',
          workspaceId: 'ws-discord-img',
          attachments: [
            {
              type: AttachmentType.IMAGE,
              url: 'https://example.com/image.png',
              name: 'image.png',
            },
          ],
        },
      } as any;

      await handler(event);

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.embeds).toBeDefined();
      expect(body.embeds[0].image).toEqual({ url: 'https://example.com/image.png' });
    });

    it('should send Discord message with document attachment', async () => {
      const { AttachmentType } = await import('../lib/types/llm');

      mockGetWorkspace.mockResolvedValue({ workspaceId: 'ws-discord-doc' });
      mockGetHumanMembersWithChannels.mockReturnValue([
        {
          memberId: 'human-1',
          channels: [{ platform: 'discord', identifier: 'ch-doc', enabled: true }],
        },
      ]);

      const event = {
        detail: {
          userId: 'system',
          message: 'Check this doc',
          workspaceId: 'ws-discord-doc',
          attachments: [
            {
              type: AttachmentType.FILE,
              url: 'https://example.com/doc.pdf',
              name: 'report.pdf',
            },
          ],
        },
      } as any;

      await handler(event);

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.embeds).toBeDefined();
      expect(body.embeds[0].url).toBe('https://example.com/doc.pdf');
      expect(body.embeds[0].title).toBe('report.pdf');
    });

    it('should send Discord message with button components', async () => {
      mockGetWorkspace.mockResolvedValue({ workspaceId: 'ws-discord-btn' });
      mockGetHumanMembersWithChannels.mockReturnValue([
        {
          memberId: 'human-1',
          channels: [{ platform: 'discord', identifier: 'ch-btn', enabled: true }],
        },
      ]);

      const event = {
        detail: {
          userId: 'system',
          message: 'Click a button',
          workspaceId: 'ws-discord-btn',
          options: [
            { label: 'Approve', value: 'approve' },
            { label: 'Reject', value: 'reject' },
          ],
        },
      } as any;

      await handler(event);

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.components).toBeDefined();
      expect(body.components[0].type).toBe(1);
      expect(body.components[0].components).toHaveLength(2);
      expect(body.components[0].components[0]).toEqual({
        type: 2,
        style: 1,
        label: 'Approve',
        custom_id: 'approve',
      });
    });

    it('should filter attachments without URL for Discord', async () => {
      const { AttachmentType } = await import('../lib/types/llm');

      mockGetWorkspace.mockResolvedValue({ workspaceId: 'ws-discord-nourl' });
      mockGetHumanMembersWithChannels.mockReturnValue([
        {
          memberId: 'human-1',
          channels: [{ platform: 'discord', identifier: 'ch-nourl', enabled: true }],
        },
      ]);

      const event = {
        detail: {
          userId: 'system',
          message: 'Message with bad attachment',
          workspaceId: 'ws-discord-nourl',
          attachments: [
            {
              type: AttachmentType.IMAGE,
              url: undefined as any,
              name: 'bad.png',
            },
          ],
        },
      } as any;

      await handler(event);

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.embeds).toBeUndefined();
    });
  });

  describe('Slack Delivery', () => {
    it('should throw when Slack token is not configured', async () => {
      mockGetWorkspace.mockResolvedValue({ workspaceId: 'ws-no-slack' });
      mockGetHumanMembersWithChannels.mockReturnValue([
        {
          memberId: 'human-1',
          channels: [{ platform: 'slack', identifier: 'ch-slack', enabled: true }],
        },
      ]);

      vi.resetModules();
      vi.doMock('sst', () => ({
        Resource: {
          TelegramBotToken: { value: 'tg-token' },
          DiscordBotToken: { value: 'ds-token' },
          SlackBotToken: { value: undefined },
        },
      }));
    });

    it('should send Slack message with image attachment block', async () => {
      const { AttachmentType } = await import('../lib/types/llm');

      mockGetWorkspace.mockResolvedValue({ workspaceId: 'ws-slack-img' });
      mockGetHumanMembersWithChannels.mockReturnValue([
        {
          memberId: 'human-1',
          channels: [{ platform: 'slack', identifier: 'ch-slack-img', enabled: true }],
        },
      ]);

      const event = {
        detail: {
          userId: 'system',
          message: 'Check this image',
          workspaceId: 'ws-slack-img',
          attachments: [
            {
              type: AttachmentType.IMAGE,
              url: 'https://example.com/image.png',
              name: 'screenshot.png',
            },
          ],
        },
      } as any;

      await handler(event);

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.blocks).toHaveLength(2);
      expect(body.blocks[1]).toEqual({
        type: 'image',
        image_url: 'https://example.com/image.png',
        alt_text: 'screenshot.png',
      });
    });

    it('should send Slack message with non-image attachment block', async () => {
      const { AttachmentType } = await import('../lib/types/llm');

      mockGetWorkspace.mockResolvedValue({ workspaceId: 'ws-slack-doc' });
      mockGetHumanMembersWithChannels.mockReturnValue([
        {
          memberId: 'human-1',
          channels: [{ platform: 'slack', identifier: 'ch-slack-doc', enabled: true }],
        },
      ]);

      const event = {
        detail: {
          userId: 'system',
          message: 'Check this doc',
          workspaceId: 'ws-slack-doc',
          attachments: [
            {
              type: AttachmentType.FILE,
              url: 'https://example.com/report.pdf',
              name: 'monthly-report.pdf',
            },
          ],
        },
      } as any;

      await handler(event);

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.blocks).toHaveLength(2);
      expect(body.blocks[1]).toEqual({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Attachment:* <https://example.com/report.pdf|monthly-report.pdf>',
        },
      });
    });

    it('should send Slack message with non-image attachment without name', async () => {
      const { AttachmentType } = await import('../lib/types/llm');

      mockGetWorkspace.mockResolvedValue({ workspaceId: 'ws-slack-noname' });
      mockGetHumanMembersWithChannels.mockReturnValue([
        {
          memberId: 'human-1',
          channels: [{ platform: 'slack', identifier: 'ch-slack-noname', enabled: true }],
        },
      ]);

      const event = {
        detail: {
          userId: 'system',
          message: 'Check this link',
          workspaceId: 'ws-slack-noname',
          attachments: [
            {
              type: AttachmentType.FILE,
              url: 'https://example.com/link',
              name: undefined,
            },
          ],
        },
      } as any;

      await handler(event);

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.blocks).toHaveLength(2);
      expect(body.blocks[1].text.text).toContain('|Link>');
    });

    it('should send Slack message with action buttons', async () => {
      mockGetWorkspace.mockResolvedValue({ workspaceId: 'ws-slack-actions' });
      mockGetHumanMembersWithChannels.mockReturnValue([
        {
          memberId: 'human-1',
          channels: [{ platform: 'slack', identifier: 'ch-slack-actions', enabled: true }],
        },
      ]);

      const event = {
        detail: {
          userId: 'system',
          message: 'Take action',
          workspaceId: 'ws-slack-actions',
          options: [
            { label: 'Approve', value: 'approve' },
            { label: 'Reject', value: 'reject' },
          ],
        },
      } as any;

      await handler(event);

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      const actionsBlock = body.blocks.find((b: any) => b.type === 'actions');
      expect(actionsBlock).toBeDefined();
      expect(actionsBlock.elements).toHaveLength(2);
      expect(actionsBlock.elements[0].text.text).toBe('Approve');
      expect(actionsBlock.elements[0].value).toBe('approve');
      expect(actionsBlock.elements[0].action_id).toMatch(/^act_/);
    });

    it('should handle image attachment without URL in Slack', async () => {
      const { AttachmentType } = await import('../lib/types/llm');

      mockGetWorkspace.mockResolvedValue({ workspaceId: 'ws-slack-nourl' });
      mockGetHumanMembersWithChannels.mockReturnValue([
        {
          memberId: 'human-1',
          channels: [{ platform: 'slack', identifier: 'ch-slack-nourl', enabled: true }],
        },
      ]);

      const event = {
        detail: {
          userId: 'system',
          message: 'Message with bad attachment',
          workspaceId: 'ws-slack-nourl',
          attachments: [
            {
              type: AttachmentType.IMAGE,
              url: undefined as any,
              name: 'bad.png',
            },
          ],
        },
      } as any;

      await handler(event);

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.blocks).toHaveLength(1);
    });
  });

  describe('Memory Sync', () => {
    it('should handle memory sync failure gracefully', async () => {
      mockAddMessage.mockRejectedValueOnce(new Error('DynamoDB error'));

      const event = {
        detail: {
          userId: '123456789',
          message: 'Memory error test',
          memoryContexts: ['CTX#1'],
          sessionId: 'session-1',
        },
      } as any;

      await expect(handler(event)).resolves.not.toThrow();
    });

    it('should sync multiple contexts including base userId and session', async () => {
      const event = {
        detail: {
          userId: '123456789',
          message: 'Multi-context',
          memoryContexts: ['CTX#A', 'CTX#B'],
          sessionId: 'sess-1',
        },
      } as any;

      await handler(event);

      expect(mockAddMessage).toHaveBeenCalledTimes(4);
      expect(mockAddMessage).toHaveBeenCalledWith('CTX#A', expect.any(Object));
      expect(mockAddMessage).toHaveBeenCalledWith('CTX#B', expect.any(Object));
      expect(mockAddMessage).toHaveBeenCalledWith('123456789', expect.any(Object));
      expect(mockAddMessage).toHaveBeenCalledWith('CONV#123456789#sess-1', expect.any(Object));
    });
  });

  describe('Validation', () => {
    it('should reject event with missing userId', async () => {
      const event = {
        detail: {
          message: 'No user',
        },
      } as any;

      await handler(event);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should reject event with missing message', async () => {
      const event = {
        detail: {
          userId: '123456789',
        },
      } as any;

      await handler(event);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should reject event with empty detail', async () => {
      const event = {
        detail: null,
      } as any;

      await handler(event);

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
