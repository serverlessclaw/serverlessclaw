# Hub Makefile
include makefiles/Makefile.shared.mk
include makefiles/Makefile.quality.mk
include makefiles/Makefile.test.mk
include makefiles/Makefile.deploy.mk
include makefiles/Makefile.release.mk

.DEFAULT_GOAL := help

pre-commit: ## Run pre-commit checks in parallel (lint-staged, type-check, docs-check, test-silent)
	@$(call log_step,Running pre-commit checks in parallel...)
	@$(call run_parallel_gate,lint~$(MAKE) lint-staged||typecheck~$(MAKE) type-check||docs~$(MAKE) docs-check||test~$(MAKE) test-silent)

pre-push: ## Run fast quality gate in parallel (rebase check + fast gate + security + aiready)
	@$(call log_step,Running pre-push checks in parallel...)
	@$(call run_parallel_gate,rebase~$(MAKE) verify-up-to-date||gate~$(MAKE) gate-fast||security~$(MAKE) security-scan||aiready~$(MAKE) aiready)

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
			release)    color=$$(tput setaf 5);; \
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
