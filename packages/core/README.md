# @claw/core

The core logic and agent implementation for Serverless Claw.

## Modules

- `agents/`: Agent implementations (Coder, Critic, Planner, etc.)
- `lib/`: Shared logic, memory operations, and providers
- `handlers/`: Lambda event handlers (AgentRunner, EventBridge, etc.)
- `tools/`: Built-in tools for agents

## Development

- `pnpm test`: Run unit tests.
- `pnpm run type-check`: Run TypeScript type-check.
- `pnpm run aiready`: Run AI Readiness scan.
