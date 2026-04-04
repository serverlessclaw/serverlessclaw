###############################################################################
# Makefile.quality: Linting, formatting, and type-checking
###############################################################################
include makefiles/Makefile.shared.mk

.PHONY: check gate gate-deploy gate-tier-1 gate-tier-2 gate-fast fix lint lint-fix format format-check type-check aiready lint-staged

gate: ## Run all quality checks in parallel (via Turborepo) + E2E
	@$(call log_step,Running full quality gate in parallel via Turbo...)
	@$(PNPM) run gate
	@$(MAKE) test-e2e

gate-tier-1: ## Fast Tier 1 checks (via Turborepo)
	@$(call log_step,Running Tier 1 (Fast) gate via Turbo...)
	@$(PNPM) run check

gate-tier-2: ## Thorough Tier 2 checks (via Turborepo)
	@$(call log_step,Running Tier 2 (Thorough) gate via Turbo...)
	@$(PNPM) exec turbo run test-coverage aiready

gate-fast: ## Fast local gate (only affected packages)
	@$(call log_step,Running fast local gate via Turbo...)
	@$(PNPM) exec turbo run check test --filter="[origin/main]"

gate-deploy: ## Pre-deploy gate (Tier 1 + aiready + e2e)
	@$(call log_step,Running deploy gate via Turbo...)
	@$(PNPM) exec turbo run check aiready
	@$(MAKE) test-e2e

check: ## Run all quality checks (via Turborepo)
	@$(call log_step,Running all quality checks via Turbo...)
	@$(PNPM) run check
	@$(call log_success,Worktree is clean and of high quality)

fix: lint-fix format ## Run all auto-fixers (lint --fix, prettier)

lint: ## Run ESLint check
	@$(call log_info,Running ESLint via Turbo...)
	@$(PNPM) run lint

lint-fix: ## Run ESLint with --fix
	@$(call log_info,Fixing lint issues via Turbo...)
	@$(PNPM) run lint:fix

format: ## Run Prettier to format code
	@$(call log_info,Formatting code with Prettier...)
	@$(PNPM) run format

format-check: ## Check if code is formatted with Prettier
	@$(call log_info,Checking formatting via Turbo...)
	@$(PNPM) run format-check

type-check: ## Run TypeScript type checking
	@$(call log_info,Type checking via Turbo...)
	@$(PNPM) run type-check

aiready: ## Run AIReady scan to evaluate agent-friendliness
	@$(call log_info,Running AIReady scan via Turbo...)
	@$(PNPM) exec turbo run aiready

lint-staged: ## Run lint-staged for partial checks
	@$(call log_info,Running lint-staged...)
	@$(PNPM) exec lint-staged
