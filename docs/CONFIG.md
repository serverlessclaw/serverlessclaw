# System Configuration Reference

> [!IMPORTANT]
> **Single Source of Truth**: The technical definitions, implications, and risks outlined here are programmatically managed in [metadata.ts](../core/lib/metadata.ts). Both the ClawCenter UI and SuperClaw's reasoning engine consume this metadata directly to ensure absolute consistency.

This document outlines the system-wide configuration keys available in the `ConfigTable` (DynamoDB) and their mechanical implications.

## Configuration Keys

### `deploy_limit`
- **Default**: 5 (deployments per UTC day)
- **Hard Cap**: 100
- **Purpose**: Prevents runaway costs and instability by limiting how many times the autonomous evolution loop can trigger a full CodeBuild/SST deploy.
- **Implications**:
  - **Increasing**: Allows more autonomous cycles, potentially fixing complex multi-step gaps faster. However, it increases AWS costs and risks deploying unstable code.
  - **Decreasing**: Enhances safety and reduces cost. May stall evolution if multiple attempts are needed to solve a task.

### `circuit_breaker_threshold`
- **Default**: 5 (failures in sliding window)
- **Purpose**: Stops "Death Spirals" where the system repeatedly fails to fix a bug or pass a health check.
- **Implications**:
  - **Increasing**: More tolerant of intermittent failures. Risks more wasted tokens on a broken path.
  - **Decreasing**: More aggressive protection. May block deployment on flakiness.

### `circuit_breaker_window_ms`
- **Default**: 3600000 (1 hour)
- **Purpose**: Defines the duration of the "memory" for recent failures.

### `circuit_breaker_cooldown_ms`
- **Default**: 600000 (10 minutes)
- **Purpose**: Wait time after the circuit opens before allowing a probe in HALF-OPEN state.

### `circuit_breaker_half_open_max`
- **Default**: 1
- **Purpose**: Number of probe deployments allowed while in the HALF-OPEN state before recovery or re-opening.

### `recursion_limit`
- **Default**: 15 (agent-to-agent hop depth)
- **Purpose**: Prevents infinite loops in multi-agent orchestration (e.g., A calls B calls A).
- **Implications**:
  - **Increasing**: Allows for more complex orchestrations and deeper reasoning chains. Risks undetected infinite loops and high token consumption.
  - **Decreasing**: Strict safety. Might prematurely terminate valid complex tasks.

### `selective_discovery_mode`
- **Default**: `false` (boolean)
- **Purpose**: If `true`, resets agent toolsets to a "minimum viable" set of bootloader tools on every invocation.
- **Implications**:
  - **Turning ON**: Enhances agent focus and security. Agents must "re-discover" tools as needed. Reduces context window noise.
  - **Turning OFF**: Maximum autonomy. Agents retain all tools in their registry, allowing faster execution but potentially leading to tool selection confusion in complex prompts.

### `active_provider` / `active_model`
- **Default**: `openai` / `gpt-5.4-mini`
- **Purpose**: Hot-swapping the primary LLM backend for all system nodes.
- **Implications**:
  - **Bedrock (Claude)**: Better for complex coding tasks; higher latency in some regions.
  - **OpenRouter**: Access to a wide range of models; dependency on a third-party gateway.
  - **GPT-4o**: Highly reliable and fast; default for most tasks.

### `retention_config`
- **Format**: JSON object (e.g., `{"MESSAGES": 30, "TRACES": 14}`)
- **Purpose**: Controls data TTL in DynamoDB.
- **Implications**:
  - **Increasing**: Better for long-term historical analysis and audit trails. Increases storage costs.
  - **Decreasing**: Minimizes data footprint and cost. May lose context for long-running strategic gaps.
