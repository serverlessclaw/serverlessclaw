###############################################################################
# Makefile.test: Testing targets
###############################################################################
include makefiles/Makefile.shared.mk

.PHONY: test test-watch test-ui test-coverage verify

verify: ## Verify the deployment health. Usage: make verify URL=https://...
	@$(call log_info,Verifying deployment health at $(URL)...)
	@if [ -z "$(URL)" ]; then $(call log_error,URL is required for verification); exit 1; fi
	@curl -s --fail $(URL)/health > /dev/null || { $(call log_error,Health check failed at $(URL)); exit 1; }
	@$(call log_success,Deployment at $(URL) is healthy)

test: ## Run unit tests with vitest
	@$(call log_step,Running unit tests...)
	@$(PNPM) run test

test-silent: ## Run unit tests in silent mode for hooks
	@$(call log_step,Running unit tests (silent)...)
	@$(PNPM) run test:silent

test-watch: ## Run unit tests in watch mode
	@$(PNPM) run test:watch

test-ui: ## Run unit tests with Vitest UI
	@$(PNPM) run test:ui

test-coverage: ## Run unit tests with coverage reporting
	@$(call log_info,Running tests with coverage...)
	@$(PNPM) exec vitest run --coverage
