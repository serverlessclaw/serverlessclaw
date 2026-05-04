import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { logger } from '../logger';
import { getAppInfo } from './resource-helpers';

// Lazy initialization so it doesn't fail in environments without AWS credentials unless used
let iot: IoTDataPlaneClient | null = null;

export async function publishToRealtime(topic: string, payload: unknown): Promise<void> {
  if (!iot) {
    iot = new IoTDataPlaneClient({});
  }

  try {
    // SST v3 Realtime isolation requires prefixing topics with app/stage
    const { name, stage } = getAppInfo();
    const prefix = `${name}/${stage}/`;

    const fullTopic = topic.startsWith(prefix) ? topic : `${prefix}${topic}`;

    const command = new PublishCommand({
      topic: fullTopic,
      payload: Buffer.from(JSON.stringify(payload)),
      qos: 1,
    });
    await iot.send(command);
  } catch (error) {
    logger.error(`[Realtime] Failed to publish to ${topic}:`, error);
  }
}
