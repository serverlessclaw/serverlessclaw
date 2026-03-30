###############################################################################
# Makefile.test: Testing targets
###############################################################################
include makefiles/Makefile.shared.mk

.PHONY: test test-watch test-ui test-coverage test-component test-e2e test-e2e-deployed verify test-tier-1 test-tier-2 test-tier-3 test-affected security-scan docs-check

test-tier-1: test-silent ## Run Tier 1: Unit tests (silent)

test-tier-2: test-coverage ## Run Tier 2: Coverage and Integration tests

test-tier-3: ## Run Tier 3: Deployment health and E2E
	@$(call log_step,Running Tier 3 (Deployment Verification)...)
	@if [ -z "$(URL)" ]; then $(call log_error,URL is required for Tier 3); exit 1; fi; \
	$(call run_parallel_gate,verify~$(MAKE) verify URL=$(URL)||e2e~$(MAKE) test-e2e-deployed URL=$(URL))

verify: ## Verify the deployment health. Usage: make verify URL=https://...
	@$(call log_info,Verifying deployment health at $(URL)...)
	@if [ -z "$(URL)" ]; then $(call log_error,URL is required for verification); exit 1; fi; \
	FINAL_URL=$(URL); \
	if ! curl -s --fail "$$FINAL_URL/health" > /dev/null; then \
		$(call log_warning,Custom domain health check failed. Attempting to find raw AWS endpoint...); \
		RAW_URL=$$(aws apigatewayv2 get-apis --region $(AWS_REGION) --query "Items[?contains(Name, '$(ENV)-WebhookApi')].ApiEndpoint" --output text); \
		if [ -n "$$RAW_URL" ] && [ "$$RAW_URL" != "None" ]; then \
			$(call log_info,Found raw endpoint: $$RAW_URL); \
			FINAL_URL=$$RAW_URL; \
		fi; \
	fi; \
	curl -s --fail "$$FINAL_URL/health" > /dev/null || { $(call log_error,Health check failed at $$FINAL_URL); exit 1; }; \
	$(call log_success,Deployment at $$FINAL_URL is healthy)


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

test-coverage: ## Run unit tests with coverage reporting (enforces 50% thresholds)
	@$(call log_info,Running tests with coverage (50% thresholds)...)
	@$(PNPM) exec vitest run --coverage

test-component: ## Run component tests (jsdom, via inline env directive)
	@$(call log_step,Running component tests...)
	@$(PNPM) exec vitest run --reporter=verbose '**/*.test.tsx'

test-e2e: ## Run E2E tests with Playwright (local dev server)
	@$(call log_step,Running E2E tests...)
	@$(PNPM) exec playwright test

test-e2e-deployed: ## Run E2E tests against deployed URL. Usage: make test-e2e-deployed URL=https://...
	@$(call log_step,Running E2E tests against deployed URL...)
	@if [ -z "$(URL)" ]; then $(call log_error,URL is required); exit 1; fi
	@BASE_URL=$(URL) $(PNPM) exec playwright test
