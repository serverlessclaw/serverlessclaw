# Serverless Claw — Documentation Index

> **Agent Context Loading Protocol**: This is the hub. Start here. Load only the spokes relevant to your task.

## Agent Entry Files

- [`.github/copilot-instructions.md`](./.github/copilot-instructions.md): Copilot-specific startup instructions that route to this index and devops docs.
- [`AGENTS.md`](./AGENTS.md): Generic root agent entrypoint used by non-Copilot agents.

## Hub-and-Spoke Map

| Spoke                                     | Load When You Need To...                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md)      | Understand system structure, data flow, or self-aware AWS topology        |
| [docs/LLM.md](./docs/LLM.md)              | Deep dive into 2026 reasoning profiles and the OpenAI Response API bridge |
| [docs/DEVOPS.md](./docs/DEVOPS.md)        | Run quality checks, tests, deployments, or releases                       |
| [AGENTS.md](./docs/AGENTS.md)             | Work on agent logic, prompts, orchestration, or backbone registry         |
| [TOOLS.md](./docs/TOOLS.md)               | Add, modify, or understand any agent tool                                 |
| [docs/MEMORY.md](./docs/MEMORY.md)        | Understand the tiered memory system and recall mechanism                  |
| [SAFETY.md](./docs/SAFETY.md)             | Understand guardrails, circuit breakers, rollback, or HITL                |
| [RESEARCH.md](./docs/RESEARCH.md)         | Review architectural decisions or LLM provider choices                    |
| [ROADMAP.md](./docs/ROADMAP.md)           | Understand what's planned, pick the next task                             |
| [CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Understand how to contribute code or update documentation                 |

---

## System Overview (One Paragraph)

**Serverless Claw** is a self-evolving AI agent platform on AWS. A SuperClaw (Lambda) receives messages via Telegram/Discord webhooks, processes them with an LLM, and can autonomously delegate code changes to a **Coder Agent**, which then triggers the **Deployer** (CodeBuild) to redeploy the stack. Safety guardrails (circuit breakers, protected resource labeling, health probes, rollback) prevent runaway evolution, while the **ClawCenter Dashboard** enables real-time human **co-management** of agent capabilities and memory.

---

## Quick Start

```bash
pnpm install
# Load secrets from .env or npx sst secret set
make dev
```

---

## For Agents: Self-Documentation Rule

> **CRITICAL**: If you (any agent) make changes that affect any of the spoke documents below, you **MUST** update the relevant spoke as part of the same commit. Reference the appropriate spoke before making any changes to ensure alignment.
>
> **TESTS**: Every code change MUST include or update co-located `*.test.ts` files. Run `make test` before committing.
>
> **DIAGRAMS**: For any complex system-level changes (e.g., changing EventBridge routing, adding new agent-to-agent communication, or modifying the core backbone), you **MUST** also update the relevant **ASCII diagrams** in the spoke document using ` ```text ` fenced code blocks.

| Changed File               | Update This Spoke                    | Diagram? |
| -------------------------- | ------------------------------------ | :------: |
| `core/agents/`             | [AGENTS.md](./docs/AGENTS.md)        |   Yes    |
| `core/tools/`              | [TOOLS.md](./docs/TOOLS.md)          |   Yes    |
| `core/handlers/events.ts`  | [ARCHITECTURE.md](./ARCHITECTURE.md) |   Yes    |
| `core/handlers/monitor.ts` | [ARCHITECTURE.md](./ARCHITECTURE.md) |   Yes    |
| `core/lib/types/`          | [ARCHITECTURE.md](./ARCHITECTURE.md) |  Struct  |
| `core/lib/memory/`         | [MEMORY.md](./docs/MEMORY.md)        |   Yes    |
| `core/lib/providers/`      | [LLM.md](./docs/LLM.md)              |    No    |
| `infra/`                   | [ARCHITECTURE.md](./ARCHITECTURE.md) |   Yes    |
| `makefiles/`               | [DEVOPS.md](./docs/DEVOPS.md)        |    No    |
| `sst.config.ts`            | [ARCHITECTURE.md](./ARCHITECTURE.md) |   Yes    |

---

_See [README.md](./README.md) for the public-facing overview._
