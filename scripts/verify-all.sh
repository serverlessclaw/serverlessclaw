#!/bin/bash
###############################################################################
# Verify Both Local and Production Environments
###############################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'

log_step() {
  echo -e "${YELLOW}→ $1${RESET}"
}

log_success() {
  echo -e "${GREEN}✅ $1${RESET}"
}

log_error() {
  echo -e "${RED}❌ $1${RESET}"
}

# ============================================================================
# LOCAL ENVIRONMENT
# ============================================================================

verify_local() {
  log_step "Verifying LOCAL environment..."
  
  local_url="http://localhost:3000"
  
  # Check if server is running on localhost:3000
  if ! curl -s --fail "$local_url" > /dev/null 2>&1; then
    log_error "Local server not running at $local_url. Run 'make dev' first."
    return 1
  fi
  
  log_success "Local server is reachable"
  
  # (a) Health check
  log_step "Checking /api/health..."
  health=$(curl -s "$local_url/api/health" | jq -r '.status // empty')
  if [ "$health" = "ok" ]; then
    log_success "Health check passed"
  else
    log_error "Health check failed"
    return 1
  fi
  
  # (b) Config check
  log_step "Checking /api/config (realtime endpoint)..."
  config=$(curl -s "$local_url/api/config" | jq '.' 2>/dev/null)
  if [ -z "$config" ]; then
    log_error "Config endpoint failed"
    return 1
  fi
  log_success "Config endpoint working: $(echo "$config" | jq -r '.realtime.url // "no realtime"')"
  
  # (c) Dashboard smoke test
  log_step "Checking dashboard loads..."
  dashboard=$(curl -s -I "$local_url" | grep -E "HTTP|Content-Type" | head -2)
  if echo "$dashboard" | grep -q "200"; then
    log_success "Dashboard loads successfully"
  else
    log_error "Dashboard load failed"
    return 1
  fi
}

# ============================================================================
# PRODUCTION ENVIRONMENT
# ============================================================================

verify_production() {
  log_step "Verifying PRODUCTION environment..."
  
  api_url="https://api.superclaw.getaiready.dev"
  dashboard_url="https://superclaw.getaiready.dev"
  
  # (a) API health check
  log_step "Checking API health at $api_url/health..."
  health=$(curl -s --max-time 5 "$api_url/health" | jq -r '.status // empty' 2>/dev/null || echo "")
  if [ "$health" = "ok" ]; then
    log_success "Production API health check passed"
  else
    log_error "Production API health check failed"
    return 1
  fi
  
  # (b) Config endpoint
  log_step "Checking $api_url/config..."
  config=$(curl -s --max-time 5 "$api_url/config" | jq '.' 2>/dev/null)
  if [ -z "$config" ]; then
    log_error "Production config endpoint failed"
    return 1
  fi
  log_success "Production config endpoint working: $(echo "$config" | jq -r '.realtime.url // "no realtime"')"
  
  # (c) Dashboard DNS/CDN check
  log_step "Checking dashboard CDN at $dashboard_url..."
  status=$(curl -s -I -o /dev/null -w "%{http_code}" "$dashboard_url")
  if [ "$status" = "200" ]; then
    log_success "Dashboard CDN responding (HTTP $status)"
  else
    log_error "Dashboard CDN error (HTTP $status)"
    return 1
  fi
  
  # (d) Check CloudFront distribution
  log_step "Checking CloudFront asset delivery..."
  asset_status=$(curl -s -I -o /dev/null -w "%{http_code}" "$dashboard_url/_next/static/chunk.js" 2>/dev/null || echo "000")
  if [ "$asset_status" = "200" ] || [ "$asset_status" = "404" ]; then
    log_success "CloudFront assets responding (HTTP $asset_status)"
  else
    log_error "CloudFront error (HTTP $asset_status)"
    return 1
  fi
}

# ============================================================================
# MAIN
# ============================================================================

main() {
  echo ""
  echo "╔════════════════════════════════════════════════════════════════╗"
  echo "║        Serverless Claw Environment Verification                ║"
  echo "╚════════════════════════════════════════════════════════════════╝"
  echo ""
  
  local_ok=0
  prod_ok=0
  
  # Verify local
  if verify_local; then
    local_ok=1
  fi
  
  echo ""
  sleep 1
  
  # Verify production
  if verify_production; then
    prod_ok=1
  fi
  
  echo ""
  echo "╔════════════════════════════════════════════════════════════════╗"
  echo "║                      VERIFICATION SUMMARY                       ║"
  echo "╚════════════════════════════════════════════════════════════════╝"
  echo ""
  
  if [ $local_ok -eq 1 ]; then
    log_success "LOCAL (http://localhost:3000) is working"
  else
    log_error "LOCAL (http://localhost:3000) has issues"
  fi
  
  if [ $prod_ok -eq 1 ]; then
    log_success "PRODUCTION (https://superclaw.getaiready.dev) is working"
  else
    log_error "PRODUCTION (https://superclaw.getaiready.dev) has issues"
  fi
  
  echo ""
  
  if [ $local_ok -eq 1 ] && [ $prod_ok -eq 1 ]; then
    log_success "All environments verified successfully!"
    return 0
  else
    log_error "Some environments need attention"
    return 1
  fi
}

main "$@"
