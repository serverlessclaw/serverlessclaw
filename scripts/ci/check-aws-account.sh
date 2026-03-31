#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
NC='\033[0m' # No Color

STAGE=$1
EXPECTED_ACCOUNT=$2

if [[ -z "$STAGE" || -z "$EXPECTED_ACCOUNT" ]]; then
    exit 0 # Skip if not provided to allow flexible usage in Makefile
fi

# Only check for production
if [[ "$STAGE" != "prod" && "$STAGE" != "production" ]]; then
    exit 0
fi

# Check if aws CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ Error: AWS CLI is not installed or not in PATH.${NC}"
    exit 1
fi

CURRENT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null)

if [[ $? -ne 0 ]]; then
    echo -e "${RED}❌ Error: Could not retrieve AWS account identity. Check your credentials and AWS_PROFILE.${NC}"
    exit 1
fi

if [[ "$CURRENT_ACCOUNT" != "$EXPECTED_ACCOUNT" ]]; then
    echo -e "${RED}❌ Deployment blocked: Stage \"$STAGE\" MUST be deployed to the configured AWS account ($EXPECTED_ACCOUNT). Current account is $CURRENT_ACCOUNT.${NC}"
    exit 1
fi

echo "✅ AWS Account validation passed for stage \"$STAGE\"."
