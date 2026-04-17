# LLM Integration & Reasoning Adapter

> **Navigation**: [← Index Hub](../../INDEX.md)

Serverless Claw implements a provider-agnostic LLM interface that supports advanced 2026-grade reasoning profiles.

## Core Interface

All providers implement the `IProvider` interface:

- **Interface**: `IProvider` in [`core/lib/types/llm.ts`](../../core/lib/types/llm.ts)

---

## Unified Reasoning Mapper

Instead of provider-specific logic scattered throughout the codebase, we use a **Mapper Pattern**. Each provider defines a `REASONING_MAP` that translates our logical profiles to the optimal API parameters.

### Reasoning Profile Data Flow

```text
  [ SuperClaw / Agent ]
          |
    (Choice of Profile)
    - FAST
    - STANDARD
    - THINKING
    - DEEP
          |
          v
  [ IProvider.call() ]
          |
          +-------------------------------------------+
          |                                           |
   [ Reasoning Mapper ]                      [ API Selection Logic ]
   (Translates profile to)                   (e.g. Chat vs Responses)
   - effort: 'high'                                   |
   - thinkingBudget: 32k                              |
   - temperature: 1.0                                 |
          |                                           |
          +---------------------+---------------------+
                                |
                                v
                    [ Provider API Request ]
                    - OpenAI /v1/responses
                    - Bedrock ConverseCommand
                    - OpenRouter /chat/completions
```

---

## Provider Implementations

### 1. OpenAI (Responses API Native)

The **OpenAIProvider** utilizes the modern `Responses` API for all 2026-grade reasoning and tool use.

- **Condition**: Uses `/v1/responses` for all supported models (GPT-5 family).
- **Behavior**: Ensures consistent support for `reasoning_effort`, strict tool use, and flattened message items.
- **Mapping**: Our internal `ReasoningProfile` maps to OpenAI's native `ReasoningEffort` levels (`low`, `medium`, `high`, `xhigh`). `gpt-5.4-mini` specifically supports `xhigh` reasoning effort.
- **Key Resolution (local safety)**: Provider key lookup order is `Resource.OpenAIApiKey.value` -> `OPENAI_API_KEY` -> `SST_SECRET_OpenAIApiKey`. Placeholder values such as `dummy`, `test`, and `test-key` are rejected to avoid accidental 401 calls in `make dev`.

### 2. AWS Bedrock (Thinking Budgets)

The **BedrockProvider** utilizes the `ConverseCommand` and fine-tunes Claude 4.6 (Sonnet, Haiku, Opus) "thinking" budgets.

- **Mapping**:
  - `FAST`: Thinking disabled.
  - `STANDARD`: 1,024 token budget.
  - `THINKING`: 4,096 token budget.
  - `DEEP`: 32,768 token budget + max output expansion.

### 3. OpenRouter (Multi-Engine Synergy)

Supports specialized models like **GLM-5**, **MiniMax-m2.7**, and **Gemini-3 Flash** using dynamic pattern matching on model IDs for automatic support of new high-capability models.

- **Dynamic Context Window**: The system automatically adjusts its context management strategy based on the model's reported `contextWindow` capability (e.g., 1M for Gemini-3, 200k+ for GLM/MiniMax).
- **Route Preference**: `latency` for FAST, `fallback` (with reasoning) for others. Data collection is set to `deny` for privacy.
- **Extra Body Parameters**: Injects `plugin_id: 'reasoning'` and `include_reasoning: true` (MiniMax & GLM) or `safety_settings: 'off'` (Gemini) as needed.
- **Enhanced Compatibility**:
  - **Gemini-3**: Automatically forces `response_format: { type: 'json_object' }` when JSON output is requested to ensure compatibility with Gemini's strict mode.
  - **GLM-5**: Enables interleaved reasoning and tool calling support via OpenRouter plugins.
  - **MiniMax-m2.7**: Full support for interleaved thinking and high-efficiency MoE reasoning.

---

## 🧠 Dynamic Context Strategies

Serverless Claw uses a **Model-Aware Context Engine** to optimize reasoning and cost-efficiency. Instead of a one-size-fits-all approach, the `ContextManager` adjusts its behavior based on the active model's specific capabilities.

### Strategy Mapping

The system defines specific strategies for different model families in `core/lib/agent/context-strategies.ts`:

