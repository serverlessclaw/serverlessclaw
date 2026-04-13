###############################################################################
# Makefile.deploy: Deployment and Infrastructure targets
###############################################################################
include makefiles/Makefile.shared.mk

LOCAL_STAGE ?= local

.PHONY: dev deploy diff synth remove remove-local clear-port

dev: ENV := local
dev: clear-port ## Start SST in development mode (mono mode)
	@$(call log_step,Starting SST dev mode on stage $(LOCAL_STAGE) in mono mode...)
	@$(call load_env); \
	TERM=xterm $(SST) dev --stage $(LOCAL_STAGE) 

dev-mono: ENV := local
dev-mono: clear-port ## Start SST in development mode (mono mode)
	@$(call log_step,Starting SST dev mode on stage $(LOCAL_STAGE) in mono mode...)
	@$(call load_env); \
	TERM=xterm $(SST) dev --stage $(LOCAL_STAGE) --mode=mono

dashboard-dev: ENV := local
dashboard-dev: ## Start only the dashboard in development mode
	@$(call log_step,Starting Dashboard dev mode...)
	@$(call load_env); \
	cd dashboard && $(PNPM) next dev --port 7777

deploy: ## Deploy SST to the environment (default: prod)
	@$(call log_step,Preparing deployment for environment: $(ENV)...)
	@if [ ! -f "$(SST)" ]; then $(call log_error,SST binary not found. Run pnpm install first.); exit 1; fi
	@$(call load_env); \
	chmod +x ./scripts/ci/check-aws-account.sh; \
	./scripts/ci/check-aws-account.sh "$(ENV)" "$$EXPECTED_ACCOUNT" && \
	$(call log_info,Starting SST deployment...) && \
	$(SST) deploy --stage $(ENV) --yes && \
	$(call log_info,Running post-deploy CloudFront fix...) && \
	$(PNPM) exec tsx scripts/quality/fix-cloudfront-deploy.ts $(ENV) && \
	$(MAKE) verify-deploy ; \
	if [ "$(E2E)" = "true" ]; then $(MAKE) test-tier-3 ; fi
	@$(call log_success,SST deploy to $(ENV) completed successfully)

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
	@$(call kill_port,7777)
