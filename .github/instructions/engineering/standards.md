# Engineering Standards & Agent Checklist

## Mandatory Quality Gates
1.  **Testing**: Every code change MUST include or update co-located `*.test.ts` files.
2.  **Checks**: `make check` (lint + format + typecheck) MUST pass before commit.
3.  **Naming**: Use descriptive names; avoid abbreviations unless listed in [Glossary](../../docs/governance/GLOSSARY.md).

## Documentation Sync Checklist
- [ ] **Changed `core/agents/`** -> update [AGENTS.md](../../docs/intelligence/AGENTS.md).
- [ ] **Changed `infra/`** -> update [PROVISIONING.md](../../docs/system/PROVISIONING.md).
- [ ] **ASCII Diagrams**: Update diagrams in the relevant spoke for any system-level changes.

_Refer to the full [Agent Checklist](../../INDEX.md#mandatory-agent-checklist) for detailed steps._
