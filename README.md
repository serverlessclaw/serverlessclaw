# Serverless Claw

**Serverless Claw** is a fully autonomous, serverless implementation of the **OpenClaw** AI agent platform. It is designed from the ground up to be **Self-Evolving**, **Self-Healing**, and **Self-Cost Optimizing**. Deployed entirely on AWS using [SST (v3/Ion)](https://sst.dev), Serverless Claw features an orchestrated swarm of intelligent agents capable of writing code, modifying their own AWS infrastructure, and deploying updates with zero human intervention.

![Serverless Claw Dashboard](./dashboard/public/clawcenter.png)

## 🧬 Core Philosophies

### 1. Self-Evolving (Verified & Audited)
The system is never static. Through the **Reflector**, **Planner**, **Coder**, and **QA Auditor** agents, Serverless Claw autonomously discovers gaps, designs plans, writes new tools, and modifies its own infrastructure. Evolution follows a strict, verified lifecycle (**OPEN** → **PLANNED** → **PROGRESS** → **DEPLOYED** → **DONE**). No change is marked as complete until the **QA Auditor** verifies its real-world satisfaction in subsequent user interactions. **[Read more about the Evolutionary Lifecycle ↗](./docs/AGENTS.md#the-evolutionary-lifecycle-self-evolution-loop)**

### 2. Self-Healing & Resilient
Designed to be "un-killable." If an autonomous deployment introduces a bug or causes a build failure, the **Build Monitor** intercepts the error logs and tasks the agent swarm to investigate and apply a fix. If the "brain" (Main Agent Lambda) becomes unresponsive, an immutable **Dead Man's Switch** (health probe) triggers a 100% automated git-revert and redeploys the last known stable state. No midnight wake-up calls.

### 3. Self-Cost Optimizing (Zero Idle Costs)
Traditional AI agents run on expensive, always-on instances. Serverless Claw is 100% serverless. Powered by AWS Lambda, DynamoDB, and EventBridge, **you pay strictly per invocation**. When the agent is idle, your infrastructure cost is exactly $0.00. The system also dynamically hot-swaps between LLM models (e.g., OpenAI, Anthropic Bedrock) based on the task's complexity, optimizing token costs on the fly.

### 4. Human-Agent Memory Co-Management
Avoid the "black box" of agent long-term memory. Through the **ClawCenter Dashboard**, humans can audit distilled tactical lessons and strategic capability gaps. You can explicitly **prioritize** what the system should focus on next or "weed" the memory garden to remove hallucinations. This ensures long-term alignment between human intent and autonomous evolution.

## 🏗️ Architecture & Tech Stack

### Tech Stack Overview
- **Framework**: [SST (Serverless Stack) v3 / Ion](https://sst.dev)
- **Compute**: AWS Lambda (Node.js)
- **Database**: AWS DynamoDB (Single-Table Design)
- **Storage**: AWS S3
- **Event Bus**: AWS EventBridge
- **CI/CD**: AWS CodeBuild
- **Admin Dashboard**: Next.js 16 (React 19), TailwindCSS v4, deployed via OpenNext
- **AI / LLMs**: OpenAI (GPT-5.4, GPT-5-mini), Anthropic Claude 4.6 Sonnet (via Amazon Bedrock), OpenRouter (Gemini-3 Flash, GLM-5, Minimax 2.5)
- **Language**: TypeScript

### ASCII Architecture Diagram

```text
                                  +-----------------------------------+
                                  |         Next.js Dashboard         |
                                  | (Observability, Traces, Config)   |
                                  +-----------------------------------+
                                                  |
                                                  v
+----------------+      HTTP       +----------------------------------+
| User / Webhook | --------------->|        Amazon API Gateway        |
+----------------+                 +----------------------------------+
                                                  |
                                                  v
                                  +-----------------------------------+
                                  |    Main Agent (AWS Lambda)        |
                                  |  (Orchestrator, LLM Integration)  |
                                  +-----------------------------------+
                                                  |
                                                  v
                                  +-----------------------------------+
                                  |        AWS EventBridge            |
                                  |     (Asynchronous Task Bus)       |
                                  +-----------------------------------+
                                   /        |            |        \
                                  /         |            |         \
                  +----------------+ +--------------+ +-------------+ +-------------+
                  |  Coder Agent   | |Planner Agent | |Reflector Agt| | QA Auditor  |
                  |  (AWS Lambda)  | | (AWS Lambda) | | (AWS Lambda)| | (AWS Lambda)|
                  +----------------+ +--------------+ +-------------+ +-------------+
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
