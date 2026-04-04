# DevOps & Task Automation

> **Navigation**: [← Index Hub](../INDEX.md)

> **Agent Context Loading**: Load this file when you need to run quality checks, tests, deployments, or releases.

## The Hub-and-Spoke Philosophy

Serverless Claw uses a modular **Hub-and-Spoke Makefile** system to manage all automation. This replaces scattered `package.json` scripts with a single entry point that provides dynamic help and standardized logging.

### The Hub: `Makefile`

The main `Makefile` at the root is the "Hub". It includes specialized "Spoke" files from the `makefiles/` directory.

### The Spokes

- **Quality ([Makefile.quality.mk](../makefiles/Makefile.quality.mk))**: Linting, formatting, type-checking, and AI-readiness scans.
- **Test ([Makefile.test.mk](../makefiles/Makefile.test.mk))**: Unit tests (Vitest) and deployment health verification.
- **Deploy ([Makefile.deploy.mk](../makefiles/Makefile.deploy.mk))**: SST v4 infrastructure management (`dev`, `deploy`, `remove`).
- **Release ([Makefile.release.mk](../makefiles/Makefile.release.mk))**: Production release orchestration (test -> deploy -> verify -> tag).
- **Shared ([Makefile.shared.mk](../makefiles/Makefile.shared.mk))**: Common macros, colors, and environment loading.

---

## Common Commands

| Command               | Category | Description                                                 |
| --------------------- | -------- | ----------------------------------------------------------- |
| `make help`           | Hub      | Show all available targets in a categorized markdown table  |
| `make dev`            | Deploy   | Start local development mode with SST Ion                   |
| `make check`          | Quality  | Run all quality checks (lint, format, type-check)           |
| `make test`           | Test     | Run the full unit test suite                                |
| `make verify URL=...` | Test     | Verify deployed `/health` endpoint returns success          |
| `make release`        | Release  | Perform a full production release + Git tagging             |
| `make test-affected`  | Test     | Run only tests affected by recent changes (smart selection) |
| `make security-scan`  | Test     | Scan dependencies for security vulnerabilities              |
| `make docs-check`     | Test     | Validate documentation is in sync with code                 |
| `make manifest`       | CI       | Generate a failure manifest from CI logs                    |

Note: SST-related Make targets invoke the workspace-local SST binary (`./node_modules/.bin/sst`) directly. Run `pnpm install` first so this binary is available.

### Stage Hygiene (Safety-Critical)

- Local development must use stage `local`: `make dev` (defaults to `LOCAL_STAGE=local`).
- Deployment uses a single environment (default: `prod`): `make deploy` or `make release`.
- Do not run `sst dev` against the deployment stage.

---

## Principles-to-Operations Checklist

Use this checklist to enforce [Principles](./PRINCIPLES.md) as measurable operations instead of intent-only guidance.

| Principle Area                           | Operational Gate                                                 | Command(s)                                                         | Cadence                                               | Evidence                                      |
| ---------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------- |
| Safety-First + Governance Boundaries     | Protected changes require explicit human approval before release | `make release` (only after approval recorded in PR/change request) | Per high-risk change                                  | Approval record + release logs                |
| Mandatory Quality Sweeps                 | Lint, format, type-check, and tests must pass                    | `make gate` or `make check && make test`                           | Every push/merge                                      | CI job status + test output                   |
| AI-Native + AI-Readiness                 | Enforce agent-friendliness score threshold                       | `make aiready`                                                     | Every push/merge                                      | AIReady scan output                           |
| Reliability and Regression Control       | Coverage floor and trend regression detection                    | `make test-coverage-ci` and `make test-coverage-trend`             | On merge + weekly trend check                         | Coverage summary + `coverage-trend-report.md` |
| Security and Supply-Chain Trust          | Dependency vulnerability scanning at defined severity threshold  | `make security-scan` (optionally `SEVERITY=critical`)              | At least weekly and before release                    | `security-audit-report.md`                    |
| Documentation and Auditability           | Documentation must stay aligned with system behavior changes     | `make docs-check`                                                  | Every PR touching architecture/agents/tools/makefiles | `docs-validation-report.md`                   |
| Deployment Health and Recovery Readiness | Post-deploy health verification must pass                        | `make verify URL=<env-health-endpoint>`                            | Every deployment/release                              | Health check logs                             |
| Proactive and Efficient Stage Hygiene    | Local-only dev stage and controlled deploy stage usage           | `make dev` for local, `make deploy`/`make release` for shared env  | Always                                                | Command history + pipeline logs               |

