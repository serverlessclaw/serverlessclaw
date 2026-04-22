###############################################################################
# Makefile.release: Release and Tagging targets
###############################################################################
include makefiles/Makefile.shared.mk

.PHONY: release tag

release: ## Full Release: Quality Gates -> Deploy -> Audit Tag (Auditing & Costs tracking)
	@$(call log_step,Starting audited release for environment: $(ENV)...)
	@if [ "$(ENV)" != "prod" ]; then \
		$(call log_warning,WARNING: Running release on non-prod environment: $(ENV)); \
	fi
	@$(call verify_clean)
	@$(MAKE) pre-release-check
	@$(MAKE) gate-tier-1
	@$(call log_info,Tier 1 passed. Running Tier 2 (Coverage/AIReady) sequentially for safety...)
	@$(MAKE) gate-tier-2
	@$(call log_info,Tier 2 passed. Starting deployment...)
	@$(MAKE) deploy ENV=$(ENV) E2E=false
	@$(MAKE) test-tier-3
	@$(MAKE) tag
	@$(call log_success,Release completed successfully!)

pre-release-check: ## Validate environment and credentials before release
	@$(call log_step,Running pre-release environment check for $(ENV)...)
	@$(call load_env); \
	$(call verify_env,EXPECTED_ACCOUNT); \
	$(call log_info,Verifying AWS identity...); \
	ACTUAL_ACCOUNT=$$(aws sts get-caller-identity --query Account --output text 2>/dev/null); \
	if [ "$$ACTUAL_ACCOUNT" != "$$EXPECTED_ACCOUNT" ]; then \
		$(call log_error,AWS Account mismatch! Expected $$EXPECTED_ACCOUNT but found $$ACTUAL_ACCOUNT); \
		exit 1; \
	fi; \
	$(call log_success,Environment validated for release to $$EXPECTED_ACCOUNT)

tag: ## Create and push a git tag for the current release (for auditing)
	@$(call log_info,Bumping version and creating release tag for auditing...)
	@if [ -n "$$CODEBUILD_BUILD_ID" ] && [ -z "$$GITHUB_TOKEN" ]; then \
		$(call log_error,GITHUB_TOKEN is missing in CI. Cannot push release tag.); \
		exit 1; \
	fi
	@npm version patch -m "chore: release version %s [skip ci]"
	@if [ -n "$$CODEBUILD_BUILD_ID" ]; then \
		REPO="$${HUB_URL:-$${GITHUB_REPO:-serverlessclaw/serverlessclaw}}"; \
		git push https://$$GITHUB_TOKEN@github.com/$$REPO.git HEAD:main --follow-tags; \
	else \
		git push origin main --follow-tags; \
	fi
	@$(call log_success,Version bumped, tagged and pushed for auditing!)


# Helper to get the deployment URL
define get_url
	$$($(SST) shell --stage $(ENV) "echo \$$API_URL")
endef