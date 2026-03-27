import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

// Mock the core memory module
vi.mock('@claw/core/lib/memory', () => {
  return {
    DynamoMemory: class {
      updateGapStatus = vi.fn().mockResolvedValue({ success: true });
    }
  };
});

// Mock the core types module
vi.mock('@claw/core/lib/types', () => {
  return {
    GapStatus: {
      OPEN: 'OPEN',
      PLANNED: 'PLANNED',
      PROGRESS: 'PROGRESS',
      DEPLOYED: 'DEPLOYED',
      DONE: 'DONE',
      FAILED: 'FAILED',
      ARCHIVED: 'ARCHIVED',
    },
  };
});

// Mock @/lib/constants
vi.mock('@/lib/constants', () => ({
  HTTP_STATUS: {
    BAD_REQUEST: 400,
    INTERNAL_SERVER_ERROR: 500,
    OK: 200,
  }
}));

describe('Dashboard API: /api/memory/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 if gapId or status is missing', async () => {
    const req = {
      json: vi.fn().mockResolvedValue({}),
    } as unknown as NextRequest;

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('Validation failed');
  });

  it('should return 400 if status is invalid', async () => {
    const req = {
      json: vi.fn().mockResolvedValue({ gapId: 'GAP#123', status: 'INVALID_STATUS' }),
    } as unknown as NextRequest;

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('Validation failed');
    expect(data.error).toContain('status');
  });

  it('should return 200 and call updateGapStatus if request is valid', async () => {
    const req = {
      json: vi.fn().mockResolvedValue({ gapId: 'GAP#123', status: 'PLANNED' }),
    } as unknown as NextRequest;

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
  });
});
