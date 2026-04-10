# Serverless Claw — Documentation Index

> **Agent Context Loading Protocol**: This is the hub. Start here. Load only the spokes relevant to your task.

## Agent Entry Files

- [`.github/copilot-instructions.md`](./.github/copilot-instructions.md): Copilot-specific startup instructions that route to this index and devops docs.
- [`INDEX.md#agent-instructions-checklist`](#agent-instructions-checklist): Mandatory agent checklists, quality gates, and operational rules.

## Hub-and-Spoke Map

| Spoke                                                                | Load When You Need To...                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md)                                 | Understand system structure, data flow, or self-aware AWS topology         |
| [docs/intelligence/LLM.md](./docs/intelligence/LLM.md)               | Deep dive into 2026 reasoning profiles and the OpenAI Response API bridge  |
| [docs/governance/DEVOPS.md](./docs/governance/DEVOPS.md)             | Run quality checks, tests, deployments, or releases                        |
| [docs/intelligence/AGENTS.md](./docs/intelligence/AGENTS.md)         | Work on agent logic and backbone registry                                  |
| [docs/intelligence/SWARM.md](./docs/intelligence/SWARM.md)           | Mission decomposition, parallel dispatch, and swarm coordination           |
| [docs/intelligence/RESEARCH.md](./docs/intelligence/RESEARCH.md)     | Specialized Research Agent workflows and discovery patterns                |
| [docs/interface/COLLABORATION.md](./docs/interface/COLLABORATION.md) | Shared sessions, Workspaces, RBAC, and human-in-the-loop chat              |
| [docs/intelligence/MEMORY.md](./docs/intelligence/MEMORY.md)         | Understand the tiered memory system, recall mechanism, and storage options |
| [docs/system/PROVISIONING.md](./docs/system/PROVISIONING.md)         | Setup infrastructure, storage, resources, and environments                 |
| [docs/system/RESILIENCE.md](./docs/system/RESILIENCE.md)             | Circuit breakers, Dead Man's Switch, and self-healing loops                |
| [docs/intelligence/SAFETY.md](./docs/intelligence/SAFETY.md)         | Understand guardrails, safety tiers, and policy enforcement                |
| [docs/interface/EVENTS.md](./docs/interface/EVENTS.md)               | Understand event routing, bus logic, and DLQ handling                      |
| [docs/interface/PROTOCOL.md](./docs/interface/PROTOCOL.md)           | External input/output adapters and Tool protocols (MCP)                    |
| [docs/interface/DASHBOARD.md](./docs/interface/DASHBOARD.md)         | Real-time signals (MQTT), design system, and theme                         |
| [docs/governance/STANDARDS.md](./docs/governance/STANDARDS.md)       | Engineering standards, test-first requirements, and audit rules            |
| [docs/governance/ROADMAP.md](./docs/governance/ROADMAP.md)           | Understand what's planned, pick the next task                              |
| [docs/governance/CONTRIBUTING.md](./docs/governance/CONTRIBUTING.md) | Understand how to contribute code or update documentation                  |
| [Extensibility](./core/lib/registry/)                                | Dynamic Skill and Agent registries for spoke extension                     |
| [Evolution](./core/lib/safety/evolution-scheduler.ts)                | Evolution Manager for proposing optimizations and bug fixes                |

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

| Changed File               | Update This Spoke                                       | Diagram? |
| -------------------------- | ------------------------------------------------------- | :------: |
| `core/agents/`             | [intelligence/AGENTS.md](./docs/intelligence/AGENTS.md) |   Yes    |
| `core/tools/`              | [intelligence/TOOLS.md](./docs/intelligence/TOOLS.md)   |   Yes    |
| `core/handlers/events.ts`  | [interface/EVENTS.md](./docs/interface/EVENTS.md)       |   Yes    |
| `core/handlers/monitor.ts` | [ARCHITECTURE.md](./ARCHITECTURE.md)                    |   Yes    |
| `core/lib/types/`          | [ARCHITECTURE.md](./ARCHITECTURE.md)                    |  Struct  |
| `core/lib/memory/`         | [intelligence/MEMORY.md](./docs/intelligence/MEMORY.md) |   Yes    |
| `core/lib/providers/`      | [intelligence/LLM.md](./docs/intelligence/LLM.md)       |    No    |
| `infra/`                   | [ARCHITECTURE.md](./ARCHITECTURE.md)                    |   Yes    |
| `makefiles/`               | [governance/DEVOPS.md](./docs/governance/DEVOPS.md)     |    No    |
| `sst.config.ts`            | [ARCHITECTURE.md](./ARCHITECTURE.md)                    |   Yes    |

---

_See [README.md](./README.md) for the public-facing overview._

