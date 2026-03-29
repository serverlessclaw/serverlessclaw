###############################################################################
# Makefile.deploy: Deployment and Infrastructure targets
###############################################################################
include makefiles/Makefile.shared.mk

LOCAL_STAGE ?= local

.PHONY: dev deploy diff synth remove remove-local clear-port

dev: ## Start SST in development mode (mono mode)
	@$(call log_step,Starting SST dev mode on stage $(LOCAL_STAGE) in mono mode...)
	@$(call load_env); $(SST) dev --stage $(LOCAL_STAGE) 

dev-mono: ## Start SST in development mode (mono mode)
	@$(call log_step,Starting SST dev mode on stage $(LOCAL_STAGE) in mono mode...)
	@$(call load_env); $(SST) dev --stage $(LOCAL_STAGE) --mode=mono

deploy: ## Deploy SST to the environment (default: prod)
	@$(call log_step,Deploying to environment: $(ENV)...)
	@$(call load_env); \
	./scripts/check-aws-account.sh $(ENV) $$EXPECTED_ACCOUNT && \
	$(SST) deploy --stage $(ENV) --yes
	@$(call log_success,SST deploy completed)

diff: ## Show SST infrastructure changes
	@$(call log_info,SST diff for $(ENV)...)
	@$(call load_env); $(SST) diff --stage $(ENV)

synth: ## Synthesize SST resources
	@$(call log_info,SST synth for $(ENV)...)
	@$(call load_env); $(SST) synth --stage $(ENV)

remove: ## Remove SST resources for the specified environment
	@$(call log_warning,WARNING: Removing SST resources for stage $(ENV)!)
	@$(call load_env); $(SST) remove --stage $(ENV) --yes

remove-local: ## Remove SST resources for the local development stage
	@$(MAKE) remove ENV=$(LOCAL_STAGE)

clear-port: ## Clear common dev port
	$(call kill_port,7777)
