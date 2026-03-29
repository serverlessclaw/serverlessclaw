# Contributing Guide

> **Agent Context Loading**: Load this file when you are (or are helping) a human contributor make code or documentation changes to Serverless Claw.

## Golden Rules

1. **Tests first**: Use TDD for any new tool or guardrail logic.
2. **Iterate on Main**: Adopt Trunk-Based Evolution. Use `dev` stage for iteration and `prod` for stable releases.
3. **No broken state**: `validateCode` must pass before any `triggerDeployment`.
4. **Protected files require human approval**: Do not attempt to bypass `PERMISSION_DENIED`.
5. **Docs + Diagrams are NOT optional**: Every code change that affects system behavior MUST update the corresponding spoke document and ASCII diagram in the same commit.

---

## Development Workflow

```bash
# 1. Install deps
pnpm install

# 2. Run quality checks
make check

# 3. Run tests
make test

# 4. Local dev
make dev
```

---

## Pre-push Hooks

Husky triggers `make pre-push` before every push. This runs full quality checks (`make check`), all unit tests (`make test`), and an AI-readiness scan (`make aiready`) ensuring a score of **80+**.

---

## Mandatory Checklist (Human + Agent)

Before committing ANY code change, verify:

### Testing

- [ ] New `*.test.ts` file created for new modules (co-located)
- [ ] Existing `*.test.ts` updated for modified behavior
- [ ] `core/tests/contract.test.ts` updated if new event types added
- [ ] `make test` passes

### Documentation

- [ ] Relevant spoke updated (see table below)
- [ ] ASCII diagram updated for system-level changes
- [ ] Tool/Agent tables updated if applicable

### Quality

- [ ] `make check` passes (lint + format + typecheck)
- [ ] No new `eslint-disable` or `@ts-ignore` without justification

---

## Self-Documentation Rule

> If you change code in a source directory, you MUST update the corresponding spoke document.

| Changed File               | Update This Spoke | Diagram Required? |
| -------------------------- | ----------------- | :---------------: |
| `core/agents/`             | `docs/AGENTS.md`  |        Yes        |
| `core/tools/`              | `docs/TOOLS.md`   |        Yes        |
| `core/handlers/events.ts`  | `ARCHITECTURE.md` |        Yes        |
| `core/handlers/monitor.ts` | `ARCHITECTURE.md` |        Yes        |
| `core/lib/types/`          | `ARCHITECTURE.md` |   If structural   |
| `core/lib/memory/`         | `docs/MEMORY.md`  |        Yes        |
| `core/lib/providers/`      | `docs/LLM.md`     |        No         |
| `infra/`                   | `ARCHITECTURE.md` |        Yes        |
| `makefiles/`               | `docs/DEVOPS.md`  |        No         |
| `sst.config.ts`            | `ARCHITECTURE.md` |        Yes        |

---

## Documentation Standard

All docs follow this front-matter convention (for agent progressive loading):

```markdown
> **Agent Context Loading**: Load this file when you need to [specific trigger].
```

Every spoke must:

- Open with the above callout describing **when to load it**.
- Use a table for structured reference data (the agent's first scan).
- Use diagrams for flows (always ` ```text ` fenced code blocks).
- End with an **"Adding a new X"** section so the Coder Agent knows how to extend.

---

## ASCII Diagram Styles

Use the correct style for each context:

| Style                  | Use Case                  | Example                           |
| ---------------------- | ------------------------- | --------------------------------- |
| **Box-and-arrow**      | Architecture components   | `+---+` with `\|` and `+-->`      |
| **Sequence/timing**    | Event flows, interactions | Columns with `\|` and `+---`      |
| **Tree/hierarchy**     | Sequential steps          | `[Component]` with numbered steps |
| **Circular lifecycle** | Feedback loops            | `[STAGE] <---+`                   |

All diagrams must use ` ```text ` fenced code blocks.

---

## Commit Message Format

```
feat(<scope>): <short description>

- What changed
- Tests added: <file list>
- Docs updated: <file list>
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`
Scopes: `swarm`, `collab`, `evolution`, `tools`, `agents`, `memory`, `infra`, `dashboard`

---

## File Map

```
serverlessclaw/
├── INDEX.md          <- Hub (start here)
├── AGENT_RULES.md    <- Agent entry point + mandatory checklist
├── README.md         <- Public-facing overview
├── ARCHITECTURE.md   <- System topology + ASCII diagrams
├── docs/
│   ├── AGENTS.md     <- Agent roster & orchestration flows
│   ├── TOOLS.md      <- Tool registry & lifecycle
│   ├── SAFETY.md     <- All guardrails
│   ├── MEMORY.md     <- Tiered memory system
│   ├── LLM.md        <- Provider details
│   ├── DEVOPS.md     <- Quality checks & deployment
│   ├── CONTRIBUTING.md <- This file
│   ├── ROADMAP.md    <- Future plans
│   └── RESEARCH.md   <- Design decisions
├── core/             <- TypeScript logic & handlers
│   ├── agents/       <- Agent implementations
│   ├── handlers/     <- Lambda handlers
│   ├── lib/          <- Core libraries (types, memory, providers)
│   ├── tools/        <- Tool implementations
│   └── tests/        <- Integration + contract tests
├── infra/            <- SST infrastructure code
├── makefiles/        <- Modular DevOps spokes
└── sst.config.ts     <- Infrastructure definition
```
