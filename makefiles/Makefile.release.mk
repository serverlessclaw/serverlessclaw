###############################################################################
# Makefile.release: Release and Tagging targets
###############################################################################
include makefiles/Makefile.shared.mk

.PHONY: release tag

release: ## Full production release: test -> deploy -> verify -> tag
	@$(call log_step,Starting full production release...)
	@$(MAKE) check test
	@$(MAKE) deploy-prod
	@$(MAKE) verify URL=$(call get_prod_url)
	@$(MAKE) tag
	@$(call log_success,Release completed successfully!)

tag: ## Create and push a git tag for the current release
	@$(call log_info,Creating release tag...)
	@TAG="v$$(date +%Y%m%d-%H%M%S)"; \
	git tag -a $$TAG -m "Release $$TAG"; \
	git push origin $$TAG; \
	$(call log_success,Tagged and pushed: $$TAG)

# Helper to get the production URL (placeholder - adjust as needed)
define get_prod_url
	$$(sst shell --stage prod "echo \$$API_URL")
endef
