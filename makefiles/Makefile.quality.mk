###############################################################################
# Makefile.quality: Linting, formatting, and type-checking
###############################################################################
include makefiles/Makefile.shared.mk

.PHONY: check fix lint lint-fix format format-check type-check aiready lint-staged

check: ## Run all quality checks (lint, format, type-check)
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
	@$(PNPM) exec prettier --check "core/**/*.ts" "infra/**/*.ts"

type-check: ## Run TypeScript type checking
	@$(call log_info,Type checking with tsc...)
	@$(PNPM) exec tsc --noEmit

aiready: ## Run AIReady scan to evaluate agent-friendliness
	@$(call log_info,Running AIReady scan (threshold 80)...)
	@aiready scan . --threshold 80 --exclude "node_modules/**,.sst/**" || $(call log_warning,AIReady scan failed or returned warnings)

lint-staged: ## Run lint-staged for partial checks
	@$(call log_info,Running lint-staged...)
	@npx lint-staged
