###############################################################################
# Makefile.test: Testing targets
###############################################################################
include makefiles/Makefile.shared.mk

.PHONY: test test-watch test-ui test-coverage test-coverage-ci test-coverage-trend test-component test-e2e test-e2e-deployed verify verify-deploy test-tier-1 test-tier-2 test-tier-3 test-affected security-scan docs-check

test-tier-1: test-silent ## Run Tier 1: Unit tests (silent)

test-tier-2: test-coverage ## Run Tier 2: Coverage and Integration tests

test-tier-3: ## Run Tier 3: Deployment health and E2E (uses .sst/outputs.json if URL/DASHBOARD_URL not provided)
	@$(call log_step,Running Tier 3 (Full Deployment Verification)...)
	@OUTPUTS=$$(cat .sst/outputs.json 2>/dev/null) ; \
	API_URL=$(URL); \
	if [ -z "$$API_URL" ] && [ -n "$$OUTPUTS" ]; then \
		API_URL=$$(echo "$$OUTPUTS" | python3 -c "import json,sys; print(json.load(sys.stdin).get('apiUrl',''))" 2>/dev/null) ; \
	fi ; \
	FINAL_DASHBOARD_URL=$(DASHBOARD_URL); \
	if [ -z "$$FINAL_DASHBOARD_URL" ] && [ -n "$$OUTPUTS" ]; then \
		FINAL_DASHBOARD_URL=$$(echo "$$OUTPUTS" | python3 -c "import json,sys; print(json.load(sys.stdin).get('dashboardUrl',''))" 2>/dev/null) ; \
	fi ; \
	if [ -z "$$API_URL" ]; then $(call log_error,API URL is required for Tier 3); exit 1; fi; \
	if [ -z "$$FINAL_DASHBOARD_URL" ]; then $(call log_error,DASHBOARD URL is required for Tier 3); exit 1; fi; \
	@$(call run_parallel_gate,verify~$(MAKE) verify URL=$$API_URL||e2e~$(MAKE) test-e2e-deployed URL=$$FINAL_DASHBOARD_URL)

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

verify-deploy: ## Full post-deploy verification: API, dashboard, CSS, JS
	@$(call log_step,Running post-deploy verification...) ; \
	OUTPUTS=$$(cat .sst/outputs.json 2>/dev/null) ; \
	if [ -z "$$OUTPUTS" ]; then $(call log_error,.sst/outputs.json not found); exit 1; fi ; \
	API_URL=$$(echo "$$OUTPUTS" | python3 -c "import json,sys; print(json.load(sys.stdin).get('apiUrl',''))" 2>/dev/null) ; \
	DASHBOARD_URL=$$(echo "$$OUTPUTS" | python3 -c "import json,sys; print(json.load(sys.stdin).get('dashboardUrl',''))" 2>/dev/null) ; \
	FAIL=0 ; \
	echo "" ; \
	echo "  =========================================" ; \
	echo "  DEPLOYMENT VERIFICATION" ; \
	echo "  =========================================" ; \
	echo "" ; \
	\
	if [ -n "$$API_URL" ]; then \
		STATUS=$$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$$API_URL/health") ; \
		if [ "$$STATUS" = "200" ]; then printf "  ✅ API /health:        HTTP %s\n" "$$STATUS"; else printf "  ❌ API /health:        HTTP %s\n" "$$STATUS"; FAIL=1; fi ; \
	else \
		printf "  ⚠️  API /health:        no apiUrl in outputs\n" ; \
	fi ; \
	\
	if [ -n "$$DASHBOARD_URL" ]; then \
		STATUS=$$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$$DASHBOARD_URL") ; \
		if [ "$$STATUS" = "200" ]; then printf "  ✅ Dashboard HTML:     HTTP %s\n" "$$STATUS"; else printf "  ❌ Dashboard HTML:     HTTP %s\n" "$$STATUS"; FAIL=1; fi ; \
		\
		if [ "$$STATUS" = "200" ]; then \
			HTML=$$(curl -s --max-time 15 "$$DASHBOARD_URL") ; \
			CSS_PATHS=$$(echo "$$HTML" | grep -o 'href="/_next/static/css/[^"]*\.css"' | sed 's/href="//;s/"//' | sort -u) ; \
			JS_PATHS=$$(echo "$$HTML" | grep -o 'src="/_next/static/[^"]*\.js"' | sed 's/src="//;s/"//' | sort -u) ; \
			\
			for CSS_PATH in $$CSS_PATHS; do \
				CSS_INFO=$$(curl -s -o /dev/null -w "%{http_code} %{size_download}" --max-time 15 "$$DASHBOARD_URL$$CSS_PATH") ; \
				CSS_STATUS=$$(echo $$CSS_INFO | cut -d' ' -f1) ; \
				CSS_SIZE=$$(echo $$CSS_INFO | cut -d' ' -f2) ; \
				CSS_NAME=$$(basename "$$CSS_PATH") ; \
				if [ "$$CSS_STATUS" = "200" ]; then \
					if [ "$$CSS_SIZE" -lt 1000 ]; then \
						printf "  ❌ CSS %-20s: HTTP %s (Suspiciously small: %s bytes)\n" "$$CSS_NAME" "$$CSS_STATUS" "$$CSS_SIZE"; FAIL=1; \
					else \
						printf "  ✅ CSS %-20s: HTTP %s (%s bytes)\n" "$$CSS_NAME" "$$CSS_STATUS" "$$CSS_SIZE"; \
					fi ; \
				else \
					printf "  ❌ CSS %-20s: HTTP %s\n" "$$CSS_NAME" "$$CSS_STATUS"; FAIL=1; \
				fi ; \
			done ; \
			\
			for JS_PATH in $$JS_PATHS; do \
				JS_INFO=$$(curl -s -o /dev/null -w "%{http_code} %{size_download}" --max-time 15 "$$DASHBOARD_URL$$JS_PATH") ; \
				JS_STATUS=$$(echo $$JS_INFO | cut -d' ' -f1) ; \
				JS_SIZE=$$(echo $$JS_INFO | cut -d' ' -f2) ; \
				JS_NAME=$$(basename "$$JS_PATH") ; \
				if [ "$$JS_STATUS" = "200" ]; then \
					printf "  ✅ JS  %-20s: HTTP %s (%s bytes)\n" "$$JS_NAME" "$$JS_STATUS" "$$JS_SIZE"; \
				else \
					printf "  ❌ JS  %-20s: HTTP %s\n" "$$JS_NAME" "$$JS_STATUS"; FAIL=1; \
				fi ; \
			done ; \
		fi ; \
	else \
		printf "  ⚠️  Dashboard HTML:     no dashboardUrl in outputs\n" ; \
	fi ; \
	\
	echo "" ; \
	if [ "$$FAIL" -ne 0 ]; then $(call log_error,Verification FAILED); exit 1; fi ; \
	$(call log_success,All checks passed)


