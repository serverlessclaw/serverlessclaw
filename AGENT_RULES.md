# Agent Entry Point

For any agent working in this repo, load context in this order:

1. [`INDEX.md`](./INDEX.md)
2. [`docs/DEVOPS.md`](./docs/DEVOPS.md) for checks, deploy, release, or make targets
3. [`ARCHITECTURE.md`](./ARCHITECTURE.md) for SST/infra changes
4. [`docs/AGENTS.md`](./docs/AGENTS.md) for orchestration and agent behavior

## Stage Hygiene

- `make dev` -> stage `local` (for local development)
- `make deploy` -> stage `dev` (single deployment environment)
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

- [ ] **Changed `core/agents/`** -> update [`docs/AGENTS.md`](./docs/AGENTS.md) (roster table, orchestration diagrams)
- [ ] **Changed `core/tools/`** -> update [`docs/TOOLS.md`](./docs/TOOLS.md) (tool table, "Adding a New Tool" section)
- [ ] **Changed `core/handlers/events.ts` or `monitor.ts`** -> update [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [ ] **Changed `core/lib/types/`** -> update [`ARCHITECTURE.md`](./ARCHITECTURE.md) if architecture changed
- [ ] **Changed `core/lib/memory/`** -> update [`docs/MEMORY.md`](./docs/MEMORY.md) (tier diagram, key namespaces)
- [ ] **Changed `core/lib/providers/`** -> update [`docs/LLM.md`](./docs/LLM.md)
- [ ] **Changed `infra/`** -> update [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [ ] **Changed `makefiles/`** -> update [`docs/DEVOPS.md`](./docs/DEVOPS.md)

### 3. ASCII Diagrams (REQUIRED for system-level changes)

- [ ] **New event type or flow**: Add sequence diagram to `docs/AGENTS.md` or `ARCHITECTURE.md`
- [ ] **New agent or handler**: Add to architecture diagram in `ARCHITECTURE.md`
- [ ] **Modified orchestration**: Update orchestration flow diagram in `docs/AGENTS.md`
- [ ] **New memory tier or key**: Update memory tier diagram in `docs/MEMORY.md`
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
