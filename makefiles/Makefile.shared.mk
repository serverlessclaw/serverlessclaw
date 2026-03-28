###############################################################################
# Makefile.shared: Common macros, variables, and environment configuration
###############################################################################

ifndef _SHARED_MK_INCLUDED
_SHARED_MK_INCLUDED := 1

# Explicitly use bash for all shell commands to ensure macro robustness
SHELL := /bin/bash

# Colors
RED        := $(shell printf '\033[0;31m')
GREEN      := $(shell printf '\033[0;32m')
YELLOW     := $(shell printf '\033[0;33m')
BLUE       := $(shell printf '\033[0;34m')
LIGHTBLUE  := $(shell printf '\033[1;34m')
CYAN       := $(shell printf '\033[0;36m')
MAGENTA    := $(shell printf '\033[0;35m')
RESET      := $(shell printf '\033[0m')
BOLD       := $(shell printf '\033[1m')

# Dynamically resolve package manager
PNPM := $(shell command -v pnpm 2>/dev/null || echo npm)

# Use the workspace-local SST binary for deterministic behavior.
# Prerequisite: run `pnpm install` so this binary exists.
SST := ./node_modules/.bin/sst

# Logging macros
define log_info
	printf '$(CYAN)[INFO] %s$(RESET)\n' "$(1)"
endef

define log_success
	printf '$(GREEN)[SUCCESS] %s$(RESET)\n' "$(1)"
endef

define log_warning
	printf '$(YELLOW)[WARNING] %s$(RESET)\n' "$(1)"
endef

define log_error
	printf '$(RED)[ERROR] %s$(RESET)\n' "$(1)"
endef

define log_step
	printf '$(LIGHTBLUE)[STEP] %s$(RESET)\n' "$(1)"
endef

define separator
	printf '%s$(BOLD)================================================================================$(RESET)\n' "$(1)"
endef

# Environment handling
ENV ?= dev
AWS_REGION ?= ap-southeast-2

