###############################################################################
# Makefile.shared: Common macros, variables, and environment configuration
###############################################################################

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
