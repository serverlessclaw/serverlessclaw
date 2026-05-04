import { SYSTEM } from '../core/lib/constants/system';

interface DeployerContext {
  stagingBucket: sst.aws.Bucket;
  githubToken?: sst.Secret;
}

/**
 * Creates the CodeBuild deployer project and associated IAM roles.
 * Provides the core CI/CD mechanism for deploying the serverlessclaw infrastructure.
 * @param ctx The deployment context containing necessary AWS resources.
 */
export function createDeployer(ctx: DeployerContext) {
  const { stagingBucket, githubToken } = ctx;

  const deployerRole = new aws.iam.Role('DeployerRole', {
    assumeRolePolicy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: { Service: 'codebuild.amazonaws.com' },
        },
      ],
    }),
  });

  // 1.7 Scoped IAM policy for deployment
  new aws.iam.RolePolicy('DeployerScopedPolicy', {
    role: deployerRole.name,
    policy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: [
            'cloudformation:*',
            's3:*',
            'lambda:*',
            'apigateway:*',
            'route53:*',
            'acm:*',
            'dynamodb:*',
            'events:*',
            'ssm:GetParameters',
            'ssm:GetParameter',
            'ecr:*',
            'codebuild:*',
            'kms:*',
            'iot:*',
            'iam:PassRole',
            'iam:GetRole',
            'iam:ListRolePolicies',
            'iam:GetRolePolicy',
          ],
          Resource: '*',
          Condition: {
            StringEquals: {
              'aws:ResourceTag/sst:app': $app.name,
              'aws:ResourceTag/sst:stage': $app.stage,
            },
          },
        },
        // Dedicated statement for CloudWatch Logs (untagged)
        {
          Effect: 'Allow',
          Action: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents',
            'logs:DescribeLogStreams',
            'logs:GetLogEvents',
          ],
          Resource: '*',
        },
        // Exception: IAM management and global listing
        {
          Effect: 'Allow',
          Action: [
            'iam:CreateServiceLinkedRole',
            'route53:ListHostedZones',
            'acm:ListCertificates',
            's3:ListAllMyBuckets',
            'ecr:GetAuthorizationToken',
          ],
          Resource: '*',
        },
      ],
    }),
  });

  const githubRepo = process.env.GITHUB_REPO || SYSTEM.DEFAULT_GITHUB_REPO;
  const envVars = [
    { name: 'SST_STAGE', value: $app.stage },
    { name: 'STAGING_BUCKET_NAME', value: stagingBucket.name },
    { name: 'GITHUB_REPO', value: githubRepo },
    { name: 'TRUNK_SYNC_ENABLED', value: process.env.TRUNK_SYNC_ENABLED || 'false' },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const link: any[] = [stagingBucket];

  if (githubToken) {
    envVars.push({ name: 'GITHUB_TOKEN', value: githubToken.value });
    link.push(githubToken);
  }

  const deployer = new aws.codebuild.Project('Deployer', {
    name: `${$app.name}-${$app.stage}-Deployer`,
    serviceRole: deployerRole.arn,
    artifacts: { type: 'NO_ARTIFACTS' },
    environment: {
      computeType: 'BUILD_GENERAL1_SMALL',
      image: 'aws/codebuild/amazonlinux2-x86_64-standard:5.0',
      type: 'LINUX_CONTAINER',
      environmentVariables: envVars,
    },
    source: {
      type: 'GITHUB',
      location: `https://github.com/${githubRepo}.git`,
      buildspec: 'buildspec.yml',
    },
  });

  // Linkable wrapper to expose Deployer.name and Deployer.arn to other resources via Resource.Deployer
  const linkable = new sst.Linkable('Deployer', {
    properties: {
      name: deployer.name,
      arn: deployer.arn,
    },
  });

  return { deployer, linkable };
}
