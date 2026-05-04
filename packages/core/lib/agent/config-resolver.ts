import { IAgentConfig, ReasoningProfile } from '../types/index';
import { SYSTEM, CONFIG_KEYS, OPTIMIZATION_POLICIES } from '../constants';
import { ConfigManager } from '../registry/config';
import { logger } from '../logger';

/**
 * Resolves the active model, provider, and reasoning profile for an agent.
 */
export async function resolveAgentConfig(
  agentConfig: IAgentConfig | undefined,
  requestedProfile?: ReasoningProfile
) {
  let activeModel = agentConfig?.model ?? SYSTEM.DEFAULT_MODEL;
  let activeProvider = agentConfig?.provider ?? SYSTEM.DEFAULT_PROVIDER;
  let activeProfile =
    requestedProfile ?? agentConfig?.reasoningProfile ?? ReasoningProfile.STANDARD;

  try {
    const globalProvider = (await ConfigManager.getRawConfig(
      CONFIG_KEYS.ACTIVE_PROVIDER
    )) as string;
    const globalModel = (await ConfigManager.getRawConfig(CONFIG_KEYS.ACTIVE_MODEL)) as string;

    if (globalProvider) activeProvider = globalProvider;
    if (globalModel) activeModel = globalModel;

    if (!globalProvider && !globalModel && agentConfig) {
      const { AgentRouter } = await import('../routing/AgentRouter');
      const routed = await AgentRouter.selectModel(agentConfig, { profile: activeProfile });
      activeProvider = routed.provider;
      activeModel = routed.model;
    }

    if (!process.env.VITEST) {
      const policy = await ConfigManager.getRawConfig(CONFIG_KEYS.OPTIMIZATION_POLICY);
      if (policy === OPTIMIZATION_POLICIES.AGGRESSIVE) activeProfile = ReasoningProfile.DEEP;
      else if (policy === OPTIMIZATION_POLICIES.CONSERVATIVE) activeProfile = ReasoningProfile.FAST;

      if (!globalModel && !activeModel) {
        const profileMap = (await ConfigManager.getRawConfig(
          CONFIG_KEYS.REASONING_PROFILES
        )) as Record<string, string>;
        if (profileMap?.[activeProfile]) activeModel = profileMap[activeProfile];
      }
    }
  } catch {
    logger.warn('Failed to fetch config from DDB, using defaults.');
  }

  return { activeModel, activeProvider, activeProfile };
}
