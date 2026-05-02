# Serverless Claw — Agent Entrypoint

> [!IMPORTANT]
> **MANDATORY START**: All AI agents (Copilot, Windsurf, Cody, etc.) MUST start here.

This directory contains agent-optimized instructions that act as the interface between you and the project documentation.

## Context Load Order (Task-Based)

1.  **Always read** [Architecture Mapping](./architecture/mapping.md) for the high-level system layout.
2.  **If Engineering (Code Changes)**: Load [Engineering Standards](./engineering/standards.md).
3.  **If Infrastructure (SST/AWS)**: Load [Infra Checklist](./devops/infra-checklist.md).
4.  **If DevOps (CI/CD/Make)**: Load [Operational Rules](./devops/operations.md).

## Synchronization Rule (AEO-1)

- The documentation in `docs/` is the **Source of Truth**.
- These instructions are **Operational Constraints**.
- If a doc in `docs/` changes, you MUST verify if any corresponding rule in this directory needs updating.
- Use the [Documentation Map](../../INDEX.md#hub-and-spoke-map) to find relevant spokes.
