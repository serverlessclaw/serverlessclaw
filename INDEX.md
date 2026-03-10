# Serverless Claw — Documentation Index

> **Agent Context Loading Protocol**: This is the hub. Start here. Load only the spokes relevant to your task.

## Hub-and-Spoke Map

| Spoke | Load When You Need To... |
|-------|--------------------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Understand system structure, data flow, or AWS topology |
| [docs/DEVOPS.md](./docs/DEVOPS.md) | Run quality checks, tests, deployments, or releases |
| [AGENTS.md](./docs/AGENTS.md) | Work on agent logic, prompts, orchestration, or sub-agents |
| [TOOLS.md](./docs/TOOLS.md) | Add, modify, or understand any agent tool |
| [SAFETY.md](./docs/SAFETY.md) | Understand guardrails, circuit breakers, rollback, or HITL |
| [RESEARCH.md](./docs/RESEARCH.md) | Review architectural decisions or LLM provider choices |
| [ROADMAP.md](./docs/ROADMAP.md) | Understand what's planned, pick the next task |
| [CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Understand how to contribute code or update documentation |

---

## System Overview (One Paragraph)

**Serverless Claw** is a self-evolving AI agent platform on AWS. A Main Agent (Lambda) receives messages via Telegram/Discord webhooks, processes them with an LLM, and can autonomously delegate code changes to a **Coder Agent**, which then triggers the **Deployer** (CodeBuild) to redeploy the stack. Safety guardrails (circuit breakers, protected resource labeling, health probes, rollback) prevent runaway evolution.

---

## Quick Start

```bash
pnpm install
# Load secrets from .env or npx sst secret set
make dev
```

---

## For Agents: Self-Documentation Rule

> **CRITICAL**: If you (the Coder Agent) make changes that affect any of the spoke documents below, you **MUST** update the relevant spoke as part of the same commit. Reference the appropriate spoke before making any changes to ensure alignment.

| Changed File | Update This Spoke |
|---|---|
| `src/tools/index.ts` | [TOOLS.md](./docs/TOOLS.md) |
| `src/agents/` | [AGENTS.md](./docs/AGENTS.md) |
| `src/infra/` | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| `src/tools/index.ts` (guardrails) | [SAFETY.md](./docs/SAFETY.md) |
| `sst.config.ts` | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| `makefiles/` | [DEVOPS.md](./docs/DEVOPS.md) |

---

*See [README.md](./README.md) for the public-facing overview.*
