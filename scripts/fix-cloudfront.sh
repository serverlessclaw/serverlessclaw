#!/bin/bash
set -e

STAGE=${1:-dev}
PROFILE=${AWS_PROFILE:-aiready}

echo "Starting Comprehensive Post-Deploy CloudFront Fix for stage: $STAGE (Account: $PROFILE)"

# 1. Identify CloudFront Distribution ID for ClawCenter
DIST_ID=$(aws cloudfront list-distributions --profile "$PROFILE" --query "DistributionList.Items[?Comment=='ClawCenter app'].Id" --output text | awk '{print $1}')

if [ -z "$DIST_ID" ] || [ "$DIST_ID" == "None" ]; then
    echo "Error: Could not find CloudFront distribution for ClawCenter"
    exit 1
fi
echo "Found Distribution ID: $DIST_ID"

# 2. Identify Lambda Function URL for ClawCenter Server
SERVER_URL=$(aws lambda get-function-url-config --function-name "serverlessclaw-$STAGE-ClawCenterServerApsoutheast2Function" --profile "$PROFILE" --query "FunctionUrl" --output text 2>/dev/null || \
             aws lambda list-functions --profile "$PROFILE" --query "Functions[?contains(FunctionName, 'ClawCenterServer')].FunctionName" --output text | head -n 1 | xargs -I {} aws lambda get-function-url-config --function-name {} --profile "$PROFILE" --query "FunctionUrl" --output text)

if [ -z "$SERVER_URL" ] || [ "$SERVER_URL" == "None" ]; then
    echo "Error: Could not find Lambda Function URL for ClawCenter Server"
    exit 1
fi
SERVER_HOST=$(echo "$SERVER_URL" | sed 's/https:\/\///' | sed 's/\///')
echo "Found Server Host: $SERVER_HOST"

# 3. Identify Image Optimizer Lambda URL
IMAGE_URL=$(aws lambda get-function-url-config --function-name "serverlessclaw-$STAGE-ClawCenterImageOptimizerFunction" --profile "$PROFILE" --query "FunctionUrl" --output text 2>/dev/null || \
            aws lambda list-functions --profile "$PROFILE" --query "Functions[?contains(FunctionName, 'ClawCenterImageOptimizer')].FunctionName" --output text | head -n 1 | xargs -I {} aws lambda get-function-url-config --function-name {} --profile "$PROFILE" --query "FunctionUrl" --output text)

if [ -z "$IMAGE_URL" ] || [ "$IMAGE_URL" == "None" ]; then
    echo "Warning: Could not find Image Optimizer URL, using Server Host instead"
    IMAGE_HOST=$SERVER_HOST
else
    IMAGE_HOST=$(echo "$IMAGE_URL" | sed 's/https:\/\///' | sed 's/\///')
fi
echo "Found Image Host: $IMAGE_HOST"

# 4. Identify S3 Assets Bucket
S3_BUCKET=$(aws s3 ls --profile "$PROFILE" | grep "clawcenterassetsbucket" | awk '{print $NF}' | head -n 1)
if [ -z "$S3_BUCKET" ]; then
    echo "Error: Could not find S3 Assets Bucket"
    exit 1
fi
S3_DOMAIN="$S3_BUCKET.s3.ap-southeast-2.amazonaws.com"
echo "Found S3 Domain: $S3_DOMAIN"

# 5. Update CloudFront Distribution Origin
echo "Updating CloudFront Distribution Origin to Server Host..."
ETAG=$(aws cloudfront get-distribution-config --id "$DIST_ID" --profile "$PROFILE" --query "ETag" --output text)
aws cloudfront get-distribution-config --id "$DIST_ID" --profile "$PROFILE" --query "DistributionConfig" > dist-config.json
jq ".Origins.Items[0].DomainName = \"$SERVER_HOST\" | .Origins.Items[0].CustomOriginConfig.OriginProtocolPolicy = \"https-only\"" dist-config.json > updated-dist-config.json
aws cloudfront update-distribution --id "$DIST_ID" --distribution-config file://updated-dist-config.json --if-match "$ETAG" --profile "$PROFILE" > /dev/null
echo "Distribution Origin Updated"

