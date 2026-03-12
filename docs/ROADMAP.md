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
- [x] `dispatchTask` and `triggerDeployment` tools
- [x] AWS CodeBuild sidecar Deployer
- [x] `fileWrite` tool for Coder Agent

## ✅ Phase 4: Safety Guardrails
- [x] Resource Labeling (Protected file list in `fileWrite`)
- [x] Deployment Circuit Breaker (5/day limit, DynamoDB-backed, TDD-verified)
- [x] Pre-flight `validateCode` tool
- [x] Human-in-the-Loop prompt instructions

## ✅ Phase 5: Self-Healing & Rollback
- [x] `checkHealth` tool — `GET /health` probe, rewards with counter decrement
- [x] `triggerRollback` tool — `git revert HEAD` + redeploy
- [x] Build Monitor: Log-based error analysis and auto-fix loop
- [x] Dead Man's Switch: Scheduled health probe + emergency rollback
- [x] SuperClaw orchestrates full deploy→verify→rollback cycle

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

## ✅ Phase 8: Autonomous Self-Improvement Loop
- [x] **Git Push Integration**: CodeBuild pushes approved code changes back to GitHub.
- [x] **Verification Tooling**: `runTests` tool for agents to verify logic before deployment.

## ✅ Phase 9: Evolutionary Memory (Tiered)
- [x] **Tiered Memory**: Separate Long-Term **Facts** from dynamic **Tactical Lessons**.
- [x] **Reflector Agent**: Decoupled asynchronous reflection loop via EventBridge.
- [x] **Smart Recall**: Agents selectively retrieve knowledge via `recallKnowledge` tool.

## ✅ Phase 10: Intelligent Prioritization
- [x] **Granular Metrics**: Added Confidence, Impact, Complexity, Risk, and Urgency signals.
- [x] **ROI-Driven Logic**: Reflector estimates actionable signals for capability gaps.
- [x] **Strategic Telemetry**: Planner dynamically checks `ACTIVE_AGENTS` and `AVAILABLE_TOOLS` to prevent hallucinations.

## ✅ Phase 11: Evolution Control & Verified Lifecycle
- [x] **Evolution Mode**: Toggle between Human-in-the-Loop (`hitl`) and self-coding (`auto`) via `ConfigTable`.
- [x] **Notifier Subsystem**: Centralized EventBridge-driven (`OUTBOUND_MESSAGE`) handler decoupling LLM execution from messaging platforms.
- [x] **Verified Lifecycle**: Full status state machine (`OPEN` -> `PLANNED` -> `PROGRESS` -> `DEPLOYED` -> `DONE`).
- [x] **QA Auditor Agent**: Specialized node for satisfaction verification and loop closure.
- [x] **Deterministic Review**: Scheduled strategic reviews based on gap volume and frequency thresholds.

## 🏗️ Phase 12: Evolutionary Command Center (ClawCenter v2)
- [ ] **Evolution Pipeline Board**: Kanban visualization of the 5-stage gap lifecycle.
- [/] **Neural Map**: Dependency graph visualization of agent-to-agent delegation paths and dynamic infrastructure state from DynamoDB.
- [ ] **Granular Safety Tiers**: Multi-level trust settings (Sandbox, Staged, Autonomous) instead of binary toggle.
- [ ] **Real-time Resilience Gauge**: Dashboard HUD for Circuit Breaker status and token burn-rate monitoring.
- [ ] **Interactive Gap Refinement**: Feedback loop for users to edit and improve strategic plans before implementation.

## 🏢 Phase 13: Advanced Autonomy
- [ ] **Browser Automation**: Playwright Lambda Layer for autonomous web browsing.
- [ ] **Promotion Manager**: Agent-driven promotion of validated `dev` builds to `prod`.
- [ ] **Skill Marketplace**: CLI-based installation of community tools.

## 🏢 Phase 14: Enterprise Scale
- [ ] Agent Swarm Isolation by `employerId`.
- [ ] Per-tenant EventBridge filtering.
- [ ] Multi-Channel Adapters: Slack and Discord support.

## 🏢 Phase 15: Evolution Analytics & Tool ROI
- [ ] **Quantitative Tool Dashboard**: Frequency, success rates, and token cost per tool.
- [ ] **Negative Memory Tier**: `FAILED_PLANS#` storage to prevent the Strategic Planner from repeating unsuccessful designs.
- [ ] **Optimizer Agent**: Specialized auditor that suggests tool pruning or splitting based on usage patterns.
- [ ] **Automated Cost Guardrails**: Budget-aware planning that prioritizes cheaper models for low-impact gaps.

## 🏢 Phase 16: Advanced Cognitive Resilience
- [ ] **Static Analysis Feed**: Inject `package.json` and environmental constraints directly into the Planner's telemetry.
- [ ] **Interactive Strategic Planning**: "Reject with Reason" feedback loop in dashboard that converts into immediate `TACTICAL_LESSONS`.
- [ ] **Multi-Agent Conflict Resolution**: Detection and mediation of overlapping plans between different autonomous nodes.
- [ ] **Continuous Knowledge Reconciliation**: Automated periodic audits to merge redundant facts and lessons.
