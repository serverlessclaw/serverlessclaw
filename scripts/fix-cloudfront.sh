#!/bin/bash

set -e

STAGE="${1:-.}"
if [ "$STAGE" = "." ]; then
    STAGE="."
fi

# Load environment variables
set -a
[ -f .env ] && source .env
set +a

# Verify required environment variables
: "${CLOUDFLARE_ZONE_ID:?'CLOUDFLARE_ZONE_ID is not set'}"
: "${CLOUDFLARE_API_TOKEN:?'CLOUDFLARE_API_TOKEN is not set'}"

echo "[INFO] Fixing CloudFront routing for Next.js application..."

# 1. Find the CloudFront distribution with comment='ClawCenter app'
echo "[DEBUG] Searching for ClawCenter CloudFront distribution..."
DISTRIBUTION_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='ClawCenter app'].Id" \
  --output text)

if [ -z "$DISTRIBUTION_ID" ]; then
    echo "[WARNING] No CloudFront distribution found with comment='ClawCenter app', skipping fix"
    exit 0
fi

echo "[INFO] Found distribution: $DISTRIBUTION_ID"

# 2. Get the distribution config
echo "[DEBUG] Retrieving distribution configuration..."
DIST_CONFIG=$(aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID")
ETAG=$(echo "$DIST_CONFIG" | jq -r .ETag)
CONFIG=$(echo "$DIST_CONFIG" | jq .DistributionConfig)

# 3. Find Lambda Function URL (for server origin)
echo "[DEBUG] Finding Lambda Function URL..."
FUNCTION_URL=$(aws lambda list-functions \
  --query "Functions[?contains(FunctionName, 'ClawCenter') && contains(FunctionName, 'Server')].FunctionArn" \
  --output text | head -1)

if [ -z "$FUNCTION_URL" ]; then
    echo "[WARNING] Could not find Lambda Function URL, skipping origin update"
else
    # Extract domain from Lambda Function URL
    FUNCTION_DOMAIN=$(echo "$FUNCTION_URL" | sed 's/arn:aws:lambda:[^:]*:[^:]*:function://g' | sed 's/:.*/execute-api.ap-southeast-2.amazonaws.com/')
fi

# 4. Find S3 bucket for assets
echo "[DEBUG] Finding S3 bucket for assets..."
S3_BUCKET=$(aws s3api list-buckets \
  --query "Buckets[?contains(Name, 'serverlessclaw') && contains(Name, 'assets')].Name" \
  --output text | head -1)

if [ -z "$S3_BUCKET" ]; then
    echo "[WARNING] Could not find assets S3 bucket"
fi

# 5. Find CloudFront Function ARN
echo "[DEBUG] Finding CloudFront Function..."
CF_FUNCTION_ARN=$(aws cloudfront list-functions \
  --query "FunctionList[?contains(Name, 'Router')].FunctionMetadata.FunctionARN" \
  --output text | head -1)

# 6. Update distribution with cache behaviors for Next.js
echo "[INFO] Adding Next.js-specific cache behaviors..."

# First, add the cache behaviors
CONFIG=$(echo "$CONFIG" | jq \
  --arg cf_func "$CF_FUNCTION_ARN" \
  '.CacheBehaviors.Items += [
    {
      "PathPattern": "/_next/static/*",
      "ViewerProtocolPolicy": "allow-all",
      "AllowedMethods": ["GET", "HEAD"],
      "CachedMethods": ["GET", "HEAD"],
      "Compress": true,
      "ForwardedValues": {
        "QueryString": false,
        "Cookies": {"Forward": "none"},
        "Headers": ["Accept-Encoding"]
      },
      "MinTTL": 31536000,
      "DefaultTTL": 31536000,
      "MaxTTL": 31536000,
      "FunctionAssociations": {
        "Items": [
          {
            "EventType": "viewer-request",
            "FunctionARN": $cf_func
          }
        ],
        "Quantity": 1
      }
    },
    {
      "PathPattern": "/_assets/*",
      "ViewerProtocolPolicy": "allow-all",
      "AllowedMethods": ["GET", "HEAD"],
      "CachedMethods": ["GET", "HEAD"],
      "Compress": true,
      "ForwardedValues": {
        "QueryString": false,
        "Cookies": {"Forward": "none"}
      },
      "MinTTL": 31536000,
      "DefaultTTL": 31536000,
      "MaxTTL": 31536000
    },
    {
      "PathPattern": "*.png",
      "ViewerProtocolPolicy": "allow-all",
      "AllowedMethods": ["GET", "HEAD"],
      "CachedMethods": ["GET", "HEAD"],
      "Compress": true,
      "ForwardedValues": {
        "QueryString": false,
        "Cookies": {"Forward": "none"}
      },
      "MinTTL": 604800,
      "DefaultTTL": 604800,
      "MaxTTL": 604800
    }
  ]')

# Then, update the Quantity to match the Items array length
CONFIG=$(echo "$CONFIG" | jq '.CacheBehaviors.Quantity = (.CacheBehaviors.Items | length)')

# 7. Update the distribution configuration in AWS
echo "[INFO] Updating CloudFront distribution..."
aws cloudfront update-distribution \
  --id "$DISTRIBUTION_ID" \
  --distribution-config "$CONFIG" \
  --if-match "$ETAG" > /dev/null

echo "[SUCCESS] CloudFront distribution updated with Next.js routing configuration"
