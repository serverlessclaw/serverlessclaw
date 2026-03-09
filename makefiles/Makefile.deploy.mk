###############################################################################
# Makefile.deploy: Deployment and Infrastructure targets
###############################################################################
include makefiles/Makefile.shared.mk

.PHONY: dev deploy deploy-prod diff synth remove

dev: ## Start SST in development mode
	@$(call log_step,Starting SST dev mode...)
	@$(PNPM) sst dev

deploy: ## Deploy SST to the specified environment (default: dev)
	@$(call log_step,Deploying to environment: $(ENV)...)
	@$(PNPM) sst deploy --stage $(ENV)

deploy-prod: ## Deploy SST to production
	@$(call log_step,Deploying to production...)
	@$(MAKE) deploy ENV=prod

diff: ## Show SST infrastructure changes
	@$(call log_info,SST diff for $(ENV)...)
	@$(PNPM) sst diff --stage $(ENV)

synth: ## Synthesize SST resources
	@$(call log_info,SST synth for $(ENV)...)
	@$(PNPM) sst synth --stage $(ENV)

remove: ## Remove SST resources for the specified environment
	@$(call log_warning,WARNING: Removing SST resources for stage $(ENV)!)
	@$(PNPM) sst remove --stage $(ENV)
