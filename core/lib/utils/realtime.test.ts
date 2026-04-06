import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-iot-data-plane', () => ({
  IoTDataPlaneClient: class {
    send = mockSend;
  },
  PublishCommand: class {
    constructor(public input: any) {}
  },
}));

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('publishToRealtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('should publish message to IoT topic', async () => {
    mockSend.mockResolvedValueOnce({});
    const { publishToRealtime } = await import('./realtime');
    await publishToRealtime('test/topic', { message: 'hello' });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('should not throw on publish failure', async () => {
    mockSend.mockRejectedValueOnce(new Error('IoT error'));
    const { publishToRealtime } = await import('./realtime');
    await expect(publishToRealtime('test/topic', {})).resolves.not.toThrow();
  });
});
