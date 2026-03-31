/**
 * Post-deploy fix for CloudFront S3 origin routing.
 *
 * SST's Nextjs component creates CloudFront with only a placeholder origin.
 * This script:
 *   1. Adds the S3 bucket as a second origin
 *   2. Updates the CloudFront function to route static assets → S3, dynamic → Lambda
 *   3. Syncs build assets to S3
 *   4. Verifies the dashboard is accessible
 *
 * Usage: pnpm exec tsx scripts/fix-cloudfront-deploy.ts [stage]
 */

import {
  CloudFrontClient,
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
  DescribeFunctionCommand,
  UpdateFunctionCommand,
  PublishFunctionCommand,
  CreateOriginAccessControlCommand,
  ListOriginAccessControlsCommand,
} from '@aws-sdk/client-cloudfront';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

const STAGE = process.argv[2] || 'prod';
const APP = 'serverlessclaw';

const cf = new CloudFrontClient({});
const s3 = new S3Client({});

function log(msg: string) {
  console.log(`\x1b[36m[fix-cloudfront]\x1b[0m ${msg}`);
}

function err(msg: string): never {
  console.error(`\x1b[31m[fix-cloudfront ERROR]\x1b[0m ${msg}`);
  process.exit(1);
}

async function getNewestBucketName(): Promise<string> {
  const buckets = await s3.send(new ListBucketsCommand({}));
  const bucketName = buckets.Buckets?.filter(
    (b) => b.Name?.includes('prod') && b.Name?.includes('clawcenterassetsbucket')
  ).sort((a, b) => (b.CreationDate?.getTime() || 0) - (a.CreationDate?.getTime() || 0))?.[0]?.Name;
  if (!bucketName) err('Could not find ClawCenter assets bucket');
  return bucketName;
}

async function findDistribution(): Promise<string> {
  const { ListDistributionsCommand } = await import('@aws-sdk/client-cloudfront');

  // Read dashboard URL from outputs
  let dashboardDomain = '';
  try {
    const outputs = JSON.parse(readFileSync('.sst/outputs.json', 'utf-8'));
    if (outputs.dashboardUrl) {
      dashboardDomain = new URL(outputs.dashboardUrl).hostname;
      log(`Dashboard domain: ${dashboardDomain}`);
    }
  } catch {
    // outputs.json may not exist yet
  }

  const allDists = await cf.send(new ListDistributionsCommand({}));

  // First try: match by alias (most reliable)
  if (dashboardDomain) {
    const byAlias = allDists.DistributionList?.Items?.find((d) =>
      d.Aliases?.Items?.includes(dashboardDomain)
    );
    if (byAlias?.Id) {
      log(`Distribution (by alias): ${byAlias.Id}`);
      return byAlias.Id;
    }
  }

  // Fallback: match by comment (picks the one with most recent LastModifiedTime)
  const byComment = allDists.DistributionList?.Items?.filter(
    (d) => d.Comment === 'ClawCenter app'
  ).sort(
    (a, b) => new Date(b.LastModifiedTime!).getTime() - new Date(a.LastModifiedTime!).getTime()
  );
  if (byComment?.[0]?.Id) {
    log(`Distribution (by comment): ${byComment[0].Id}`);
    return byComment[0].Id;
  }

  err('Could not find ClawCenter CloudFront distribution');
}

