# Infrastructure Provisioning & Environments

> **Navigation**: [← Index Hub](../../INDEX.md)

This document outlines the infrastructure architecture, environment strategy, and resource management for Serverless Claw.

## 🏗️ Infrastructure Overview

Serverless Claw is built on AWS using the **SST (Serverless Stack)** framework. This ensures that the entire system is defined as code, is globally distributed, and scales from zero to peak demand automatically.

### Core Stack Components

| Component     | AWS Service      | Purpose                                 |
| :------------ | :--------------- | :-------------------------------------- |
| **Compute**   | AWS Lambda       | Event-driven agents and system handlers |
| **Database**  | DynamoDB         | Low-latency state, memory, and settings |
| **Events**    | EventBridge      | Asynchronous "AgentBus" orchestration   |
| **Real-time** | IoT Core (MQTT)  | Low-latency signals to the dashboard    |
| **Secrets**   | SM / SST Secrets | Secure storage for API keys and tokens  |
| **Storage**   | Amazon S3        | Knowledge vectors and trace archival    |
| **UI**        | Next.js (SST)    | The ClawCenter dashboard                |

---

## 💾 Storage Layer (DynamoDB)

Data is partitioned to ensure strict multi-tenant isolation and millisecond-level retrieval.

### Primary Tables

| Table           | Key Pattern                    | Purpose                                          |
| :-------------- | :----------------------------- | :----------------------------------------------- |
| **MemoryTable** | `PK: userId`, `SK: timestamp`  | Long-term facts, lessons, and sessions           |
| **ConfigTable** | `PK: configId`                 | Global system settings and circuit breaker state |
| **TraceTable**  | `PK: traceId`, `SK: timestamp` | Granular execution logs for all agents           |

> [!TIP]
> Use the `Memory Management` dashboard sector to audit and prune stale memories.

---

## 🌩️ Resource Lifecycle

All resources are managed via the `infra/` directory.

- **`infra/api.ts`**: API Gateway and routes.
- **`infra/bus.ts`**: EventBridge EventBus and Rules.
- **`infra/db.ts`**: DynamoDB tables and S3 buckets.
- **`infra/agents.ts`**: Lambda function definitions for all agents.
- **`infra/dashboard.ts`**: Next.js site configuration.

### Provisioning Standards

1. **Tagging**: All resources are tagged with `Project: serverlessclaw` for cost tracking.
2. **Access Control**: Agents only have the minimum IAM permissions required for their specific role (defined in `infra/agents.ts`).
3. **Encryption**: All data at rest is encrypted using AWS-managed CMKs.

---

## 🌍 Environment Strategy

Serverless Claw uses a tiered environment strategy to ensure stability while allowing rapid innovation.

### 1. Development (`dev`)

- **Purpose**: Local feature development and rapid iteration.
- **Target**: Deployed to personal AWS accounts using `npx sst dev`.
- **Identity**: Each developer uses their own stage name (e.g., `make dev ENV=joe`).

### 2. Staging (`staging`)

- **Purpose**: Pre-release verification and integration testing.
- **Target**: Shared AWS account.
- **Trigger**: Manually triggered from the `main` branch.

### 3. Production (`prod`)

- **Purpose**: Live environment for end users.
- **Target**: Dedicated production AWS account.
- **Trigger**: Manually triggered via `make deploy ENV=prod`.

---

## 🔑 Secret Management

Serverless Claw uses SST Secrets to securely manage 3rd-party integration tokens.

| Secret Name            | Integration | Purpose                          |
| :--------------------- | :---------- | :------------------------------- |
| **`TelegramBotToken`** | Telegram    | Primary chat interface token     |
| **`DiscordBotToken`**  | Discord     | Secondary chat interface token   |
| **`SlackBotToken`**    | Slack       | Internal team notification token |

### Setting Secrets

To set a secret for your current environment:

```bash
npx sst secret set [SecretName] [Value]
```

Example:

```bash
npx sst secret set TelegramBotToken 123456:ABC-DEF
```

---

> [!IMPORTANT]
> **No CI/CD**: To ensure maximum intentionality and security, automatic deployments via GitHub Actions are disabled. All infrastructure changes must be performed through the local `make deploy` workflow after local verification.

> [!TIP]
> Use `make help` to see all available environment management commands.
