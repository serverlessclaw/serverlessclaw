import { systemSchema as schema } from './schema';
import { checkCognitiveHealth } from '../../lib/health';
import { logger } from '../../lib/logger';
import { formatErrorMessage } from '../../lib/utils/error';

/**
 * Performs a comprehensive system-wide health and connectivity check.
 */
export const checkHealth = {
  ...schema.checkHealth,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    logger.info('[Tool] Running system-wide health check...');
    try {
      const verbose = !!args.verbose;
      const result = await checkCognitiveHealth();

      if (verbose) {
        return JSON.stringify(result, null, 2);
      }

      return result.ok
        ? `Health check PASSED: ${result.summary}`
        : `Health check FAILED: ${result.summary} (Use verbose=true for details)`;
    } catch (error) {
      logger.error('Failed to execute health check tool:', error);
      return `Error executing health check: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Enables advanced debugging and logging for a specific agent.
 */
export const debugAgent = {
  ...schema.debugAgent,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { agentId, level } = args as { agentId: string; level: string };

    try {
      const { ConfigManager } = await import('../../lib/registry/config');
      await ConfigManager.saveRawConfig(`debug_${agentId}`, level);
      logger.info(`[DEBUG] Activated level ${level.toUpperCase()} for agent ${agentId}`);
      return `DEBUG_MODE_ACTIVATED: Set logging level for ${agentId} to ${level.toUpperCase()}. This change is persisted to runtime config.`;
    } catch (error) {
      return `Failed to activate debug mode: ${formatErrorMessage(error)}`;
    }
  },
};
