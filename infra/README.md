# @claw/infra

Infrastructure layer for Serverless Claw using SST (Ion) and AWS.

## Architecture

This package defines the AWS resources and SST components:

- API Gateway and Lambdas
- DynamoDB Tables (ClawDB)
- EventBridge Bus (AgentBus)
- S3 Buckets (Knowledge, Staging)
- MCP Server infrastructure

## Development

- `pnpm test`: Run infrastructure unit tests.
- `pnpm run type-check`: Run TypeScript type-checks.