### Release-Minimum Checklist

Before any production release, all items below must be true:

1. `make gate` passes.
2. `make test` passes.
3. `make aiready` passes with threshold **80+**.
4. `make security-scan` passes at your chosen severity policy.
5. `make docs-check` reports no blocking drift.
6. `make verify URL=...` passes after deployment.
7. Human approval is recorded for any Governance Class C change from [PRINCIPLES.md](./PRINCIPLES.md).

CodeBuild enforcement: the release pipeline in [buildspec.yml](../buildspec.yml) runs these checks as **blocking gates** (not warnings) for non-`SYNC_ONLY` deployments.

---

## Autonomous Remediation & Failure Manifests

To support self-evolution and agentic improvement, the pipeline generates a machine-readable **Failure Manifest** when a quality gate or deployment fails.

### The Failure Manifest (`failure-manifest.json`)

When a build fails in CodeBuild, a `failure-manifest.json` is generated and uploaded as a build artifact. This manifest transforms unstructured log data into high-signal context for the **Coder Agent**.

**Schema:**

```json
{
  "timestamp": "2024-03-28T12:00:00Z",
  "buildId": "codebuild:12345",
  "commitHash": "a1b2c3d4",
  "triggeredBy": {
    "author": "Agent <agent@serverlessclaw.local>",
    "message": "feat: autonomous improvement",
    "changedFiles": ["core/agents/coder.ts"]
  },
  "failures": [
    {
      "gate": "test",
      "command": "make test",
      "exitCode": 1,
      "logPath": "/tmp/ci-logs/test.log",
      "summary": "FAIL core/handlers/events.test.ts > should handle failure",
      "errorType": "test",
      "affectedPackages": ["@claw/core"],
      "affectedFiles": ["core/handlers/events.test.ts"],
      "rawErrors": ["AssertionError: expected false to be true"]
    }
  ],
  "nextStep": "fix_requested"
}
```

### The Remediation Loop

1. **Failure Detection**: `BuildMonitor` captures the `FAILED` state from CodeBuild.
2. **Context Enrichment**: `BuildMonitor` fetches `failure-manifest.json` from S3 and attaches it to the `SYSTEM_BUILD_FAILED` event.
3. **Agent Dispatch**: `SuperClaw` receives the event and dispatches the **Coder Agent** with the manifest as metadata.
4. **High-Signal Fix**: The Coder Agent uses the `failures` array to pinpoint the exact file and error, bypassing the need to parse raw CloudWatch logs. If the agent needs to read full log files or other artifacts, it uses the `aws-s3_read_file` tool (MCP).
5. **Pre-Flight Validation**: The Agent MUST run `make fix` and `make check` locally before calling `triggerDeployment` again.

### Deployment & Remediation Flows

The system distinguishes between direct single-agent deployments and parallel swarm deployments.

#### 1. Single Coder Workflow (Direct)

