import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, DELETE, PATCH } from './route';
import { NextRequest } from 'next/server';

const mockSessionStateManagerInstance = {
  getPendingMessages: vi.fn(),
  removePendingMessage: vi.fn(),
  updatePendingMessage: vi.fn(),
};

vi.mock('@claw/core/lib/session/session-state', () => ({
  SessionStateManager: class {
    getPendingMessages = mockSessionStateManagerInstance.getPendingMessages;
    removePendingMessage = mockSessionStateManagerInstance.removePendingMessage;
    updatePendingMessage = mockSessionStateManagerInstance.updatePendingMessage;
  },
}));

describe('PendingMessages API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET', () => {
    it('should return 400 if sessionId is missing', async () => {
      const req = new NextRequest('http://localhost/api/pending-messages');
      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    it('should return pending messages', async () => {
      const messages = [{ id: '1', content: 'test' }];
      mockSessionStateManagerInstance.getPendingMessages.mockResolvedValue(messages);
      
      const req = new NextRequest('http://localhost/api/pending-messages?sessionId=s1');
      const res = await GET(req);
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.pendingMessages).toEqual(messages);
    });
  });

  describe('DELETE', () => {
    it('should return 400 if params missing', async () => {
      const req = new NextRequest('http://localhost/api/pending-messages', {
        method: 'DELETE',
        body: JSON.stringify({}),
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
    });

    it('should return 200 on success', async () => {
      mockSessionStateManagerInstance.removePendingMessage.mockResolvedValue(true);
      
      const req = new NextRequest('http://localhost/api/pending-messages', {
        method: 'DELETE',
        body: JSON.stringify({ sessionId: 's1', messageId: 'm1' }),
      });
      const res = await DELETE(req);
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should return 404 if message not found', async () => {
      mockSessionStateManagerInstance.removePendingMessage.mockResolvedValue(false);
      
      const req = new NextRequest('http://localhost/api/pending-messages', {
        method: 'DELETE',
        body: JSON.stringify({ sessionId: 's1', messageId: 'm1' }),
      });
      const res = await DELETE(req);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH', () => {
    it('should return 400 if content is invalid', async () => {
      const req = new NextRequest('http://localhost/api/pending-messages', {
        method: 'PATCH',
        body: JSON.stringify({ sessionId: 's1', messageId: 'm1', content: '  ' }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(400);
    });

    it('should return 200 on successful update', async () => {
      mockSessionStateManagerInstance.updatePendingMessage.mockResolvedValue(true);
      
      const req = new NextRequest('http://localhost/api/pending-messages', {
        method: 'PATCH',
        body: JSON.stringify({ sessionId: 's1', messageId: 'm1', content: 'new content' }),
      });
      const res = await PATCH(req);
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });
});
