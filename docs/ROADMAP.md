# Serverless Claw Roadmap

Our goal: the most customizable, cost-effective, and self-evolving personal AI agent host.

## ✅ Phase 1: MVP
- [x] SST v3 (Ion) setup
- [x] Telegram Webhook integration
- [x] DynamoDB history persistence
- [x] Basic Tool loop (Calculator, Weather)

## ✅ Phase 2: Developer Foundations
- [x] Standardized `IMemory`, `IChannel`, `ITool` interfaces
- [x] DynamoDB-based session locking (mutex)
- [x] Distilled Long-Term Memory (Reflection Loop)

## ✅ Phase 3: Self-Evolving & Multi-Agent
- [x] 3-Agent Architecture: Main → Coder → Deployer
- [x] EventBridge `AgentBus` for async inter-agent communication
- [x] `dispatch_task` and `trigger_deployment` tools
- [x] AWS CodeBuild sidecar Deployer
- [x] `file_write` tool for Coder Agent

## ✅ Phase 4: Safety Guardrails
- [x] Resource Labeling (Protected file list in `file_write`)
- [x] Deployment Circuit Breaker (5/day limit, DynamoDB-backed, TDD-verified)
- [x] Pre-flight `validate_code` tool
- [x] Human-in-the-Loop prompt instructions

## ✅ Phase 5: Self-Healing & Rollback
- [x] `check_health` tool — `GET /health` probe, rewards with counter decrement
- [x] `trigger_rollback` tool — `git revert HEAD` + redeploy
- [x] Build Monitor: Log-based error analysis and auto-fix loop
- [x] Dead Man's Switch: Scheduled health probe + emergency rollback
- [x] Main Agent orchestrates full deploy→verify→rollback cycle

---

## ✅ Phase 6: Visibility & Native Observability
- [x] **Claw-Trace**: Built-in tracing engine logging to DynamoDB.
- [x] **Claw-Monitor Dashboard**: Next.js 16 (Canary) + Tailwind v4 UI.
- [x] **Milestone 1: High-Fidelity Tracing**: Trace detail views with raw prompt/response/payload inspection.
- [x] **Milestone 2: Neural Path Visualizer**: XYFlow integration for branching agent logic diagrams.
- [x] **Resilience Hub**: Dedicated views for self-healing logs and Dead Man's Switch status.
- [x] **Memory Browser**: Inspect distilled facts, session history, and tool registry.

## ✅ Phase 7: Multi-Model & Hot-Config
- [x] **Provider Hub**: Unified interface for OpenAI, Bedrock (Claude 4.6), and OpenRouter (Gemini/GLM/Minimax).
- [x] **Dynamic Routing**: `ProviderManager` for runtime model selection without redeploys.
- [x] **Config Table**: DynamoDB-backed persistent application settings.
- [x] **Direct Chat**: Dashboard-integrated neural interface for real-time agent interaction.
- [x] **Session Traffic Control**: Manual lock management and zombie session cleanup.

## 🔥 Phase 8: Autonomous Self-Improvement Loop
- [ ] **Git Push Integration**: Enable CodeBuild to push approved code changes back to GitHub.
- [ ] **Iteration Manager**: Allow the Coder agent to create branches and trigger tests.
- [ ] **PR Bot**: Agent opens GitHub Pull Requests for its own improvements.

## 🏢 Phase 9: Power Capabilities
- [ ] **Browser Automation**: Playwright Lambda Layer for autonomous web browsing/actions.
- [ ] **Skill Marketplace**: CLI-based installation of community-contributed tools.
- [ ] **Multi-Channel Adapters**: Slack and Discord support.

## 🏢 Phase 10: Multi-Tenancy & Scale
- [ ] Agent Swarm Isolation by `employerId`.
- [ ] Per-tenant EventBridge filtering.
