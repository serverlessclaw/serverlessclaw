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

## ✅ Phase 5: Self-Evolving & Multi-Agent
- [x] 3-Agent Architecture: Main → Coder → Deployer
- [x] EventBridge `AgentBus` for async inter-agent communication
- [x] `dispatch_task` and `trigger_deployment` tools
- [x] AWS CodeBuild sidecar Deployer
- [x] `file_write` tool for Coder Agent

## ✅ Phase 6: Safety Guardrails
- [x] Resource Labeling (Protected file list in `file_write`)
- [x] Deployment Circuit Breaker (5/day limit, DynamoDB-backed, TDD-verified)
- [x] Pre-flight `validate_code` tool
- [x] Human-in-the-Loop prompt instructions

## ✅ Phase 7: Self-Healing & Rollback
- [x] `check_health` tool — `GET /health` probe, rewards with counter decrement
- [x] `trigger_rollback` tool — `git revert HEAD` + redeploy
- [x] Build Monitor: Log-based error analysis and auto-fix loop
- [x] Dead Man's Switch: Scheduled health probe + emergency rollback
- [x] Main Agent orchestrates full deploy→verify→rollback cycle

---

## 🔜 Phase 3: Capabilities Expansion
- [ ] Multi-Channel Router (Telegram + Discord + Slack)
- [ ] Browser Automation via `Playwright` Lambda Layer
- [ ] Local Model Tunnel (Ollama / AWS Bedrock)

## 🔜 Phase 4: Ecosystem & UI
- [ ] Admin Dashboard (SST React Site): agent logs, memory, tool usage
- [ ] Plugin Marketplace for community `AgentSkills`
- [ ] Voice Support (Twilio / WebRTC)

## 🔜 Phase 8: Multi-Tenancy & Isolation
- [ ] Agent Swarm Isolation by `employerId` (tenant partitioning)
- [ ] Per-tenant EventBridge filtering
- [ ] Tenant-aware rate limiting on Circuit Breaker

## 🔜 Phase 9: Observability
- [ ] Langfuse integration for LLM tracing
- [ ] Per-tool latency / cost dashboards
- [ ] Autonomous cost anomaly detection