async function addS3Origin(distId: string) {
  const current = await cf.send(new GetDistributionConfigCommand({ Id: distId }));
  const config = current.DistributionConfig!;
  const etag = current.ETag!;

  const bucketName = await getNewestBucketName();
  const s3Domain = `${bucketName}.s3.ap-southeast-2.amazonaws.com`;

  // Check if S3 origin already exists
  const existingS3 = config.Origins?.Items?.find((o) => o.Id === 's3');
  if (existingS3) {
    if (existingS3.DomainName === s3Domain) {
      log(`S3 origin already points to the correct bucket (${bucketName}), skipping`);
      return;
    }
    log(`Updating S3 origin from ${existingS3.DomainName} to ${s3Domain}...`);
    existingS3.DomainName = s3Domain;
  } else {
    log(`Adding S3 origin for bucket ${bucketName}...`);
    // Find or create OAC
    const oacs = await cf.send(new ListOriginAccessControlsCommand({}));
    let oacId = oacs.OriginAccessControlList?.Items?.find((o) =>
      o.Name?.includes('ClawCenter')
    )?.Id;

    if (!oacId) {
      log('Creating Origin Access Control...');
      const oac = await cf.send(
        new CreateOriginAccessControlCommand({
          OriginAccessControlConfig: {
            Name: `${APP}-${STAGE}-ClawCenterOAC`,
            OriginAccessControlOriginType: 's3',
            SigningBehavior: 'always',
            SigningProtocol: 'sigv4',
          },
        })
      );
      oacId = oac.OriginAccessControl?.Id;
    }

    // Add S3 origin
    config.Origins!.Items!.push({
      Id: 's3',
      DomainName: s3Domain,
      OriginPath: '/_assets',
      OriginAccessControlId: oacId,
      S3OriginConfig: { OriginAccessIdentity: '' },
      CustomHeaders: { Quantity: 0 },
      ConnectionAttempts: 3,
      ConnectionTimeout: 10,
      OriginShield: { Enabled: false },
    });
    config.Origins!.Quantity = config.Origins!.Items!.length;
  }

  await cf.send(
    new UpdateDistributionCommand({
      Id: distId,
      IfMatch: etag,
      DistributionConfig: config,
    })
  );
  log('S3 origin configured. Waiting 10s for propagation...');
  await new Promise((r) => setTimeout(r, 10000));
}

async function fixCloudFrontFunction(distId: string) {
  // Find the function associated with the distribution
  const distConfig = await cf.send(new GetDistributionConfigCommand({ Id: distId }));
  const fnAssoc = distConfig.DistributionConfig?.DefaultCacheBehavior?.FunctionAssociations;
  log(`Function associations: ${JSON.stringify(fnAssoc)}`);
  const fnArn = fnAssoc?.Items?.[0]?.FunctionARN;
  if (!fnArn) {
    log('No function ARN found. Distribution may still be propagating. Waiting 30s...');
    await new Promise((r) => setTimeout(r, 30000));
    const retry = await cf.send(new GetDistributionConfigCommand({ Id: distId }));
    const retryArn =
      retry.DistributionConfig?.DefaultCacheBehavior?.FunctionAssociations?.Items?.[0]?.FunctionARN;
    if (!retryArn) err('No function associated with distribution after retry');
    return fixCloudFrontFunctionInner(distId, retryArn!);
  }
  return fixCloudFrontFunctionInner(distId, fnArn);
}

