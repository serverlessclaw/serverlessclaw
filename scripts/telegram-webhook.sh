#!/bin/bash
# -----------------------------------------------------------------------------
# Telegram Webhook Management Utility
# -----------------------------------------------------------------------------
set -e

# Load environment variables if .env exists
if [ -f .env ]; then
  # Filter out lines that are not valid bash assignments (e.g. comments or empty lines)
  # Also handle SST_SECRET_ prefix
  export $(grep -v '^#' .env | grep -v '^$' | xargs)
fi

TOKEN="${SST_SECRET_TelegramBotToken}"

if [ -z "$TOKEN" ]; then
  echo "Error: SST_SECRET_TelegramBotToken is not set."
  exit 1
fi

ACTION=$1
URL=$2

case $ACTION in
  "set")
    if [ -z "$URL" ]; then
      echo "Usage: $0 set <webhook-url>"
      exit 1
    fi
    echo "Registering webhook: $URL"
    curl -s -X POST "https://api.telegram.org/bot$TOKEN/setWebhook" \
         -H "Content-Type: application/json" \
         -d "{\"url\": \"$URL\"}" | jq .
    ;;
  "get")
    echo "Getting webhook info..."
    curl -s "https://api.telegram.org/bot$TOKEN/getWebhookInfo" | jq .
    ;;
  "delete")
    echo "Deleting webhook..."
    curl -s "https://api.telegram.org/bot$TOKEN/deleteWebhook" | jq .
    ;;
  *)
    echo "Usage: $0 {set|get|delete} [url]"
    exit 1
    ;;
esac
