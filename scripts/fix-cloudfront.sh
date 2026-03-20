#!/bin/bash
set -e

STAGE=${1:-dev}
PROFILE=${AWS_PROFILE}
APP_NAME=${APP_NAME:-serverlessclaw}

export AWS_PROFILE="$PROFILE"

echo "Starting Robust CloudFront Fix for stage: $STAGE (Account: $PROFILE)"

# 1. Identify CloudFront Distribution ID for ClawCenter
DIST_ID=$(aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='ClawCenter app'].Id" --output text | awk '{print $1}')

if [ -z "$DIST_ID" ] || [ "$DIST_ID" == "None" ]; then
    echo "Error: Could not find CloudFront distribution for ClawCenter"
    exit 1
fi
echo "Found Distribution ID: $DIST_ID"

# 2. Identify Lambda Function URL for ClawCenter Server
SERVER_URL=$(aws lambda list-functions --query "Functions[?contains(FunctionName, '$APP_NAME-$STAGE-ClawCenterServer')].FunctionName" --output text | head -n 1 | xargs -I {} aws lambda get-function-url-config --function-name {} --query "FunctionUrl" --output text)

if [ -z "$SERVER_URL" ] || [ "$SERVER_URL" == "None" ]; then
    echo "Error: Could not find Lambda Function URL for ClawCenter Server"
    exit 1
fi
SERVER_HOST=$(echo "$SERVER_URL" | sed 's/https:\/\///' | sed 's/\///')
echo "Found Server Host: $SERVER_HOST"

# 3. Identify stage-specific S3 Assets Bucket
S3_BUCKET=$(aws s3api list-buckets --query "Buckets[?contains(Name, '${APP_NAME}-${STAGE}-clawcenterassetsbucket-')].Name" --output text | awk '{print $1}')
if [ -z "$S3_BUCKET" ]; then
    echo "Error: Could not find S3 Assets Bucket"
    exit 1
fi
S3_DOMAIN="$S3_BUCKET.s3.ap-southeast-2.amazonaws.com"
echo "Found S3 Domain: $S3_DOMAIN"

# 4. Identify CloudFront Function ARN
CF_FUNC_ARN=$(aws cloudfront list-functions --query "FunctionList.Items[?contains(Name, 'ClawCenterRouter')].FunctionMetadata.FunctionARN" --output text | awk '{print $1}' | head -n 1)
if [ -z "$CF_FUNC_ARN" ] || [ "$CF_FUNC_ARN" == "None" ]; then
    CF_FUNC_ARN=$(aws cloudfront get-distribution-config --id "$DIST_ID" --query "DistributionConfig.DefaultCacheBehavior.FunctionAssociations.Items[?EventType=='viewer-request'].FunctionARN" --output text | awk '{print $1}')
fi
echo "Found CloudFront Function ARN: $CF_FUNC_ARN"

# 6. Patch CloudFront Distribution
echo "Patching CloudFront Distribution with Explicit Asset Routing..."

ETAG=$(aws cloudfront get-distribution-config --id "$DIST_ID" --query "ETag" --output text)
aws cloudfront get-distribution-config --id "$DIST_ID" --query "DistributionConfig" > dist-config.json

CACHE_POLICY_ID=$(jq -r '.DefaultCacheBehavior.CachePolicyId' dist-config.json)
OAC_ID=$(jq -r '.Origins.Items[] | select(.Id == "s3-assets") | .OriginAccessControlId' dist-config.json)

if [ -z "$OAC_ID" ] || [ "$OAC_ID" == "null" ]; then
  # Fallback for older stacks where s3-assets origin does not exist yet.
  OAC_ID="EKO5N1P5RDMN6"
fi

if [ -z "$CACHE_POLICY_ID" ] || [ "$CACHE_POLICY_ID" == "null" ]; then
  echo "Error: Could not read DefaultCacheBehavior.CachePolicyId"
  exit 1
fi

