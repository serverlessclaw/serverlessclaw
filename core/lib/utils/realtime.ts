import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { logger } from '../logger';

// Lazy initialization so it doesn't fail in environments without AWS credentials unless used
let iot: IoTDataPlaneClient | null = null;

export async function publishToRealtime(topic: string, payload: unknown): Promise<void> {
  if (!iot) {
    iot = new IoTDataPlaneClient({});
  }

  try {
    const command = new PublishCommand({
      topic,
      payload: Buffer.from(JSON.stringify(payload)),
      qos: 1,
    });
    await iot.send(command);
  } catch (error) {
    logger.error(`[Realtime] Failed to publish to ${topic}:`, error);
  }
}