| Model / Provider      | Max Context | Reserved for Resp | Compression Trigger | Tool Result Priority    |
| :-------------------- | :---------- | :---------------- | :------------------ | :---------------------- |
| **Claude 3.5 Sonnet** | 200,000     | 8,192             | 80%                 | **High** (Keep results) |
| **GPT-4o**            | 128,000     | 4,096             | 80%                 | **High** (Keep results) |
| **GPT-4o-mini**       | 128,000     | 4,096             | 85%                 | Normal (Compress)       |
| **Claude 3 Haiku**    | 200,000     | 4,096             | 85%                 | Normal (Compress)       |

### Intelligent Priority Scoring

The `ContextManager` performs a multi-factor priority score for every message block:

1. **Base Priority**: `SYSTEM (1.0)` > `TOOL_ERROR (0.9)` > `USER (0.8)` > `TOOL_RESULT (0.6)` > `ASSISTANT (0.4)`.
2. **Strategy Adjustment**: For high-capability models (Claude 3.5 Sonnet/GPT-4o), tool results are boosted to `0.8` to ensure the agent maintains technical state.
3. **Recency Bonus**: Newer messages receive a bonus to ensure "flow" is maintained.
4. **Length Penalty**: Extremely large message blocks (>4,000 chars) are penalized to prevent "context hijacking" by a single verbose tool output.

### Context Size Safeguard

At each iteration, the `AgentExecutor` validates the current context size. If it exceeds **90%** of the model's safety limit, it triggers an immediate "Surgical Rebuild" of the context using the strategy's priority scores to prune low-value information before the next LLM call.

### Intelligent Summarization

If the full conversation history exceeds the model's compression trigger (usually 80%), a background summarization task is triggered to distill older messages into a concise summary for future turns.

---

## 🛠️ Tool Use & Skills Integration

Serverless Claw distinguishes between local "Custom Skills" and model-native "Built-in Skills". This allows us to leverage provider superpowers like sandboxed code execution or grounded search.

### 1. Built-in Tool Pass-through

The system supports specific tool types that are requested by the provider instead of our Lambda:

- **`code_interpreter`**: Sandboxed Python execution (OpenAI).
- **`file_search`**: High-performance RAG over uploaded documents (OpenAI).
- **`web_search`**: Live internet browsing.

### 2. Specialized Model Features

We implement "Host Capability" adapters for specific model strengths:

- **Google Gemini (Grounded Search)**: Automatically enables `google_search_retrieval` when the corresponding tool type is requested.
- **Claude (Computer Use)**: Maps `computer_use` tools to the Bedrock specialized format for screen interaction and mouse control.

---

## 🖼️ Multi-Modal Intelligence

The LLM interface is fully multi-modal, supporting complex inputs and outputs beyond plain text.

### 1. Multi-Modal Inputs (`attachments`)

The `Message` interface includes an `attachments` array. This allows the system to pass:

- **Images**: Base64 or URL-based images for visual reasoning.
- **Files**: Documents for analysis (PDF, CSV, etc.).

### 2. Multi-Modal Tool Results (`ToolResult`)

Tools can return structured objects containing:

- **Text**: The primary response.
- **Images**: Charts generated by Python, screenshots from a browser, etc.
- **Metadata**: Technical logs or file references.

The **Neural Path Visualizer** in the dashboard is equipped to render these visual tool outputs directly in the trace timeline.

---

## Observability & Debugging

### Real-time Reasoning Streaming (Shared Whiteboard)

To improve transparency and multi-agent alignment, the system implements a **Shared Reasoning Whiteboard**.

1. **Extraction**: The `IProvider.stream()` method extracts intermediate reasoning tokens (e.g., OpenAI `reasoning.delta`, Bedrock `thinking` blocks, or MiniMax `thinking_delta`).
2. **Chunking**: These tokens are yielded as `thought` chunks in the `MessageChunk` interface.
3. **Broadcasting**: The `AgentEmitter` broadcasts these chunks via the `CHUNK` event with an `isThought: true` flag.
4. **Visualization**: The ClawCenter dashboard renders these thoughts in a dedicated "Thinking" sector of the chat bubble in real-time, allowing users to see the agent's strategy before the final response is formulated.

### Trace Logging

Reasoning details are also logged at the `DEBUG` level and persisted in the `MemoryTable`:

```text
[Bedrock Reasoning] for claude-sonnet-4-6:
<thought>
I need to calculate the user's balance.
First, I'll call the getTransactions tool...
</thought>
```

This ensures that even when the final output is concise, the system's underlying strategy is auditable and traceable via **Langfuse**.
