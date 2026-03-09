# Serverless Claw

**Serverless Claw** is a high-performance, cost-efficient, and scalable implementation of the [OpenClaw](https://github.com/openclaw/openclaw) AI agent stack, built on AWS using [SST (v3/Ion)](https://sst.dev).

## Why Serverless?

Traditional AI agents often require long-running servers to maintain WebSocket connections and local state. **Serverless Claw** reimagines this architecture:
- **Zero Idle Costs**: Pay only for the milliseconds your agent is actually processing.
- **Auto-Scaling**: Seamlessly handles one or one thousand concurrent users.
- **Reliability**: Leverages AWS Lambda and DynamoDB for institutional-grade stability.

## High-Level Architecture

The system is designed to be entirely stateless and highly modular. See the [**Architecture & Design Guide**](file:///Users/pengcao/projects/serverlessclaw/ARCHITECTURE.md) for ASCII diagrams and deep-dive logic.

## Developer First: Customization

Serverless Claw is built for developers who need to customize the agent's behavior:
- **Pluggable Tools**: Add any Node.js function as an agent tool.
- **Interchangeable Memory**: Swap DynamoDB for Redis, S3, or PostgreSQL.
- **Multi-Channel**: Extend the webhook to support WhatsApp, Discord, or custom web-sockets.
- **Provider-Agnostic**: Use OpenAI, Claude, or local LLMs through a unified interface.

## Quick Start

### 1. Prerequisites
- [pnpm](https://pnpm.io/) installed.
- AWS credentials configured.
- A Telegram or Discord Bot Token.

### 2. Installation
```bash
pnpm install
```

### 3. Configuration
Set your secrets:
```bash
npx sst secret set OpenAIApiKey YOUR_KEY
npx sst secret set TelegramBotToken YOUR_TOKEN
```

### 4. Deployment
```bash
pnpm exec sst deploy
```

## Documentation
For a detailed guide on deployment and integration, see the [Walkthrough](https://github.com/caopengau/serverlessclaw/blob/main/walkthrough.md) (or local file).

## License
MIT
