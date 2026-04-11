# Audit Report: The Hand (Agency & Skill Mastery) & The Shield (Survival & Perimeter) - 2026-04-11

## 🎯 Objective

Deep-dive into the "Unified MCP Multiplexer" (The Hand) and the "Safety Engine" (The Shield) to identify bugs, gaps, inconsistencies, and opportunities for improvement.

## 🔍 Investigation Path

- **Silo 2 (The Hand)**: Examined `core/lib/mcp.ts`, `core/lib/mcp/client-manager.ts`, `core/lib/mcp/tool-mapper.ts`, and `core/lib/agent/tool-executor.ts`.
- **Silo 3 (The Shield)**: Examined `core/lib/safety/safety-engine.ts`, `core/lib/utils/fs-security.ts`, and their integration in `core/agents/superclaw.ts` and `core/lib/agent.ts`.
- **Silo 5 (The Eye)**: Examined `core/lib/verify/judge.ts` for semantic evaluation integration.
- **Silo 1 (The Spine)**: Examined `core/lib/routing/AgentRouter.ts` for model selection logic.

## 🚨 Findings

| ID  | Title                                                | Severity | Recommended Action |
| :-- | :--------------------------------------------------- | :------- | :----------------- |
| 1   | Lost Update Bug in `ConfigManager.saveRawConfig`     | **P1**   | Use `UpdateCommand` with atomic increments (`ADD`) for health/metrics instead of `PutCommand` after read. |
| 2   | Strict Zod Validation Blocks Context Injection       | **P1**   | Modify `jsonSchemaToZod` to always use `.passthrough()` even if `additionalProperties: false` is specified, or handle injection after validation. |
| 3   | `SafetyEngine` is Dead Code in Core Path             | **P2**   | Integrate `SafetyEngine.evaluateAction` into `ToolExecutor.executeSingleToolCall` to activate advanced policies. |
| 4   | MCP Results lack structure (Images/Metadata ignored) | **P2**   | Update `MCPToolMapper` to parse MCP `CallToolResult` into a structured `ToolResult` instead of `JSON.stringify`ing the content array. |
| 5   | Placeholder Violation Persistence in `SafetyEngine`  | **P2**   | Implement `persistViolations` to record safety events in DynamoDB for audit trails. |
| 6   | Hardcoded LLM Pricing in `ExecutorCore`              | **P2**   | Move pricing to `AgentRegistry` or a dynamic config to allow updates without code changes. |
| 7   | Redundant Security Logic in `ToolExecutor`           | **P2**   | Consolidate `fs-security.ts` and `IdentityManager` checks into `SafetyEngine` to provide a unified "Shield". |
| 8   | Performance Gap in Sequential Multi-Turn             | **P3**   | Optimize `ToolExecutor` to only execute sequential tools sequentially, allowing others to run in parallel. |
| 9   | Lack of Load Balancing in `AgentRouter`              | **P3**   | Implement weighted or random selection between candidates in the same `ModelTier`. |

## 💡 Architectural Reflections

The system has a very strong "Hand" (MCP integration is robust with thundering herd protection and multi-transport support) but a "Shield" that is currently disconnected from reality. The `SafetyEngine` contains the "survival instincts" mentioned in `AUDIT.md`, but they are not being exercised because the core loop uses a simplified version in `fs-security.ts`.

### Recommendation: Unified Security Layer
Merge the keyword-based `isSensitiveTool`, the file-path based `checkArgumentsForSecurity`, and the RBAC checks into `SafetyEngine.evaluateAction`. Ensure every tool execution call passes through this single gate.

### Recommendation: Structured MCP Protocol
The current MCP mapping is too "lossy". By stringifying the content array, we lose the ability for agents to see images from MCP tools (e.g., Puppeteer screenshots or AST diagrams) in a structured way. `MCPToolMapper` should intelligently map `TextContent` to `text` and `ImageContent` to the `images` array in `ToolResult`.
