# Serverless Claw

**Serverless Claw** is a fully autonomous, serverless implementation of the **OpenClaw** AI agent platform. It is designed from the ground up to be **Self-Evolving**, **Self-Healing**, and **Self-Cost Optimizing**. Deployed entirely on AWS using [SST (v4)](https://sst.dev), Serverless Claw features an orchestrated swarm of intelligent agents capable of writing code, modifying their own AWS infrastructure, and deploying updates with zero human intervention.

![Serverless Claw Dashboard](./dashboard/public/clawcenter.png)

## 🧬 Core Philosophies

### 1. Git-Driven Dynamic Evolution
As a serverless stack, the deployed infrastructure is immutable between releases, but the system's *capabilities* are never static. Through the **Cognition Reflector**, **Strategic Planner**, **Coder**, and **QA Auditor** agents, Serverless Claw autonomously discovers gaps and designs plans that result in verified git-commits and redeployments.
 Evolution follows a strict, verified lifecycle (**OPEN** → **PLANNED** → **PROGRESS** → **DEPLOYED** → **DONE**). No change is marked as complete until the **QA Auditor** verifies its real-world satisfaction in subsequent user interactions. **[Read more about the Evolutionary Lifecycle ↗](./docs/AGENTS.md#the-evolutionary-lifecycle-self-evolution-loop)**

### 2. Self-Healing & Resilient
Designed to be "un-killable." If an autonomous deployment fails, the **Build Monitor** retrieves the **Context-Aware Trace** (linking the failure to the original reasoning session) and tasks the agent swarm to investigate. If a component detects an internal violation (e.g., database failure), it emits a **Self-Reporting Signal** to the SuperClaw for autonomous triage. For catastrophic failures, an immutable **Dead Man's Switch** triggers a 100% automated git-revert and redeploys the last known stable state.

### 3. Self-Cost Optimizing (Zero Idle Costs)
Traditional AI agents run on expensive, always-on instances. Serverless Claw is 100% serverless. Powered by AWS Lambda, DynamoDB, and EventBridge, **you pay strictly per invocation**. When the agent is idle, your infrastructure cost is exactly $0.00. The system also dynamically hot-swaps between LLM models (e.g., OpenAI, Anthropic Bedrock) based on the task's complexity, optimizing token costs on the fly.

### 4. Human-Agent Memory Co-Management
Avoid the "black box" of agent long-term memory. Through the **ClawCenter Dashboard**, humans can audit distilled tactical lessons and strategic capability gaps. You can explicitly **prioritize** what the system should focus on next or "weed" the memory garden.

### 5. Self-Aware Discovery
The system maintains a real-time topology of itself. Using the **Build Monitor** and the `listAgents` tool, Serverless Claw nodes autonomously discover each other and their underlying infrastructure, ensuring that the system remains coherent as it expands with new specialized agents.

## 🏗️ Architecture & Tech Stack

### Dashboard Organization (ClawCenter)
The dashboard is structured into four primary command sectors:
- **Intelligence**: Real-time chat interface and high-fidelity neural traces.
- **Evolution**: Management of agent personas, tiered memory (Facts, Lessons, Gaps), and tool capabilities.
- **Infrastructure**: System pulse (real-time topology), session traffic control, and global hot-swappable configuration.
- **Observability**: Security manifests and self-healing resilience hubs.

### Tiered Memory Engine
Serverless Claw uses a tiered, evolutionary memory system:
- **`DISTILLED#` (Facts)**: Long-term user preferences and project context.
- **`LESSON#` (Tactical)**: Short-term heuristics and technical "gotchas" learned from errors.
- **`GAP#` (Strategic)**: A backlog of missing capabilities identified by the Reflector.
- **`TRACE#` (Short-term)**: Mechanical execution logs of current and recent sessions.

### Tech Stack Overview
- **Framework**: [SST (Serverless Stack) v3 / Ion](https://sst.dev)
- **Compute**: AWS Lambda (Node.js)
- **Database**: AWS DynamoDB (Single-Table Design)
- **Storage**: AWS S3
- **Event Bus**: AWS EventBridge (The **AgentBus**)
- **CI/CD**: AWS CodeBuild
- **Admin Dashboard**: Next.js 16 (React 19), TailwindCSS v4, deployed via OpenNext
- **AI / LLMs**: OpenAI (GPT-5.4, GPT-5-mini), Anthropic Claude 4.6 Sonnet (via Amazon Bedrock), OpenRouter (Gemini-3 Flash, GLM-5, Minimax 2.5)
- **Language**: TypeScript

### ASCII Architecture Diagram

```text
                                  +-----------------------------------+
                                  |         Next.js Dashboard         |
                                  | (Intelligence, Evolution, Infra)  |
                                  +-----------------------------------+
                                                  |
                                                  v
+----------------+      HTTP       +----------------------------------+
| User / Webhook | --------------->|        Amazon API Gateway        |
+----------------+                 +----------------------------------+
                                                  |
                                                  v
                                  +-----------------------------------+
                                  |    SuperClaw (AWS Lambda)        |
                                  |  (Orchestrator, LLM Integration)  |
                                  +-----------------------------------+
                                                  |
                                                  v
                                  +-----------------------------------+
                                  |        AWS EventBridge            |
                                  |     (Asynchronous AgentBus)       |
                                  +-----------------------------------+
                                   /        |            |        \
                                  /         |            |         \
                  +----------------+ +------------------+ +------------------+ +---------------+
                  |  Coder Agent   | |Strategic Planner | |Cognition Reflector| | QA Auditor    |
                  |  (AWS Lambda)  | |   (AWS Lambda)   | |   (AWS Lambda)    | | (AWS Lambda)  |
                  +----------------+ +------------------+ +------------------+ +---------------+
                           |                |                |               |
                           +----------------+-------+--------+---------------+
                                                    |
                   +------------------------------------------------------------------+
                   |                    AWS Services & Resources                      |
                   |                                                                  |
                   |  [ DynamoDB ]   [ S3 Bucket ]   [ AWS CodeBuild ]   [ Secrets ]  |
                   | (Memory/Traces) (Staging Code)  (Self-Deployment)   (API Keys)   |
                   +------------------------------------------------------------------+
                                                   |
                   +------------------------------------------------------------------+
                   |                 Build Monitor & Dead Man's Switch                |
                   |                (Self-Healing & Rollback Mechanisms)              |
                   +------------------------------------------------------------------+
```

## Quick Start

```bash
pnpm install
# Populate .env with SST_SECRET_ prefixes (e.g. SST_SECRET_OpenAIApiKey)
make dev
```

## Resilience & Safety Guardrails
- **Circuit Breaker**: Prevents "Deployment Death Spirals" by limiting deploys (Default: 5/day).
- **Recursion Limit**: Protects against infinite agent-to-agent delegation loops (Default: 50).
- **Self-Reporting Health**: Standardized internal signaling (`SYSTEM_HEALTH_REPORT`) that allows components to request autonomous triage from SuperClaw.
- **Optimization Policy**: Global toggle for `Aggressive` (Quality-first) or `Conservative` (Cost-first) reasoning.
- **Dead Man's Switch**: Immutable health probe that triggers automated git-reverts on failure.
- **Protected Scopes**: Hardcoded list of files (e.g., `sst.config.ts`) that require human approval to modify.


## Documentation

📖 Start with **[INDEX.md](./INDEX.md)** — the documentation hub for both humans and agents.

| Doc | Purpose |
|-----|---------|
| [INDEX.md](./INDEX.md) | **Hub** — start here, progressive context loading map |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System topology & detailed AWS resource diagram |
| [docs/DEVOPS.md](./docs/DEVOPS.md) | **DevOps Hub** — automation, make targets, & CI/CD |
| [docs/AGENTS.md](./docs/AGENTS.md) | Agent roster, orchestration flow, prompt summaries |
| [docs/MEMORY.md](./docs/MEMORY.md) | Tiered memory engine & co-management prioritization |
| [docs/TOOLS.md](./docs/TOOLS.md) | Full tool registry & deployment lifecycle |
| [docs/SAFETY.md](./docs/SAFETY.md) | Circuit breakers, rollback, HITL guardrails |
| [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Dev workflow & documentation standards |
| [docs/RESEARCH.md](./docs/RESEARCH.md) | Architectural decisions & design research |
| [docs/ROADMAP.md](./docs/ROADMAP.md) | Planned features |

## License
MIT
