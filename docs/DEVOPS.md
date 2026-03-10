# DevOps & Task Automation

> **Agent Context Loading**: Load this file when you need to run quality checks, tests, deployments, or releases.

## The Hub-and-Spoke Philosophy

Serverless Claw uses a modular **Hub-and-Spoke Makefile** system to manage all automation. This replaces scattered `package.json` scripts with a single entry point that provides dynamic help and standardized logging.

### The Hub: `Makefile`
The main `Makefile` at the root is the "Hub". It includes specialized "Spoke" files from the `makefiles/` directory.

### The Spokes
- **Quality ([Makefile.quality.mk](../makefiles/Makefile.quality.mk))**: Linting, formatting, type-checking, and AI-readiness scans.
- **Test ([Makefile.test.mk](../makefiles/Makefile.test.mk))**: Unit tests (Vitest) and deployment health verification.
- **Deploy ([Makefile.deploy.mk](../makefiles/Makefile.deploy.mk))**: SST v3 infrastructure management (`dev`, `deploy`, `remove`).
- **Release ([Makefile.release.mk](../makefiles/Makefile.release.mk))**: Production release orchestration (test -> deploy -> verify -> tag).
- **Shared ([Makefile.shared.mk](../makefiles/Makefile.shared.mk))**: Common macros, colors, and environment loading.

---

## Common Commands

| Command | Category | Description |
|---------|----------|-------------|
| `make help` | Hub | Show all available targets in a categorized markdown table |
| `make dev` | Deploy | Start local development mode with SST Ion |
| `make check`| Quality | Run all quality checks (lint, format, type-check) |
| `make test` | Test | Run the full unit test suite |
| `make release`| Release | Perform a full production release + Git tagging |

---

## Environment & Secrets

### `.env` Loading
The system automatically loads environment variables from:
1. `.env.$(ENV).local` (e.g., `.env.dev.local`)
2. `.env.$(ENV)`
3. `.env.local`
4. `.env`

### Local Development Secrets
During `make dev`, variables prefixed with `SST_SECRET_` in your `.env` file are automatically linked to `sst.Secret` resources.

Example `.env`:
```bash
SST_SECRET_OpenAIApiKey=your-key
SST_SECRET_TelegramBotToken=your-token
```

---

## Git Hooks Integration

### Pre-commit (`.husky/pre-commit`)
Triggers `make pre-commit`, which runs:
1. `lint-staged`: Faster incremental checks for changed files only.
2. `make test`: Ensures unit tests pass.

### Pre-push (`.husky/pre-push`)
Triggers `make pre-push`, which runs:
1. `make check`: Full quality sweep.
2. `make test`: Full test suite.
3. `make aiready`: Enforces an AI-readiness score of **80+**.
