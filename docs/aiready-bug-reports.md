# Aiready Tool Bug Reports

## Bugs to Report to Aiready Developers

Use `aiready bug` command or file at https://github.com/aiready/aiready/issues

---

### BUG 1: `aiready consistency` crashes with TypeError

**Command**: `aiready consistency .`
**Version**: `@aiready/consistency@0.21.5`
**Error**: `TypeError: issues.filter is not a function`

```
at calculateConsistencyScore (chunk-ZG3KFSD3.mjs:756:33)
at executeToolAction (cli.js:403:19)
```

The `issues` variable is not an array when `calculateConsistencyScore` is called. Likely a data structure mismatch between the analyzer output and the scoring function input.

---

### BUG 2: `aiready patterns` crashes with TypeError

**Command**: `aiready patterns .`
**Version**: `@aiready/pattern-detect@0.17.5`
**Error**: `TypeError: results.flatMap is not a function`

```
at generateSummary (chunk-K7BO57OO.mjs:330:29)
at executeToolAction (cli.js:397:21)
```

The `results` variable is not an array when `generateSummary` is called. Same class of issue as BUG 1 — output type mismatch.

---

### BUG 3: `contract-enforcement` results structure broken

**Version**: `contract-enforcement@0.1.0`

All 148 issues have `"severity": "unknown"`, `"type": "unknown"`, and no file location data. The rawData counts (as-any: 21, as-unknown: 55, nullish-literal-default: 447, swallowed-error: 58) are accurate, but the individual issue records lack proper classification.

Expected: Each issue should have a valid severity (critical/major/minor), type, and file location.

---

### BUG 4: `naming-consistency` false positives on PascalCase const names

**Version**: `@aiready/naming-consistency@0.16.5`

The rule `/^[A-Z][A-Z0-9_]*$/` (SCREAMING_SNAKE_CASE) flags PascalCase names as violations. In TypeScript, these are all correct:

- **Mock exports** mirroring AWS SDK classes: `DynamoDBClient`, `BedrockRuntimeClient`, `PutEventsCommand`
- **Zod schema objects**: `OrchestrationSignalSchema`, `CriticVerdictSchema`, `ReflectionReportSchema`
- **Namespace objects**: `CacheKeys`
- **TypeScript class constructors**: `EventBridgeClient`

The rule should accept `/^[A-Z][a-zA-Z0-9]*$/` (PascalCase) for these categories, or provide a way to exclude const declarations that are class constructors/schema objects/namespace objects.

Workaround applied: Added `core/__mocks__/**`, `**/schema.ts` to `naming-consistency.exclude` in `aiready.json`.

---

### BUG 5: `ai-signal-clarity` false positives on pure functions

The tool flags these functions as "mutates external state but name doesn't reflect it":

1. `getDomainConfig` in `infra/shared.ts` — reads `process.env` (read-only), returns local object. No mutation.
2. `getAgentTools` in `core/tools/registry-utils.ts` — uses dynamic `import()` (idempotent), returns array. No mutation.
3. `validateAllTools` in `core/lib/schema.ts` — pure validator, only calls `logger.error`. No mutation.

The tool conflates `process.env` reads, `console.log` calls, and dynamic `import()` with state mutation. These are all safe side effects that don't mutate external state.

---

### BUG 6: `change-amplification` false positives on shared infrastructure

The tool reports `core/lib/logger.ts` (fan-in ~95, factor 48.5) and `core/lib/constants.ts` (fan-in 43, factor 24.5) as "explosive" coupling. This is by design:

- A logging utility should be imported everywhere
- A constants barrel should be widely used
- A types barrel (`types/index.ts`) is expected to have high fan-in

The tool should either:

- Exclude modules below a certain line count threshold (logger.ts is 242 lines)
- Weight by semantic role (infrastructure vs business logic)
- Provide a way to mark modules as "shared infrastructure" that's expected to have high fan-in
