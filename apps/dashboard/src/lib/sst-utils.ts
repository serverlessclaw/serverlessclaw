import { resolveSSTResourceValue } from '@claw/core/lib/utils/resource-helpers';

/**
 * Safely gets a Resource property, with fallback to environment variables.
 * This ensures the dashboard remains functional even if SST links are not active
 * (e.g., during some local development scenarios or CI).
 */
export function getResourceUrl(resourceName: string, prop: string = 'url'): string | undefined {
  const fallbackEnv = `${resourceName.toUpperCase()}_${prop.toUpperCase()}`;
  return (
    resolveSSTResourceValue(resourceName, prop, fallbackEnv) ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.API_URL
  );
}

/**
 * Safely gets a Resource name (like Table Name).
 */
export function getResourceName(resourceName: string): string | undefined {
  const fallbackEnv = `${resourceName.toUpperCase()}_NAME`;
  return resolveSSTResourceValue(resourceName, 'name', fallbackEnv);
}