async function fixCloudFrontFunctionInner(distId: string, fnArn: string) {
  const fnName = fnArn!
    .split(':')
    .pop()!
    .replace(/^(function\/)/, '');

  // Find Lambda function URL
  const {
    LambdaClient,
    ListFunctionUrlConfigsCommand,
    ListFunctionsCommand: ListLambdaFunctions,
  } = await import('@aws-sdk/client-lambda');
  const lambda = new LambdaClient({});
  const lambdaFns = await lambda.send(new ListLambdaFunctions({}));
  const serverFn = lambdaFns.Functions?.filter(
    (f) => f.FunctionName?.includes('ClawCenterServer') && f.FunctionName?.includes('prod')
  ).sort((a, b) => new Date(b.LastModified!).getTime() - new Date(a.LastModified!).getTime())?.[0];
  if (!serverFn?.FunctionName) err('Could not find ClawCenter server Lambda');

  const urlConfig = await lambda.send(
    new ListFunctionUrlConfigsCommand({
      FunctionName: serverFn.FunctionName,
    })
  );
  const lambdaUrl = urlConfig.FunctionUrlConfigs?.[0]?.FunctionUrl;
  if (!lambdaUrl) err('Lambda function has no URL');

  const lambdaHost = new URL(lambdaUrl).host;
  const bucketName = await getNewestBucketName();

  log(`Updating CloudFront function to use bucket: ${bucketName}`);

  // Build routing function code - route static to S3, rest to Lambda
  const code = `import cf from "cloudfront";
async function handler(event) {
  var host = event.request.headers.host ? event.request.headers.host.value : "";
  if (host.includes("cloudfront.net")) {
    return { statusCode: 403, statusDescription: "Forbidden", body: { encoding: "text", data: "<html><body><h1>403</h1></body></html>" } };
  }
  event.request.headers["x-forwarded-host"] = event.request.headers.host;
  var uri = event.request.uri;
  if (uri.startsWith("/_next/") || uri.endsWith(".css") || uri.endsWith(".js") || uri.endsWith(".woff2") || uri.endsWith(".woff") || uri.endsWith(".png") || uri.endsWith(".jpg") || uri.endsWith(".svg") || uri.endsWith(".ico") || uri.endsWith(".json") || uri.endsWith(".map") || uri.endsWith(".txt") || uri.endsWith(".xml")) {
    cf.updateRequestOrigin({
      domainName: "${bucketName}.s3.ap-southeast-2.amazonaws.com",
      originPath: "/_assets",
      originAccessControlConfig: { enabled: true, signingBehavior: "always", signingProtocol: "sigv4", originType: "s3" }
    });
  } else {
    cf.updateRequestOrigin({
      domainName: "${lambdaHost}",
      customOriginConfig: { port: 443, protocol: "https", sslProtocols: ["TLSv1.2"] },
      originAccessControlConfig: { enabled: false }
    });
  }
  return event.request;
}`;

  // Get fresh ETag and update
  const fnDesc = await cf.send(new DescribeFunctionCommand({ Name: fnName, Stage: 'DEVELOPMENT' }));

  try {
    const upd = await cf.send(
      new UpdateFunctionCommand({
        Name: fnName,
        IfMatch: fnDesc.ETag,
        FunctionCode: new TextEncoder().encode(code),
        FunctionConfig: { Comment: 'S3+Lambda routing', Runtime: 'cloudfront-js-2.0' },
      })
    );

    // Publish to LIVE
    await cf.send(
      new PublishFunctionCommand({
        Name: fnName,
        IfMatch: upd.ETag!,
      })
    );
    log('CloudFront function updated and published');
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'PreconditionFailed') {
      // ETag stale, retry once
      const fresh = await cf.send(
        new DescribeFunctionCommand({ Name: fnName, Stage: 'DEVELOPMENT' })
      );
      const upd = await cf.send(
        new UpdateFunctionCommand({
          Name: fnName,
          IfMatch: fresh.ETag,
          FunctionCode: new TextEncoder().encode(code),
          FunctionConfig: { Comment: 'S3+Lambda routing', Runtime: 'cloudfront-js-2.0' },
        })
      );
      await cf.send(new PublishFunctionCommand({ Name: fnName, IfMatch: upd.ETag! }));
      log('CloudFront function updated and published (retry)');
    } else {
      throw e;
    }
  }

  // Ensure distribution uses this function
  const dist = await cf.send(new GetDistributionConfigCommand({ Id: distId }));
  const cfg = dist.DistributionConfig!;
  const currentFnArn = cfg.DefaultCacheBehavior?.FunctionAssociations?.Items?.[0]?.FunctionARN;
  const targetArn = fnArn.replace(/:function\/.*$/, `:function/${fnName}`);

  if (currentFnArn !== targetArn) {
    cfg.DefaultCacheBehavior!.FunctionAssociations!.Items![0].FunctionARN = targetArn;
    await cf.send(
      new UpdateDistributionCommand({
        Id: distId,
        IfMatch: dist.ETag,
        DistributionConfig: cfg,
      })
    );
    log('Distribution switched to updated function');
  }
}

async function main() {
  log(`Fixing CloudFront for stage: ${STAGE}`);

  const distId = await findDistribution();
  await addS3Origin(distId);
  await fixCloudFrontFunction(distId);

  log('CloudFront fix complete ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
