import { Resource } from 'sst';

/**
 * Robustly resolves an SST resource property (e.g., 'name', 'value', 'endpoint')
 * from the Resource object or environment fallbacks.
 * Handles SST Ion (v3/v4) JSON-encoded environment variables.
 *
 * @param resourceName - The name of the resource (e.g., 'MemoryTable').
 * @param property - The property to extract (e.g., 'name', 'value').
 * @param fallbackEnvVar - Optional explicit override env var.
 * @param defaultValue - Fallback if nothing else is found.
 * @returns The resolved resource property string.
 */
export function resolveSSTResourceValue(
  resourceName: string,
  property: string = 'name',
  fallbackEnvVar?: string,
  defaultValue?: string
): string | undefined {
  // 1. Try explicit override env var (highest priority for testing)
  if (fallbackEnvVar && process.env[fallbackEnvVar]) {
    return process.env[fallbackEnvVar]!;
  }

  // 2. Try SST Ion JSON fallback (SST_RESOURCE_<Name>)
  // Check this before hitting the Resource proxy to avoid triggering Proxy errors
  const ionEnvVar = `SST_RESOURCE_${resourceName}`;
  const ionValue = process.env[ionEnvVar];
  if (ionValue) {
    try {
      const parsed = JSON.parse(ionValue);
      if (parsed && typeof parsed === 'object' && parsed[property]) {
        return parsed[property];
      }
    } catch {
      // Not JSON, use as is if it's a simple string and we're looking for 'name' or 'value'
      if (property === 'name' || property === 'value') {
        return ionValue;
      }
    }
  }

  // 3. Try traditional Resource access
  // We check for SST_RESOURCE_App to avoid triggering the Proxy's "links not active" error
  // BUT we allow it in test environments where Resource is often mocked
  if (
    process.env.SST_RESOURCE_App ||
    process.env.SST_STAGE ||
    process.env.VITEST ||
    process.env.NODE_ENV === 'test' ||
    process.env.PLAYWRIGHT
  ) {
    try {
      const resource = Resource as unknown as Record<string, Record<string, string>>;
      const item = resource[resourceName];
      if (item && item[property]) return item[property];
    } catch {
      // Resource access might throw if not linked
    }
  }

  return defaultValue;
}

/** Getters for common resources */
export const getAgentBusName = () =>
  resolveSSTResourceValue('AgentBus', 'name', 'AGENT_BUS_NAME', 'AgentBus');
export const getStagingBucketName = () =>
  resolveSSTResourceValue('StagingBucket', 'name', 'STAGING_BUCKET_NAME', 'StagingBucket');
export const getKnowledgeBucketName = () =>
  resolveSSTResourceValue('KnowledgeBucket', 'name', 'KNOWLEDGE_BUCKET_NAME', 'KnowledgeBucket');
export const getWebhookApiUrl = () =>
  resolveSSTResourceValue('WebhookApi', 'url', 'WEBHOOK_API_URL');
export const getAwsRegion = () =>
  resolveSSTResourceValue('AwsRegion', 'value', 'AWS_REGION', 'ap-southeast-2');

/** Gets application metadata (name and stage) */
export function getAppInfo(): { name: string; stage: string } {
  if (
    process.env.SST_RESOURCE_App ||
    process.env.SST_STAGE ||
    process.env.VITEST ||
    process.env.NODE_ENV === 'test' ||
    process.env.PLAYWRIGHT
  ) {
    try {
      const resource = Resource as unknown as Record<string, { name: string; stage: string }>;
      if (resource.App) {
        return { name: resource.App.name, stage: resource.App.stage };
      }
    } catch {
      // ignore
    }
  }

  const ionApp = process.env.SST_RESOURCE_App;
  if (ionApp) {
    try {
      const parsed = JSON.parse(ionApp);
      return { name: parsed.name || 'serverlessclaw', stage: parsed.stage || 'local' };
    } catch {
      // ignore
    }
  }

  return {
    name: process.env.SST_APP || 'serverlessclaw',
    stage: process.env.SST_STAGE || 'local',
  };
}

/** Gets RealtimeBus (IoT) metadata */
export function getRealtimeInfo(): { url: string | null; authorizer: string | null } {
  const endpoint = resolveSSTResourceValue('RealtimeBus', 'endpoint', 'IOT_ENDPOINT');
  const authorizer = resolveSSTResourceValue('RealtimeBus', 'authorizer', 'IOT_AUTHORIZER');

  const url = endpoint
    ? endpoint.startsWith('wss://')
      ? endpoint
      : endpoint.startsWith('https://')
        ? endpoint.replace('https://', 'wss://')
        : `wss://${endpoint}`
    : null;

  return { url, authorizer: authorizer ?? null };
}