test: ## Run unit tests with vitest (via Turbo)
	@$(call log_step,Running unit tests via Turbo...)
	@$(PNPM) run test

test-silent: ## Run unit tests in silent mode (via Turbo)
	@$(call log_step,Running unit tests (silent) via Turbo...)
	@$(PNPM) run test:silent

test-watch: ## Run unit tests in watch mode (Direct)
	@$(PNPM) exec vitest

test-ui: ## Run unit tests with Vitest UI (Direct)
	@$(PNPM) exec vitest --ui

test-coverage: ## Run unit tests with coverage reporting (via Turbo)
	@$(call log_info,Running tests with coverage via Turbo...)
	@$(PNPM) exec turbo run test-coverage

test-coverage-ci: ## Run unit tests with coverage enforcement for CI (via Turbo)
	@$(call log_info,Running tests with CI coverage via Turbo...)
	@$(PNPM) exec turbo run test-coverage -- --reporter=verbose

test-component: ## Run component tests (via Turbo)
	@$(call log_step,Running component tests via Turbo...)
	@$(PNPM) exec turbo run test -- --reporter=verbose '**/*.test.tsx'

test-e2e: ## Run E2E tests with Playwright (local dev server)
	@$(call log_step,Running E2E tests...)
	@$(PNPM) exec playwright test $(if $(PW_SHARD),--shard=$(PW_SHARD),)

test-e2e-deployed: ## Run E2E tests against deployed URL. Usage: make test-e2e-deployed URL=https://...
	@$(call log_step,Running E2E tests against deployed URL...)
	@if [ -z "$(URL)" ]; then $(call log_error,URL is required); exit 1; fi
	@BASE_URL=$(URL) $(PNPM) exec playwright test

test-affected: ## Run only tests in affected packages (via Turbo)
	@$(call log_step,Running affected tests via Turbo...)
	@$(PNPM) exec turbo run test --filter=[...origin/main]

security-scan: ## Scan dependencies for security vulnerabilities
	@$(call log_step,Running security scan...)
	@$(PNPM) exec tsx scripts/quality/security-scan.ts $(if $(SEVERITY),--severity $(SEVERITY),) $(if $(FIX),--fix,)

docs-check: ## Validate documentation is in sync with code changes
	@$(call log_step,Checking documentation...)
	@$(PNPM) exec tsx scripts/quality/docs-check.ts $(if $(BASE),--base $(BASE),) $(if $(STRICT),--strict,)

test-coverage-trend: ## Track coverage trends and detect regressions. Usage: make test-coverage-trend [THRESHOLD=5] [UPDATE_BASELINE=true]
	@$(call log_step,Running coverage trend analysis...)
	@$(PNPM) exec tsx scripts/quality/coverage-trend.ts \
		$(if $(THRESHOLD),--threshold $(THRESHOLD),) \
		$(if $(UPDATE_BASELINE),--update-baseline,)
