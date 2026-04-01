###############################################################################
# Makefile.quality: Linting, formatting, and type-checking
###############################################################################
include makefiles/Makefile.shared.mk

.PHONY: check gate gate-deploy gate-tier-1 gate-tier-2 gate-fast fix lint lint-fix format format-check type-check aiready lint-staged

gate: ## Run all quality checks in parallel (Tier 1 + Tier 2)
	@$(call log_step,Running full quality gate in parallel...)
	$(call run_parallel_gate,lint~$(MAKE) lint||format~$(MAKE) format-check||typecheck~$(MAKE) type-check||test~$(MAKE) test-coverage||aiready~$(MAKE) aiready)

gate-tier-1: ## Fast Tier 1 checks: lint, format, typecheck, test-silent
	@$(call log_step,Running Tier 1 (Fast) gate...)
	$(call run_parallel_gate,lint~$(MAKE) lint||format~$(MAKE) format-check||typecheck~$(MAKE) type-check||test~$(MAKE) test-silent)

gate-tier-2: ## Thorough Tier 2 checks: coverage, aiready
	@$(call log_step,Running Tier 2 (Thorough) gate...)
	$(call run_parallel_gate,test-coverage~$(MAKE) test-coverage||aiready~$(MAKE) aiready)

gate-fast: ## Fast local gate: lint, format, typecheck, test-affected
	@$(call log_step,Running fast local gate...)
	$(call run_parallel_gate,lint~$(MAKE) lint||format~$(MAKE) format-check||typecheck~$(MAKE) type-check||test~$(MAKE) test-affected)

gate-deploy: ## Pre-deploy gate (Tier 1 + aiready)
	@$(call log_step,Running deploy gate...)
	$(call run_parallel_gate,lint~$(MAKE) lint||format~$(MAKE) format-check||typecheck~$(MAKE) type-check||test~$(MAKE) test-silent||aiready~$(MAKE) aiready)

check: ## Run all quality checks sequentially (lint, format, type-check)
	@$(call log_step,Running all quality checks...)
	@$(MAKE) lint format-check type-check
	@$(call log_success,Worktree is clean and of high quality)

fix: lint-fix format ## Run all auto-fixers (lint --fix, prettier)

lint: ## Run ESLint check
	@$(call log_info,Running ESLint...)
	@$(PNPM) run lint

lint-fix: ## Run ESLint with --fix
	@$(call log_info,Fixing lint issues...)
	@$(PNPM) run lint:fix

format: ## Run Prettier to format code
	@$(call log_info,Formatting code with Prettier...)
	@$(PNPM) run format

format-check: ## Check if code is formatted with Prettier
	@$(call log_info,Checking formatting...)
	@$(PNPM) exec prettier --check "core/**/*.ts" "infra/**/*.ts" "scripts/**/*.ts" "dashboard/src/**/*.ts*"

type-check: ## Run TypeScript type checking
	@$(call log_info,Type checking with tsc...)
	@$(PNPM) exec tsc --noEmit

aiready: ## Run AIReady scan to evaluate agent-friendliness
	@$(call log_info,Running AIReady scan...)
	@$(PNPM) exec aiready scan . --threshold 80 --ci

lint-staged: ## Run lint-staged for partial checks
	@$(call log_info,Running lint-staged...)
	@$(PNPM) exec lint-staged