```text
[ Coder Agent ]
      |
      +-- (1) implements logic & tests
      |
      +-- (2) tool: stageChanges() --------> [ S3 Bucket ]
      |       (zips local files)        (staged_changes.zip)
      |                                        |
      +-- (3) tool: triggerDeployment()        |
                   |                           |
                   v                           |
          [ CodeBuild Pipeline ] <-------------+
          (pulls main + unzips S3)
                   |
         +---------+---------+
         |                   |
    [ SUCCESS ]          [ FAILURE ]
         |                   |
  (4) git push main          +--> [ Build Monitor ]
  (Final Sync)                       |
                               (5) event: SYSTEM_BUILD_FAILED
                                   (Attach failure-manifest.json)
                                     |
                                     v
[ Coder Agent ] <-------------- [ SuperClaw ]
      |
  (6) Init Workspace (Main branch)
  (7) Reads manifest, fixes, and loops back to (2)
```

#### 2. Parallel Swarm Workflow (Merger)

In parallel flows, Coders produce "Patches" which are reconciled by a Merger Agent before deployment.

```text
[ SuperClaw ] --(Decompose)--> [ Coder A ]  &  [ Coder B ]
                                    |              |
                                    +---(Patch A)--+---(Patch B)
                                             |
                                             v
                                     [ Merger Agent ]
                                             |
                            (1) Reconcile Patch A + Patch B
                                             |
                            (2) tool: stageChanges() --------> [ S3 Bucket ]
                                (zips the COMBINED code)    (staged_changes.zip)
                                             |                       |
                            (3) tool: triggerDeployment()            |
                                             |                       |
                                             v                       |
                                    [ CodeBuild Pipeline ] <---------+
                                    (Main + Combined Zip)
                                             |
                                   +---------+---------+
                                   |                   |
                              [ SUCCESS ]          [ FAILURE ]
                                   |                   |
                            (4) git push main          +--> [ Build Monitor ]
                                                               |
                                                         (5) event: SYSTEM_BUILD_FAILED
                                                             (Attach failure-manifest.json)
                                                               |
                                                               v
[ Coder Agent (The Fixer) ] <---------------------------- [ SuperClaw ]
      |
  (6) Init Workspace (Main branch)
      +-- **CRITICAL**: Download & Unzip S3 staged_changes.zip
      |   (Fixer now sees Coder A + Coder B's work as "Unstaged")
      |
  (7) Debugs the COMBINED failure, fixes, and re-triggers
```

### Workspace Layering Logic

To ensure agents always work on high-signal context, the **Agent Workspace Manager** reconstructs the exact state of the failed build:

1.  **Base Layer (The "Last Deployment")**: The agent copies everything from `/var/task` (the latest stable code that passed the previous pipeline) into a writable `/tmp/workspace/` directory.
2.  **Virtual Trunk**: The agent runs `git init` and `git commit` to establish a local baseline.
3.  **Remediation Layer (The "Staged Changes")**: If remediating a failure (`applyStagedChanges: true`), the agent downloads `staged_changes.zip` from S3 and unzips it over the base layer.
4.  **Result**: The agent sees the Merger's uncommitted work as "Unstaged Changes," allowing for a non-destructive fix that preserves parallel work.

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

1. `pnpm lint --fix`: Applies lint auto-fixes up front.
2. `make lint-staged`: Runs incremental checks on changed files only.
3. `make test-silent`: Runs unit tests in low-noise mode.

### Pre-push (`.husky/pre-push`)

Triggers `make pre-push`, which runs:

1. `make verify-up-to-date`: Ensures you are pushing on top of the latest remote changes.
2. `make gate`: Full quality sweep (lint, format, type-check, tests, coverage).
3. `make aiready`: Enforces an AI-readiness score of **80+** via `aiready scan . --threshold 80 --ci`.

---

## Automated Review & Testing System

The project includes an automated review and testing system to help keep up with rapid changes. This system provides smart test selection, security scanning, and documentation validation.

### Smart Test Runner (`make test-affected`)

Analyzes code changes and runs only tests that are affected by those changes, significantly reducing test execution time for incremental changes.

**Usage:**

```bash
# Compare HEAD with main (default)
make test-affected

# Compare with a specific branch
make test-affected BASE=feature-branch

# Compare with previous commit
make test-affected BASE=HEAD~1
```