# 6. Create and Update CloudFront Function with Enhanced Routing Logic
echo "Updating CloudFront Function with Routing Logic..."
CF_FUNC_NAME=$(aws cloudfront get-distribution-config --id "$DIST_ID" --profile "$PROFILE" --query "DistributionConfig.DefaultCacheBehavior.FunctionAssociations.Items[?EventType=='viewer-request'].FunctionARN" --output text | awk -F/ '{print $NF}')

if [ -z "$CF_FUNC_NAME" ] || [ "$CF_FUNC_NAME" == "None" ]; then
    echo "Error: Could not find CloudFront Function association"
    exit 1
fi
echo "Found CloudFront Function: $CF_FUNC_NAME"

cat <<EOF > router-cf.js
import cf from "cloudfront";

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // 1. Explicit Assets -> S3 mapping (SST v4 uses _assets prefix)
  if (uri.startsWith("/_next/static/") || uri.startsWith("/_assets/")) {
    request.uri = "/_assets" + uri;
    cf.updateRequestOrigin({
      domainName: "$S3_DOMAIN",
      originAccessControlConfig: { enabled: true, signingBehavior: "always", signingProtocol: "sigv4", originType: "s3" }
    });
    return request;
  }

  // 2. Images (Next.js API) -> Image Optimizer
  if (uri.startsWith("/_next/image")) {
    request.headers["x-forwarded-host"] = { value: request.headers.host.value };
    cf.updateRequestOrigin({
      domainName: "$IMAGE_HOST",
      customOriginConfig: { port: 443, protocol: "https", sslProtocols: ["TLSv1.2"] }
    });
    return request;
  }

  // 3. Root Level Static Assets (logo.png, favicon.ico, etc.) -> S3
  var staticExtensions = [".png", ".ico", ".svg", ".jpg", ".jpeg", ".css", ".js", ".js.map", ".woff", ".woff2", ".ttf", ".otf", ".json", ".txt"];
  var lowerUri = uri.toLowerCase();
  for (var i = 0; i < staticExtensions.length; i++) {
    var ext = staticExtensions[i];
    if (lowerUri.length >= ext.length && lowerUri.substr(lowerUri.length - ext.length) === ext) {
      request.uri = "/_assets" + uri;
      cf.updateRequestOrigin({
        domainName: "$S3_DOMAIN",
        originAccessControlConfig: { enabled: true, signingBehavior: "always", signingProtocol: "sigv4", originType: "s3" }
      });
      return request;
    }
  }

  // 4. Default -> Lambda Server
  request.headers["x-forwarded-host"] = { value: request.headers.host.value };
  cf.updateRequestOrigin({
    domainName: "$SERVER_HOST",
    customOriginConfig: { port: 443, protocol: "https", sslProtocols: ["TLSv1.2"] }
  });
  return request;
}
EOF

# Update Function
FUNC_ETAG=$(aws cloudfront describe-function --name "$CF_FUNC_NAME" --stage LIVE --profile "$PROFILE" --query "ETag" --output text)
aws cloudfront update-function --name "$CF_FUNC_NAME" --if-match "$FUNC_ETAG" --function-code fileb://router-cf.js --function-config "{\"Comment\":\"Post-deploy router fix with legacy string compat\",\"Runtime\":\"cloudfront-js-2.0\"}" --profile "$PROFILE" > /dev/null

# Publish Function
DEV_ETAG=$(aws cloudfront describe-function --name "$CF_FUNC_NAME" --stage DEVELOPMENT --profile "$PROFILE" --query "ETag" --output text)
aws cloudfront publish-function --name "$CF_FUNC_NAME" --if-match "$DEV_ETAG" --profile "$PROFILE" > /dev/null

echo "CloudFront Function Updated and Published with Routing Logic (Legacy String Compat)"

# Cleanup
rm dist-config.json updated-dist-config.json router-cf.js 2>/dev/null || true

echo "Post-Deploy CloudFront Fix Completed Successfully"
