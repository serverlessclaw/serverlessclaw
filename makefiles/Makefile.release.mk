###############################################################################
# Makefile.release: Release and Tagging targets
###############################################################################
include makefiles/Makefile.shared.mk

.PHONY: release dev-release tag

release: ## Full production release: test -> deploy -> verify -> tag
	@$(call log_step,Starting full production release...)
	@$(call verify_clean)
	@$(MAKE) check test
	@$(MAKE) deploy-prod
	@$(MAKE) verify URL=$$(cat .sst/outputs.json | python3 -c "import json,sys; print(json.load(sys.stdin)['apiUrl'])")
	@$(MAKE) tag
	@$(call log_success,Release completed successfully!)

release-dev: dev-release ## Alias for dev-release

dev-release: ## Full development release: test -> deploy -> verify
	@$(call log_step,Starting full development release...)
	@$(call verify_clean)
	@$(MAKE) check test
	@$(MAKE) deploy ENV=dev
	@$(MAKE) verify URL=$$(cat .sst/outputs.json | python3 -c "import json,sys; print(json.load(sys.stdin)['apiUrl'])")
	@$(call log_success,Development release completed successfully!)

tag: ## Create and push a git tag for the current release
	@$(call log_info,Bumping version and creating release tag...)
	@npm version patch -m "chore: release version %s [skip ci]"
	@git push origin main --follow-tags
	@$(call log_success,Version bumped, tagged and pushed!)

# Helper to get the production URL
define get_prod_url
	$$($(SST) shell --stage prod "echo \$$API_URL")
endef

# Helper to get the development URL
define get_dev_url
	$$($(SST) shell --stage dev "echo \$$API_URL")
endef
