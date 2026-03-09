# Hub Makefile
include makefiles/Makefile.shared.mk
include makefiles/Makefile.quality.mk
include makefiles/Makefile.test.mk
include makefiles/Makefile.deploy.mk

.DEFAULT_GOAL := help

help-agent: help ## Show optimized help for AI agents

help: ## Show all targets and descriptions in a markdown table
	@for f in $(wildcard makefiles/Makefile.*.mk); do \
		if ! grep -qE '^[a-zA-Z0-9_-]+:.*## ' "$$f"; then continue; fi; \
		spoke=$$(basename $$f); \
		spoke=$${spoke#Makefile.}; spoke=$${spoke%.mk}; \
		case $$spoke in \
			shared)     color=$$(tput setaf 6);; \
			quality)    color=$$(tput setaf 2);; \
			test)       color=$$(tput setaf 4);; \
			deploy)     color=$$(tput setaf 3);; \
			*)          color=$$(tput setaf 7);; \
		esac; \
		echo ""; \
		echo "$${color}--- $$(echo $$spoke | tr a-z A-Z) ---$$(tput sgr0)"; \
		grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $$f | sort | \
		while IFS= read -r line; do \
			target=$$(echo $$line | cut -d: -f1); \
			desc=$$(echo $$line | sed -n 's/.*## //p'); \
			printf "  \033[1m%-20s\033[0m %s\n" "$$target" "$$desc"; \
		done; \
	done

pre-commit: ## Run pre-commit checks (fix, test, check)
	@$(call log_step,Running pre-commit checks...)
	@$(MAKE) fix
	@$(MAKE) $(MAKE_PARALLEL) test check
	@$(call log_success,Pre-commit checks passed)

pre-push: ## Run pre-push checks (test, deploy)
	@$(call log_step,Running pre-push checks...)
	@$(MAKE) $(MAKE_PARALLEL) check test
	@$(call log_success,Pre-push checks passed)
