# Real-time Multi-Agent Signaling

> **Last Updated**: 23 March 2026

To ensure the **ClawCenter Dashboard** receives instantaneous updates without polling, Serverless Claw uses a **Real-time Bridge** pattern over AWS IoT Core and MQTT.

## Signaling Architecture

```text
 [ Agent / Handler ]
          |
   (Publish Event)
          |
          v
 [ AgentBus (EventBridge) ]
          |
      (Rule Match)
          |
          v
 [ Realtime Bridge (Lambda) ]
          |
   (re-wrap & publish)
          |
          v
 [ AWS IoT Core (MQTT) ] ----> [ Dashboard (React Flow) ]
  (Topic: users/{id}/signal)      (Instant Neural Pulse)
```

## Key Components

1. **IoT Core (MQTT)**: Acts as the low-latency message broker for telemetry and signal data.
2. **Real-time Bridge**: A lightweight Lambda that reformats internal EventBridge events into MQTT-compatible payloads.
3. **MQTT Bridge (ClawCenter)**: The Next.js dashboard uses `aws-iot-device-sdk-v2` to maintain a persistent WebSocket connection to IoT Core.

## Performance
- **Latency**: Sub-100ms from Lambda execution to Dashboard visualization.
- **Scale**: Leverages AWS IoT Core's managed scale to support multiple concurrent dashboard operators.
