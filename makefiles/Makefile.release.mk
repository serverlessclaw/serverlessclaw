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
	@$(MAKE) gate-tier-1
	@$(call log_info,Tier 1 passed. Running Tier 2 (Coverage/AIReady) and Deployment in parallel...)
	@($(MAKE) gate-tier-2 > release-tier2.log 2>&1) & \
	TIER2_PID=$$!; \
	$(MAKE) deploy ENV=$(ENV) E2E=false; \
	DEPLOY_EXIT=$$?; \
	wait $$TIER2_PID; \
	TIER2_EXIT=$$?; \
	if [ $$TIER2_EXIT -ne 0 ]; then \
		$(call log_error,Tier 2 checks failed. Check release-tier2.log); \
		exit 1; \
	fi; \
	if [ $$DEPLOY_EXIT -ne 0 ]; then \
		$(call log_error,Deployment failed.); \
		exit 1; \
	fi
	@$(MAKE) test-tier-3
	@$(MAKE) tag
	@$(call log_success,Release completed successfully!)

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