**How it works:**

1. Gets list of changed files between two git references
2. Builds a dependency graph of all source files
3. Identifies which test files depend on changed files
4. Runs only the affected tests

**Benefits:**

- 60-80% reduction in test execution time for incremental changes
- Faster feedback during development
- Maintains test coverage while reducing CI time

### Security Scanner (`make security-scan`)

Scans project dependencies for known vulnerabilities and generates a report.

**Usage:**

```bash
# Scan all vulnerabilities (default threshold: high)
make security-scan

# Only fail on critical vulnerabilities
make security-scan SEVERITY=critical

# Attempt automatic fixes
make security-scan FIX=true
```

**Features:**

- Runs `pnpm audit` and parses results
- Generates markdown report with vulnerability details
- Groups findings by severity (critical, high, moderate, low)
- Optional auto-fix capability
- Integrates with CI/CD pipelines (fails on threshold violations)

**Reports:**

- Console output with color-coded severity
- `security-audit-report.md` file generated in project root

### Documentation Validator (`make docs-check`)

Validates that documentation stays in sync with code changes.

**Usage:**

```bash
# Check docs against main branch (default)
make docs-check

# Compare with a specific branch
make docs-check BASE=feature-branch

# Fail on warnings (strict mode)
make docs-check STRICT=true
```

**Checks performed:**

1. **Missing Updates**: Verifies that code changes include required documentation updates based on file mappings:
   - `core/agents/` → `docs/AGENTS.md`
   - `core/tools/` → `docs/TOOLS.md`
   - `core/handlers/events.ts` → `ARCHITECTURE.md`
   - `core/lib/memory/` → `docs/MEMORY.md`
   - `infra/` → `ARCHITECTURE.md`
   - `makefiles/` → `docs/DEVOPS.md`

2. **Broken Links**: Scans all markdown files for broken internal links

3. **Diagram Validation**: Checks ASCII diagrams for proper formatting

4. **Required Docs**: Ensures essential documentation files exist

**Reports:**

- Console output with issue details
- `docs-validation-report.md` file generated in project root

### Integration with CI/CD

These tools integrate seamlessly with the existing quality gates:

**Pre-commit hooks:**

```bash
# Add to .husky/pre-commit for automatic checking
make test-affected
make docs-check
```

**Pre-push hooks:**

```bash
# Add to .husky/pre-push for comprehensive validation
make security-scan
```

**Release process:**

```bash
# Include in release workflow
make test-affected
make security-scan
make docs-check
make release
```

### Coverage Enforcement (CI)

The CI pipeline enforces code coverage thresholds to prevent regressions:

| Metric     | Threshold | Description                 |
| ---------- | --------- | --------------------------- |
| Lines      | 70%       | Statement coverage          |
| Functions  | 70%       | Function/method coverage    |
| Branches   | 70%       | Conditional branch coverage |
| Statements | 70%       | Overall statement coverage  |

**CI Commands:**

```bash
# Run coverage with CI enforcement (fails if thresholds not met)
make test-coverage-ci

# Track coverage trends and detect regressions
make test-coverage-trend

# Update coverage baseline after improvements
make test-coverage-trend UPDATE_BASELINE=true
```

**Coverage Trend Tracking:**

The `make test-coverage-trend` command:

- Tracks coverage over time (last 100 entries)
- Detects coverage regressions (default: 5% drop threshold)
- Generates a markdown report (`coverage-trend-report.md`)
- Maintains a baseline file (`.coverage-baseline.json`)

### Best Practices

1. **Use `make test-affected` during development** for faster feedback
2. **Run `make security-scan` weekly** to catch new vulnerabilities
3. **Run `make docs-check` before commits** to ensure documentation stays current
4. **Set appropriate severity thresholds** for security scans in CI/CD
5. **Review generated reports** to understand and address issues
