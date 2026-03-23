# OpenClaw Core Research Summary

> **Last Updated**: 23 March 2026

This document summarizes the core features of [OpenClaw](https://github.com/openclaw/openclaw) as they apply to our serverless implementation.

## 1. Core Architecture: Hub-and-Spoke
OpenClaw centers on a **Gateway** (Control Plane) and an **Agent Runtime**.

| Component | OpenClaw (Local/Server) | Serverless Claw (AWS) |
| :--- | :--- | :--- |
| **Gateway** | Long-running Node.js process / WebSockets | API Gateway + Lambda (Webhook) |
| **Runtime** | Local OS execution | AWS Lambda (Stateless) |
| **Memory** | Markdown files / SQLite | DynamoDB (Global State) |
| **Orchestration** | Lane Queue (Serial) | DynamoDB Locking / SQS (Planned) |

## 2. Key Features to Port
- **Two-Tier Memory**:
    - *Transcript*: A raw JSONL log of every event.
    - *Distilled Memory*: A summary of key user facts (replacing `MEMORY.md`).
- **Plugin System**: Standardized interfaces for Channels, Tools, and Memory adapters.
- **Lane Queue**: Ensuring that messages for the same User/Session are processed in order to prevent state corruption.
- **Permission Manifest**: Plugins declaring what they can access (Lambda IAM roles handle this at the infraestructura level).

## 3. 2026 Model Optimization
OpenClaw was designed in 2025. In 2026, we optimize for:
- **Large Context Windows**: Utilizing GPT-5.4 and Claude 4.6 for massive history without excessive summarization.
- **Native Tool Calling**: Relying on 2026 model accuracy for complex tool chains.

## 4. Deployment Cost Mitigation
Self-evolving agents can be expensive if every small change triggers a full build.

- **Config-as-Data**: Move as much "soft logic" as possible into DynamoDB/S3 so the agent can "learn" without redeploying.
- **Human-in-the-loop (HITL)**: Mandatory PR review for infrastructure changes (`sst.config.ts`) to prevent accidental resource creation/deletion.
