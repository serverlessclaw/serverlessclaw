# Engineering Standards

> **Navigation**: [← Index Hub](../../INDEX.md)

To maintain the high technical integrity of the Serverless Claw swarm, all contributors (both human and autonomous agents) MUST adhere to these standards when adding or modifying features.

## 🧪 1. Test-First Development

We follow a strict "no test, no merges" policy.

| Component Type    | Required Testing                                   |
| :---------------- | :------------------------------------------------- |
| **New Features**  | Unit test (`.test.ts`) + Integration/Contract test |
| **Bug Fixes**     | Regression test demonstrating the fix              |
| **Agents**        | Tool-mocked handler tests                          |
| **UI Components** | Vitest + Storybook (optional)                      |

---

## 📝 2. Documentation Parity

Documentation must never drift from the implementation.

- **Update MDs**: Any change to agent roles, event types, or memory tiers must be immediately reflected in the relevant `docs/` subdirectory.
- **ASCII Diagrams**: Complex flows (especially those involving new event patterns) must be documented with an updated ASCII sequence diagram.
- **Minimal Code**: Avoid embedding large code blocks in Markdown. Point to the implementation file instead.

---

## 🧬 3. Schema Integrity

We use **Zod** for runtime type safety across the EventBus and API.

1.  **Define First**: Always update `core/lib/schema/` and `core/lib/types/` before implementing logic.
2.  **Base Defaults**: Leverage `BASE_EVENT_SCHEMA` for `traceId`, `taskId`, and `sessionId` to reduce boilerplate.
3.  **Strict Typing**: Avoid `any`. Use discriminated unions for event payloads.

---

## 🛰️ 4. Telemetry & Audit

Every autonomous action must leave a traceable signal.

- **Token Tracking**: Ensure all new tools and handlers emit `TokenUsage` metadata.
- **Reputation**: Component failures must emit signal updates to the reputation engine.
- **Negative Memory**: Failed autonomous operations must be recorded in the **Negative Memory** tier (`FAILED_PLAN#`) to prevent looping.

---

## 🚧 5. Safety-Engine Readiness

New tools that perform "Class C" (Infrastructure/Security) actions must be registered with the `SafetyEngine` to ensure they respect:

- Circuit breakers
- Approval tiers
- Rate limits
