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
    // We use a dynamic import with a variable to bypass Vite static analysis
    // and keep the core framework decoupled from private logic
    const domainName = '@voltx/core';
    const domain = await import(domainName);
    if (domain && typeof domain.bootstrap === 'function') {
      domain.bootstrap();
      logger.info('[Bootstrap] Domain extensions activated.');
    }
  } catch {
    // Graceful fallback if no domain extension is present
    logger.debug('[Bootstrap] No domain extensions found or failed to load.');
  }

  initialized = true;
}