# Parallelism
PARALLELISM ?= $(shell sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
ifneq ($(filter -j% -j,$(MAKEFLAGS)),)
	MAKE_PARALLEL :=
else
	MAKE_PARALLEL := -j$(PARALLELISM)
endif

# Environment file resolution
# Priority: .env.$(ENV).local > .env.$(ENV) > .env.local > .env
ENV_FILES := .env.$(ENV).local .env.$(ENV) .env.local .env

# Usage: $(call load_env)
# Loads available env files and exports variables. Fails if AWS_PROFILE is not set.
define load_env
	for f in $(ENV_FILES); do \
		if [ -f "$$f" ]; then \
			$(call log_info,Loading env file: $$f); \
			set -a; . ./$$f; set +a; \
		fi; \
	done; \
	if [ -z "$$AWS_PROFILE" ]; then \
		$(call log_error,AWS_PROFILE is not set. Please ensure it is defined in your .env file.); \
		exit 1; \
	fi; \
	if { [ "$(ENV)" = "dev" ] || [ "$(ENV)" = "production" ]; } && [ -z "$$EXPECTED_ACCOUNT" ]; then \
		$(call log_error,EXPECTED_ACCOUNT is not set for stage $(ENV). Please ensure it is defined in your .env file.); \
		exit 1; \
	fi
endef

.PHONY: show-env verify-up-to-date

verify-up-to-date: ## Verify local branch is up to date with remote
	@$(call verify_up_to_date)

show-env: ## Show current environment variables (filtered)
	@$(call load_env); \
	$(call log_info,Current Environment Settings (Loaded from files):); \
	env | grep -E "^(SST_|AWS_|TELEGRAM_|OPENAI_|GITHUB_|EXPECTED_ACCOUNT)" | sort || true

# Common track_time macro
define track_time
	start=$$(date +%s); \
	eval $(1); \
	status=$$?; \
	end=$$(date +%s); \
	elapsed=$$((end - start)); \
	if [ $$status -eq 0 ]; then \
		printf '$(GREEN)✅ %s completed in %ss$(RESET)\n' "$(2)" "$$elapsed"; \
	else \
		printf '$(RED)❌ %s failed after %ss$(RESET)\n' "$(2)" "$$elapsed"; \
	fi; \
	exit $$status
endef

.PHONY: telegram-setup telegram-info telegram-delete

telegram-setup: ## Set Telegram webhook to current API_URL (default: DEV_API_URL)
	@$(call log_step,Setting Telegram webhook...)
	@chmod +x ./scripts/telegram-webhook.sh
	@if [ "$(ENV)" = "prod" ]; then \
		URL=$$(grep "PROD_API_URL" .env | cut -d '=' -f2)/webhook; \
	else \
		URL=$$(grep "DEV_API_URL" .env | cut -d '=' -f2)/webhook; \
	fi; \
	./scripts/telegram-webhook.sh set "$$URL"

telegram-info: ## Get current Telegram webhook status
	@$(call log_info,Fetching Telegram webhook status...)
	@chmod +x ./scripts/telegram-webhook.sh
	@./scripts/telegram-webhook.sh get

telegram-delete: ## Delete current Telegram webhook
	@$(call log_warning,Deleting Telegram webhook!)
	@chmod +x ./scripts/telegram-webhook.sh
	@./scripts/telegram-webhook.sh delete

# Usage: $(call verify_clean)
# Fails if there are uncommitted or untracked changes
define verify_clean
	if [ -n "$$(git status --porcelain)" ]; then \
		$(call log_error,Git working directory is not clean. Commit or stash changes before proceeding.); \
		git status; \
		exit 1; \
	fi; \
	$(call log_success,Working directory is clean.)
endef

# kill_port
# usage: $(call kill_port_without_prompt,8888)
define kill_port
	@lsof -ti :$(1) >/dev/null 2>&1 && lsof -ti :$(1) | xargs kill || true
	@$(call log_success,Port $(1) is now free)
endef

# Usage: $(call run_parallel_gate,NAME~CMD||NAME~CMD||...)
# Runs all checks in background, prints consolidated summary, exits non-zero if any failed.
# Entries separated by ||, each entry is NAME~COMMAND where ~ separates display name from command.
# Example: $(call run_parallel_gate,lint~make lint||format~make format-check)
define run_parallel_gate
       @gate_tmp=$$(mktemp -d); \
       trap 'rm -rf "$$gate_tmp"' EXIT; \
       IFS=$$'\n' gate_checks=($$(echo "$(1)" | sed 's/||/\n/g')); \
       for entry in "$${gate_checks[@]}"; do \
               [ -z "$$entry" ] && continue; \
               name=$$(echo "$$entry" | cut -d'~' -f1); \
               cmd=$$(echo "$$entry" | cut -d'~' -f2-); \
               ( \
                       eval $$cmd > "$$gate_tmp/$$name.out" 2>&1; \
                       echo $$? > "$$gate_tmp/$$name.exit" \
               ) & \
       done; \
       wait; \
       gate_failed=0; gate_total=0; \
       printf '\n%s\n' "========================================="; \
       printf '  %s\n' "QUALITY GATE SUMMARY"; \
       printf '%s\n\n' "========================================="; \
       for entry in "$${gate_checks[@]}"; do \
               [ -z "$$entry" ] && continue; \
               name=$$(echo "$$entry" | cut -d'~' -f1); \
               gate_total=$$((gate_total + 1)); \
               code=$$(cat "$$gate_tmp/$$name.exit" 2>/dev/null || echo "1"); \
               if [ "$$code" = "0" ]; then \
                       printf '  \033[0;32m✅ %-20s PASSED\033[0m\n' "$$name"; \
               else \
                       printf '  \033[0;31m❌ %-20s FAILED (exit %s)\033[0m\n' "$$name" "$$code"; \
                       gate_failed=$$((gate_failed + 1)); \
                       printf '    --- output (last 20 lines) ---\n'; \
                       [ -f "$$gate_tmp/$$name.out" ] && sed 's/^/    /' "$$gate_tmp/$$name.out" | tail -20 || echo "    (no output found)"; \
                       printf '    ------------------------------\n'; \
               fi; \
       done; \
       printf '\n  Result: %d/%d passed\n' "$$((gate_total - gate_failed))" "$$gate_total"; \
       if [ "$$gate_failed" -gt 0 ]; then \
               printf '  \033[0;31m❌ GATE FAILED\033[0m\n\n'; \
               exit 1; \
       else \
               printf '  \033[0;32m✅ GATE PASSED\033[0m\n\n'; \
               exit 0; \
       fi
endef

# Usage: $(call verify_up_to_date)
# Fetches remote and verifies local branch is not behind or diverged. Use before push in trunk-based dev.
define verify_up_to_date
       current=$$(git rev-parse --abbrev-ref HEAD); \
       if [ "$$current" = "HEAD" ]; then \
               $(call log_error,Detached HEAD detected. Push to a branch instead.); \
               exit 1; \
       fi; \
       git fetch origin "$$current" --quiet 2>/dev/null || true; \
       local_rev=$$(git rev-parse HEAD); \
       remote_rev=$$(git rev-parse "origin/$$current" 2>/dev/null || echo ""); \
       if [ -n "$$remote_rev" ]; then \
               merge_base=$$(git merge-base HEAD "origin/$$current" 2>/dev/null || echo ""); \
               if [ "$$merge_base" != "$$remote_rev" ]; then \
                       if [ "$$merge_base" = "$$local_rev" ]; then \
                               $(call log_error,Local branch is behind origin/$$current. Run: git pull --rebase); \
                       else \
                               $(call log_error,Local branch has diverged from origin/$$current. Rebase first.); \
                       fi; \
                       exit 1; \
               fi; \
       fi; \
       $(call log_success,Branch is up to date with remote)
endef
endif
