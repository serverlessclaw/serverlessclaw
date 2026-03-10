# Serverless Claw

**Serverless Claw** is a self-evolving, cost-efficient AI agent platform built on AWS using [SST (v3/Ion)](https://sst.dev). It hosts intelligent agents that can receive messages, use tools, and autonomously modify and redeploy their own infrastructure.

## Key Features

- **Zero Idle Costs** — powered by AWS Lambda, pay per invocation only
- **Self-Evolving (Code & Infra)** — the agent can write application code, modify its own AWS infrastructure via SST, validate, and redeploy itself safely
- **Self-Healing & Resilient** — autonomously detects build failures, analyzes logs, and recovers from fatal errors with a 100% automated rollback loop
- **Native Observability** — built-in, serverless tracing engine (Claw-Trace) and Next.js 16 Admin Dashboard
- **Multi-Agent Orchestration** — Main Agent delegates to a Coder Agent via EventBridge
- **Safety-First** — circuit breakers, protected resource labeling, health probes, and rollback
- **Pluggable** — swap memory backends, LLM providers, or messaging channels

## 🛡️ Autonomous Resiliency

Serverless Claw is designed to be "un-killable" through two levels of autonomous recovery:

1. **The Self-Healing Loop**: If a deployment fails (e.g., a bug in a new tool), the **Build Monitor** extracts the error logs, notifies the **Main Agent**, and automatically tasks the **Coder Agent** to investigate and apply a fix.
2. **The Dead Man's Switch**: An immutable health probe runs every 15 minutes. If it detects the system is down or the "brain" (Lambda) is broken, it triggers an emergency **100% automated rollback** to the last known stable state.

No human intervention required. No more midnight wake-up calls for broken deployments.

## Quick Start

```bash
pnpm install
# Populate .env with SST_SECRET_ prefixes (e.g. SST_SECRET_OpenAIApiKey)
make dev
```

## Documentation

📖 Start with **[INDEX.md](./INDEX.md)** — the documentation hub for both humans and agents.

| Doc | Purpose |
|-----|---------|
| [INDEX.md](./INDEX.md) | **Hub** — start here, progressive context loading map |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System topology & AWS resource diagram |
| [docs/DEVOPS.md](./docs/DEVOPS.md) | **DevOps Hub** — automation, make targets, & CI/CD |
| [docs/AGENTS.md](./docs/AGENTS.md) | Agent roster, orchestration flow, prompt summaries |
| [docs/TOOLS.md](./docs/TOOLS.md) | Full tool registry & deployment lifecycle |
| [docs/SAFETY.md](./docs/SAFETY.md) | Circuit breakers, rollback, HITL guardrails |
| [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Dev workflow & documentation standards |
| [docs/RESEARCH.md](./docs/RESEARCH.md) | Architectural decisions & design research |
| [docs/ROADMAP.md](./docs/ROADMAP.md) | Planned features |

## License
MIT
