import { logger } from '../logger';
import type { SessionState } from '../session/session-state';

/**
 * Proactive Smart Warmup (Intent-Based)
 * Only trigger on first hop (depth === 0) and in serverless environments.
 * Returns immediately to avoid blocking the main execution path.
 */
export function triggerSmartWarmup(
  userText: string,
  depth: number,
  sessionId?: string,
  sessionStateManager?: { getState: (id: string) => Promise<SessionState | null> },
  workspaceId?: string
): void {
  if (depth === 0 && process.env.LAMBDA_TASK_ROOT) {
    import('../warmup/warmup-manager')
      .then(async ({ WarmupManager }) => {
        const serverArns = process.env.MCP_SERVER_ARNS
          ? JSON.parse(process.env.MCP_SERVER_ARNS)
          : {};
        const agentArns = process.env.AGENT_ARNS ? JSON.parse(process.env.AGENT_ARNS) : {};

        if (Object.keys(serverArns).length > 0 || Object.keys(agentArns).length > 0) {
          const warmup = new WarmupManager({
            servers: serverArns,
            agents: agentArns,
            ttlSeconds: 900,
          });

          const sessionState =
            sessionId && sessionStateManager
              ? await sessionStateManager.getState(sessionId)
              : undefined;

          warmup
            .smartWarmup({
              intent: userText,
              sessionState,
              warmedBy: 'webhook',
              workspaceId,
            })
            .catch((err) => logger.warn('[Warmup] Proactive trigger failed:', err));
        }
      })
      .catch((err) => logger.warn('[Warmup] Failed to load WarmupManager:', err));
  }
}
