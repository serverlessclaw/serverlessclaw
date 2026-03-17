###############################################################################
# Makefile.deploy: Deployment and Infrastructure targets
###############################################################################
include makefiles/Makefile.shared.mk

LOCAL_STAGE ?= local

.PHONY: dev deploy deploy-prod diff synth remove remove-local clear-port

dev: ## Start SST in development mode
	@$(call log_step,Starting SST dev mode on stage $(LOCAL_STAGE)...)
	@$(call load_env); $(SST) dev --stage $(LOCAL_STAGE)

deploy: ## Deploy SST to the specified environment (default: dev)
	@$(call log_step,Deploying to environment: $(ENV)...)
	@$(call load_env); $(SST) deploy --stage $(ENV) --yes
	@$(call log_step,Running post-deploy CloudFront fix...)
	@./scripts/fix-cloudfront.sh $(ENV)
	@$(call log_success,SST deploy completed)

deploy-prod: ## Deploy SST to production
	@$(call log_step,Deploying to production...)
	@$(MAKE) deploy ENV=prod

diff: ## Show SST infrastructure changes
	@$(call log_info,SST diff for $(ENV)...)
	@$(SST) diff --stage $(ENV)

synth: ## Synthesize SST resources
	@$(call log_info,SST synth for $(ENV)...)
	@$(SST) synth --stage $(ENV)

remove: ## Remove SST resources for the specified environment
	@$(call log_warning,WARNING: Removing SST resources for stage $(ENV)!)
	@$(SST) remove --stage $(ENV) --yes

remove-local: ## Remove SST resources for the local development stage
	@$(MAKE) remove ENV=$(LOCAL_STAGE)

clear-port: ## Clear common dev port
	$(call kill_port,7777)