jq "
  .Origins.Items |= map(
    if .Id == \"default\" then
      .DomainName = \"$SERVER_HOST\" |
      .CustomOriginConfig.OriginProtocolPolicy = \"https-only\"
    else
      .
    end
  ) |
  
  # Ensure S3 origin exists with OriginPath /_assets
  if (.Origins.Items | any(.Id == \"s3-assets\")) then
    (.Origins.Items[] | select(.Id == \"s3-assets\")) |= (
      .DomainName = \"$S3_DOMAIN\" | 
      .OriginAccessControlId = \"$OAC_ID\" | 
      .OriginPath = \"/_assets\"
    )
  else
    .Origins.Items += [{
      \"Id\": \"s3-assets\",
      \"DomainName\": \"$S3_DOMAIN\",
      \"OriginPath\": \"/_assets\",
      \"OriginAccessControlId\": \"$OAC_ID\",
      \"S3OriginConfig\": { \"OriginAccessIdentity\": \"\" },
      \"CustomHeaders\": { \"Quantity\": 0 },
      \"ConnectionAttempts\": 3,
      \"ConnectionTimeout\": 10,
      \"OriginShield\": { \"Enabled\": false }
    }] |
    .Origins.Quantity = (.Origins.Items | length)
  end |
  
  # Create Explicit Behaviors for Assets
  .CacheBehaviors = {
    \"Quantity\": 3,
    \"Items\": [
      {
        \"PathPattern\": \"/_next/static/*\",
        \"TargetOriginId\": \"s3-assets\",
        \"ViewerProtocolPolicy\": \"redirect-to-https\",
        \"AllowedMethods\": { \"Quantity\": 2, \"Items\": [\"GET\", \"HEAD\"], \"CachedMethods\": { \"Quantity\": 2, \"Items\": [\"GET\", \"HEAD\"] } },
        \"Compress\": true,
        \"CachePolicyId\": \"$CACHE_POLICY_ID\",
        \"SmoothStreaming\": false,
        \"FieldLevelEncryptionId\": \"\",
        \"LambdaFunctionAssociations\": { \"Quantity\": 0 },
        \"FunctionAssociations\": { \"Quantity\": 0 }
      },
      {
        \"PathPattern\": \"/_assets/*\",
        \"TargetOriginId\": \"s3-assets\",
        \"ViewerProtocolPolicy\": \"redirect-to-https\",
        \"AllowedMethods\": { \"Quantity\": 2, \"Items\": [\"GET\", \"HEAD\"], \"CachedMethods\": { \"Quantity\": 2, \"Items\": [\"GET\", \"HEAD\"] } },
        \"Compress\": true,
        \"CachePolicyId\": \"$CACHE_POLICY_ID\",
        \"SmoothStreaming\": false,
        \"FieldLevelEncryptionId\": \"\",
        \"LambdaFunctionAssociations\": { \"Quantity\": 0 },
        \"FunctionAssociations\": { \"Quantity\": 0 }
      },
      {
        \"PathPattern\": \"/*.png\",
        \"TargetOriginId\": \"s3-assets\",
        \"ViewerProtocolPolicy\": \"redirect-to-https\",
        \"AllowedMethods\": { \"Quantity\": 2, \"Items\": [\"GET\", \"HEAD\"], \"CachedMethods\": { \"Quantity\": 2, \"Items\": [\"GET\", \"HEAD\"] } },
        \"Compress\": true,
        \"CachePolicyId\": \"$CACHE_POLICY_ID\",
        \"SmoothStreaming\": false,
        \"FieldLevelEncryptionId\": \"\",
        \"LambdaFunctionAssociations\": { \"Quantity\": 0 },
        \"FunctionAssociations\": { \"Quantity\": 0 }
      }
    ]
  } |
  
  .DefaultCacheBehavior.FunctionAssociations.Quantity = 1 |
  .DefaultCacheBehavior.FunctionAssociations.Items = [{
    \"FunctionARN\": \"$CF_FUNC_ARN\",
    \"EventType\": \"viewer-request\"
  }]
" dist-config.json > updated-dist-config.json

aws cloudfront update-distribution --id "$DIST_ID" --distribution-config file://updated-dist-config.json --if-match "$ETAG" > /dev/null

echo "Distribution Patched Successfully"
rm dist-config.json updated-dist-config.json 2>/dev/null || true
echo "Post-Deploy CloudFront Fix Completed Successfully"
