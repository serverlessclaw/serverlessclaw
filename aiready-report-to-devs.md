# aiready Configuration Issues & Feature Requests

## Summary

This report documents issues encountered when configuring aiready for a medium-sized TypeScript monorepo (~20k lines of core code across `core/`, `dashboard/`, `infra/`, `scripts/`). The current configuration has grown to 175 lines in the root `aiready.json` and 173 lines in `core/aiready.json`, with extensive workarounds for false positives.

---

## Issue 1: Configuration Duplication

### Problem

Root and `core/aiready.json` are nearly identical (173 vs 175 lines), differing only in `maxContextBudget`:

| File              | maxContextBudget |
| ----------------- | ---------------- |
| root              | 200000           |
| core/aiready.json | 128000           |

There is no mechanism to share common configuration between projects or inherit from a base config.

### Impact

- Maintenance burden: changes must be duplicated across files
- Easy to introduce drift
- Monorepos cannot share baseline config

### Proposed Solution: Config Inheritance

Add an `extends` field to reference a base configuration:

```json
{
  "extends": "../../aiready.json",
  "tools": {
    "context-analyzer": {
      "maxContextBudget": 128000
    }
  }
}
```

This would allow:

- Base config in root `aiready.json` with common exclusions and tool settings
- Package-specific overrides in subdirectories
- Clear separation of shared vs. local config

---

## Issue 2: Excessive Hardcoded Exclusions

### Problem

The current config explicitly excludes 15+ file paths to avoid false positives:

```json
"exclude": [
  "**/types/index.ts",
  "**/index.ts",
  "**/*.test.ts",
  "**/*.test.tsx",
  "dashboard/src/components/ui/**",
  "core/__mocks__/**",
  "**/schema.ts",
  "core/lib/schema/**",
  "dashboard/src/app/layout.tsx",
  "dashboard/src/app/memory/types.ts",
  "core/lib/memory/cache.ts",
  "dashboard/src/components/Trace/nodes.tsx",
  "dashboard/src/components/Providers/TranslationsProvider.tsx",
  "scripts/**"
]
```

### Proposed Solution: Smart Auto-Exclusion

aiready should recognize common patterns automatically:

#### A. Test Files

Built-in recognition of test patterns without explicit exclusion:

- `*.test.ts`, `*.test.tsx`
- `*.spec.ts`, `*.spec.tsx`
- `**/__tests__/**`
- `**/tests/**`

#### B. Barrel/Re-export Files

Built-in recognition of barrel files:

- `index.ts` (when serving as re-export)
- `types/index.ts`
- `*/index.ts` with only re-exports

#### C. Mock Files

- `**/__mocks__/**`
- `**/*.mock.ts`

#### D. Third-Party/Generated

- `**/node_modules/**` (already excluded)
- `**/.next/**`, `**/.sst/**` (already excluded)

This would reduce our exclude array from 15+ items to ~3-5 truly project-specific exclusions.

---

## Issue 3: Redundant Exclusion Patterns

### Problem

In `ai-signal-clarity.exclude`, the same files are listed multiple times:

```json
"exclude": [
  "lib/memory/gap-operations.ts",
  "**/lib/memory/gap-operations.ts",
  "lib/agent/executor-core.ts",
  "**/lib/agent/executor-core.ts"
]
```

This indicates confusion about glob patterns vs. exact paths.

### Proposed Solution: Pattern Optimization

Add a warning when:

1. A single file is excluded with a wildcard pattern (e.g., `**/lib/foo.ts` should be `lib/foo.ts`)
2. The same path appears multiple times in exclude arrays
3. Exclude patterns overlap significantly

---

## Issue 4: Context Budget Sizing

### Problem

We need different `maxContextBudget` values for different packages:

- Root scan: 200000 tokens
- Core-only scan: 128000 tokens

This suggests one-size-fits-all doesn't work for monorepos.

### Proposed Solutions

#### Option A: Package-Aware Scaling

Auto-scale context budget based on project size:

```json
"context-analyzer": {
  "maxContextBudget": "auto",  // or percentage: "10%"
}
```

#### Option B: Per-Package Override

Allow specifying different budgets per package in monorepo scans:

```json
"context-analyzer": {
  "budgetByPackage": {
    "core": 128000,
    "dashboard": 200000,
    "infra": 128000
  }
}
```

---

## Issue 5: No Config Validation

### Problem

Misconfigurations are only discovered during scan time:

- Invalid glob patterns
- Duplicate exclusions
- Unknown tool names
- Schema violations

### Proposed Solution: Validation Command

Add `aiready validate` command that checks:

- Schema validity
- Valid glob patterns
- Duplicate entries
- Unused exclusions
- Tool availability
- Recommended practices

Example output:

```
$ aiready validate

Warnings:
- Line 45: Single-file glob '**/lib/foo.ts' - use 'lib/foo.ts' instead
- Line 67: Duplicate exclusion 'lib/bar.ts' appears in both general and tool-specific excludes
- Line 89: Unknown tool 'invalid-tool-name' in tools array

Info:
- Consider adding 'autoDetectTests: true' to reduce explicit test exclusions
```

---

## Issue 6: Tool-Specific Exclusions Are Brittle

### Problem

Each tool has its own `exclude` array that must be manually kept in sync:

```json
"naming-consistency": {
  "exclude": [
    "dashboard/src/components/ui/**",
    "core/__mocks__/**",
    "**/schema.ts",
    ...
  ]
},
"ai-signal-clarity": {
  "exclude": [
    "dashboard/src/components/ui/**",
    "lib/memory/gap-operations.ts",
    ...
  ]
}
```

### Proposed Solution: Tiered Exclusions

Allow hierarchical exclusion levels:

```json
"exclude": {
  "global": ["**/node_modules/**", ...],        // Applied to all tools
  "naming-consistency": [...],                  // Tool-specific
  "ai-signal-clarity": [...]                    // Tool-specific
}
```

This reduces duplication and makes intent clearer.

---

## Summary: Priority Feature Requests

| Priority | Feature                   | Problem Addressed               |
| -------- | ------------------------- | ------------------------------- |
| P0       | Config Inheritance        | Issue 1 - duplication           |
| P0       | Smart Test/File Exclusion | Issue 2 - excessive exclusions  |
| P1       | Config Validation         | Issue 5 - no validation         |
| P1       | Pattern Optimization      | Issue 3 - redundant patterns    |
| P2       | Context Budget Scaling    | Issue 4 - fixed budgets         |
| P2       | Tiered Exclusions         | Issue 6 - brittle tool excludes |

---

## Appendix: Current Configuration Stats

- **Root aiready.json**: 175 lines, 13 tool configs, 14 exclusions
- **core/aiready.json**: 173 lines, 13 tool configs, 14 exclusions
- **Shared code**: ~165 lines (94%)
- **Differences**: Only `maxContextBudget` (200000 vs 128000)

---

_Report generated for aiready dev team. Configuration files available on request._
