# Architecture Mapping

## Core Directories
- `core/`: Business logic, agents, tools, and handlers.
- `infra/`: SST/AWS infrastructure definitions.
- `dashboard/`: Next.js web interface.
- `scripts/`: Quality and utility scripts.

## System Topology
For a detailed map of AWS resources and data flow, see [ARCHITECTURE.md](../../ARCHITECTURE.md).

## Critical Symbols
- **SuperClaw**: The main orchestrator Lambda.
- **Coder Agent**: Agent responsible for autonomous code changes.
- **ClawCenter**: The central monitoring dashboard.