# Agent Instructions & Checklist

> [!NOTE]
> This is a **Master Instruction** file for any AI agent (Copilot, Windsurf, Cody, etc.) working in this repository. It defines mandatory operations, quality gates, and documentation rules.

For any agent working in this repo, load context in this order:

1. [`INDEX.md`](./INDEX.md)
2. [`docs/governance/DEVOPS.md`](./docs/governance/DEVOPS.md) for checks, deploy, release, or make targets
3. [`ARCHITECTURE.md`](./ARCHITECTURE.md) for SST/infra changes
4. [`docs/intelligence/AGENTS.md`](./docs/intelligence/AGENTS.md) for orchestration and agent behavior

## Stage Hygiene

- `make dev` -> stage `local` (for local development)
- `make deploy` -> stage `prod` (single deployment environment)
- Never use `sst dev` against the deployment stage.

## Mandatory Agent Checklist

> **EVERY agent modifying code MUST complete ALL applicable items before committing. No exceptions.**

### 1. Testing (REQUIRED)

- [ ] **New module**: Create co-located `*.test.ts` with unit tests covering happy path + error cases
- [ ] **Modified module**: Update existing `*.test.ts` to cover new behavior
- [ ] **New event type/schema**: Add test case to `core/tests/contract.test.ts`
- [ ] **New tool**: Verify tool is listed in `core/lib/constants.ts` TOOLS enum
- [ ] **Run**: `make test` passes before committing

### 2. Documentation (REQUIRED)

- [ ] **Changed `core/agents/`** -> update [`docs/intelligence/AGENTS.md`](./docs/intelligence/AGENTS.md) (registry) and [`docs/intelligence/SWARM.md`](./docs/intelligence/SWARM.md) (coordination)
- [ ] **Changed `core/tools/`** -> update [`docs/intelligence/TOOLS.md`](./docs/intelligence/TOOLS.md) and [`docs/interface/PROTOCOL.md`](./docs/interface/PROTOCOL.md)
- [ ] **Changed `core/handlers/events.ts` or `monitor.ts`** -> update [`docs/intelligence/SWARM.md`](./docs/intelligence/SWARM.md) and [`docs/system/RESILIENCE.md`](./docs/system/RESILIENCE.md)
- [ ] **Changed `core/lib/types/`** -> update [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [ ] **Changed `core/lib/memory/`** -> update [`docs/intelligence/MEMORY.md`](./docs/intelligence/MEMORY.md)
- [ ] **Changed `core/lib/providers/`** -> update [`docs/intelligence/LLM.md`](./docs/intelligence/LLM.md)
- [ ] **Changed `infra/`** -> update [`docs/system/PROVISIONING.md`](./docs/system/PROVISIONING.md)
- [ ] **Changed `makefiles/`** -> update [`docs/governance/DEVOPS.md`](./docs/governance/DEVOPS.md)

### 3. ASCII Diagrams (REQUIRED for system-level changes)

- [ ] **New event type or flow**: Add sequence diagram to [`docs/intelligence/SWARM.md`](./docs/intelligence/SWARM.md) or [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [ ] **New agent or handler**: Add to architecture diagram in [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [ ] **Modified orchestration**: Update orchestration flow diagram in [`docs/intelligence/SWARM.md`](./docs/intelligence/SWARM.md)
- [ ] **New memory tier or key**: Update memory tier diagram in [`docs/intelligence/MEMORY.md`](./docs/intelligence/MEMORY.md)
- [ ] **Diagram style**: Use ` ```text ` fenced code blocks with box-and-arrow (`+---+`), sequence (`|`, `+-->`), or tree (`[Component]`) format

### 4. Quality Gate (REQUIRED)

- [ ] `make check` passes (lint + format + typecheck)
- [ ] `make test` passes (all unit tests)
- [ ] No new `eslint-disable` or `@ts-ignore` comments without justification

### 5. Constants & Types (REQUIRED for new tools/events)

- [ ] New tool name added to `TOOLS` enum in `core/lib/constants.ts`
- [ ] New memory key prefix added to `MEMORY_KEYS` in `core/lib/constants.ts`
- [ ] New event type added to `EventType` enum in `core/lib/types/agent.ts`
- [ ] New event schema added to `EVENT_SCHEMA_MAP` in `core/lib/schema/events.ts`
- [ ] New type exported from `core/lib/types/index.ts`
- [ ] New memory operations exported from `core/lib/memory/index.ts`

## Commit Message Format

```
feat(<scope>): <short description>

- What changed
- Tests added: <file list>
- Docs updated: <file list>
```

Scopes: `swarm`, `collab`, `evolution`, `tools`, `agents`, `memory`, `infra`, `dashboard`
