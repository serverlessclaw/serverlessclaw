interface DeployerContext {
  stagingBucket: sst.aws.Bucket;
  githubToken?: sst.Secret;
}

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

  new aws.iam.RolePolicyAttachment('DeployerAdminPolicy', {
    policyArn: 'arn:aws:iam::aws:policy/AdministratorAccess',
    role: deployerRole.name,
  });

  const envVars = [
    { name: 'SST_STAGE', value: $app.stage },
    { name: 'STAGING_BUCKET_NAME', value: stagingBucket.name },
  ];

  const link = [stagingBucket];

  if (githubToken) {
    envVars.push({ name: 'GITHUB_TOKEN', value: githubToken.value });
    link.push(githubToken as sst.aws.Secret);
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
      location: 'https://github.com/caopengau/serverlessclaw.git',
      buildspec: 'buildspec.yml',
    },
  });

  // Note: SST v3 doesn't support direct link on aws.codebuild.Project yet,
  // but we return it for consistency in context.
  return { deployer };
}
