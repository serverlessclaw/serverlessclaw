###############################################################################
# Makefile.test: Testing targets
###############################################################################
include makefiles/Makefile.shared.mk

.PHONY: test test-watch test-ui test-coverage

test: ## Run unit tests with vitest
	@$(call log_step,Running unit tests...)
	@$(PNPM) run test

test-watch: ## Run unit tests in watch mode
	@$(PNPM) run test:watch

test-ui: ## Run unit tests with Vitest UI
	@$(PNPM) run test:ui

test-coverage: ## Run unit tests with coverage reporting
	@$(call log_info,Running tests with coverage...)
	@$(PNPM) exec vitest run --coverage
