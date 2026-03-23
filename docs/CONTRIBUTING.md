# Contributing Guide

> **Last Updated**: 23 March 2026

> **Agent Context Loading**: Load this file when you are (or are helping) a human contributor make code or documentation changes to Serverless Claw.

## Golden Rules

1. **Tests first**: Use TDD for any new tool or guardrail logic.
2. **Iterate on Main**: Adopt Trunk-Based Evolution. Use `dev` stage for iteration and `prod` for stable releases.
3. **No broken state**: `validateCode` must pass before any `triggerDeployment`.
4. **Protected files require human approval**: Do not attempt to bypass `PERMISSION_DENIED`.

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

## Documentation Standard

All docs follow this front-matter convention (for agent progressive loading):

```markdown
> **Agent Context Loading**: Load this file when you need to [specific trigger].
```

Every spoke must:
- Open with the above callout describing **when to load it**.
- Use a table for structured reference data (the agent's first scan).
- Use diagrams for flows.
- End with an **"Adding a new X"** section so the Coder Agent knows how to extend.

---

## Commit Message Format

```
type: short description

- Detailed bullet (optional)
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`

---

## File Map

```
serverlessclaw/
├── INDEX.md          ← Hub (start here)
├── README.md         ← Public-facing overview
├── ARCHITECTURE.md   ← System topology
├── docs/
│   ├── AGENTS.md     ← Agent roster & orchestration
│   ├── TOOLS.md      ← Tool registry & lifecycle
│   ├── SAFETY.md     ← All guardrails
│   ├── RESEARCH.md   ← Design decisions
│   ├── ROADMAP.md    ← Future plans
│   └── CONTRIBUTING.md ← This file
├── core/             ← TypeScript logic & handlers
├── infra/            ← SST infrastructure code
├── makefiles/        ← Modular DevOps spokes
└── sst.config.ts     ← Infrastructure definition
```
