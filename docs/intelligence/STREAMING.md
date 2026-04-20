# Streaming Reasoning & Real-time Signal Flow

This document details the architectural flow for real-time message streaming and reasoning (thinking) within SuperClaw. It explains how high-latency reasoning models (like OpenAI GPT 5 or Claude 4.5) provide immediate feedback to the user via the IoT Real-time Bus.

## Architecture Diagram

```text
[ USER INPUT ]
      |
      v
[ Dashboard API Route (/api/chat) ]
      |
      v
[ core/Agent.stream() ]
      |
      v
[ core/StreamingExecutor.streamLoop() ]
      |
      |--- 1. Initialise Tracer & Emitter
      |--- 2. Manage Model Context
      |--- 3. Emit LLM_CALL Trace Step
      |--- 4. Iterate over LLM Chunks
      v
[ core/LLM Provider.stream() ] ---- (chunks: content | thought | tool_calls) ----+
      ^                                                                         |
      |                                                                         |
      +-------------------------------------------------------------------------+
                                      |
                                      v
                        [ StreamingExecutor ]
                                      |
                    +-----------------+-----------------+
                    |                                   |
          ( Internal State )                   ( External Signal )
          accumulate fullContent                [ AgentEmitter.emitChunk() ]
          accumulate fullThought                       |
                                                       v
                                            [ AWS IoT Realtime Bus ]
                                                       |
                                                       v (MQTT Topic: users/{id}/signal)
                                                       |
                                            [ Dashboard UI (useChatConnection) ]
                                                       |
                                                       v
                                            [ message-handler.applyChunkToMessages() ]
                                                       |
                                                       v
                                            [ ChatMessageList / ChatMessageRow ]
                                              ( Render Content & Thought Card )
```

## Key Components

### 1. StreamingExecutor (`core/lib/agent/executor/streaming-executor.ts`)
The `StreamingExecutor` is the heart of the streaming logic. It:
- Prefaces reasoning with a synthetic thinking marker (`\u2026`) to trigger UI indicators immediately.
- Records an explicit `LLM_CALL` trace step with model and provider metadata before streaming begins.
- Forwards `content` and `thought` deltas to the `AgentEmitter` as they arrive from the LLM.
- Records the final `LLM_RESPONSE` trace step once the stream is complete.
- Accumulates the full response for tracing and semantic loop detection.
- Handles tool call execution and emits progress signals (e.g., "I am executing: list_files...").

### 2. AgentEmitter (`core/lib/agent/emitter.ts`)
The `AgentEmitter` standardises outgoing signals.
- **Root vs Worker**: It distinguishes between root agents (SuperClaw) and worker agents. Worker feedback can be toggled via `worker_feedback_enabled` config.
- **MQTT Routing**: Publishes to `users/{userId}/sessions/{sessionId}/signal` for precise delivery to the active chat session.
- **Payload Structure**: Packages `thought` deltas, `message` deltas, and `ui_blocks` into a unified MQTT payload.

### 3. Message Handler (`dashboard/src/components/Chat/message-handler.ts`)
On the frontend, the `message-handler` performs real-time merging:
- **Deduplication**: Uses `messageId` and content hashes to prevent "double-bubble" issues when history synchronisation overlaps with real-time chunks.
- **State Management**: Manages the `isThinking` boolean state based on incoming signal types (`TEXT_MESSAGE_CONTENT` vs `outbound_message`).
- **Thought Accumulation**: Appends thought deltas into the `thought` field of the message object.

### 4. Chat UI (`dashboard/src/components/Chat/ChatMessageList.tsx`)
Individual message rows render the thinking process:
- **Thought Card**: A dedicated glassmorphism card with a terminal icon (`Terminal`) displays the `thought` field.
- **Analysing Indicator**: When `isThinking` is true, a pulsating "Analysing Signal..." loader is displayed until the first content chunk or final message arrives.

## Signal Types

| Type | Description |
| :--- | :--- |
| `TEXT_MESSAGE_CONTENT` | A delta chunk of content or thought. |
| `outbound_message` | The final, ground-truth message emitted at the end of the loop. |
| `chunk` | Legacy/generic data chunk. |
| `TEXT_MESSAGE_START` | Initial signal to spawn the message UI (used by some providers). |
| `TEXT_MESSAGE_END` | Signal that the specific text stream is complete. |
