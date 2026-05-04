# @serverlessclaw/cli

The ServerlessClaw Command Line Interface (CLI) provides essential tools for synchronizing localized repositories with the central Mother Hub and managing the agentic evolution of the stack.

## 🚀 Overview

This CLI is the primary interface for triggering the **Issue-Driven Sync** protocol and validating the AI-readiness of the local environment. It abstracts complex Git subtree/fork operations into simple, high-level commands.

## 📦 Key Capabilities

- **Repository Sync**: Harmonize local changes with the Mother Hub via `subtree` or `fork` methods.
- **Verification**: Perform dry-runs and conflict checks before applying updates.
- **AI-Readiness Scanning**: Enforce system-wide documentation and code standards using the `aiready` suite.

## 🛠 Usage

The CLI is typically invoked via `npx` or `pnpm`:

```bash
# Sync with hub
pnpm run cli --hub <owner/repo> --prefix core/

# Check sync feasibility
pnpm run cli --hub <owner/repo> --check
```

## 📂 Structure

- `src/bin.ts`: Entry point and command parsing (built with Commander).
- `src/commands/`: Implementation of core CLI logic (e.g., `sync.ts`).
- `src/index.ts`: Programmatic export of CLI capabilities.

## 🚦 Standards

All CLI code must strictly adhere to the project's [Governance Standards](../docs/governance/STANDARDS.md) and pass the `make check` quality gate before submission.
