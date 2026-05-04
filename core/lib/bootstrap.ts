import { logger } from './logger';

let initialized = false;

/**
 * Framework-level bootstrap hook.
 * Dynamically attempts to load domain-specific extensions (like VoltX).
 */
export async function bootstrap() {
  if (initialized) return;
  
  try {
    // Attempt to load domain-specific extensions
    // We use a dynamic import to keep the core framework decoupled from private logic
    // @ts-ignore
    const domain = await import('@voltx/core');
    if (domain && typeof domain.bootstrap === 'function') {
       domain.bootstrap();
       logger.info('[Bootstrap] Domain extensions activated.');
    }
  } catch (e) {
    // Graceful fallback if no domain extension is present
    logger.debug('[Bootstrap] No domain extensions found or failed to load.');
  }
  
  initialized = true;
}
