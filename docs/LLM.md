# LLM Integration & Reasoning Adapter

Serverless Claw implements a provider-agnostic LLM interface that supports advanced 2026-grade reasoning profiles.

## Core Interface

All providers implement the `IProvider` interface:

```typescript
export interface IProvider {
  call(
    messages: Message[],
    tools?: ITool[],
    profile?: ReasoningProfile,
    model?: string
  ): Promise<Message>;
  getCapabilities(model?: string): Promise<ProviderCapabilities>;
}
```

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

### 1. OpenAI (Strategic Branching)
The **OpenAIProvider** dynamically switches between the legacy `Chat Completions` API and the modern `Responses` API depending on the model and reasoning requirements.

- **Condition**: `isReasoningModel` (includes `gpt-5.4` and `gpt-5-mini`)
- **Behavior**: Uses `/v1/responses` for all gpt-5 reasoning models to ensure consistent support for `reasoning_effort` and tool use.
- **Mapping**: Our internal `ReasoningProfile` maps to OpenAI's native `ReasoningEffort` levels (`low`, `medium`, `high`, `xhigh`).

### 2. AWS Bedrock (Thinking Budgets)
The **BedrockProvider** utilizes the `ConverseCommand` and fine-tunes Claude's "thinking" budget.

- **Mapping**:
    - `FAST`: Thinking disabled.
    - `STANDARD`: 1,024 token budget.
    - `THINKING`: 4,096 token budget.
    - `DEEP`: 32,768 token budget + max output expansion.

### 3. OpenRouter (Multi-Engine Synergy)
Supports specialized models like **GLM-5**, **MiniMax-2.5**, and **Gemini-3 Flash** using OpenRouter's standardized reasoning signals and routing preferences.

- **Route Preference**: `latency` for FAST, `fallback` (with reasoning) for others.
- **Extra Body Parameters**: Injects `plugin_id: 'reasoning'` (MiniMax) or `safety_settings` (Gemini) as needed.

---

## Observability & Debugging

Reasoning details (the "thought process") are extracted and logged at the `DEBUG` level:

```text
[Bedrock Reasoning] for claude-sonnet-4-6:
<thought>
I need to calculate the user's balance. 
First, I'll call the getTransactions tool...
</thought>
```

This ensures that even when the final output is concise, the system's underlying strategy is auditable and traceable via **Langfuse**.
