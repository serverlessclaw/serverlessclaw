/**
 * GitHub Integration Stack
 * Example of a project-specific infrastructure layer.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createGitHubStack(resources: any) {
  const { bus } = resources;

  // Example: A specialized bucket for GitHub artifacts
  const githubBucket = new sst.aws.Bucket('GitHubArtifacts');

  // Example: A rule to notify on specific GitHub events
  bus.subscribe('GitHubReleaseCreated', {
    handler: 'packages/integration-github/src/handlers/release-notifier.handler',
    link: [githubBucket],
  });

  return { githubBucket };
}
