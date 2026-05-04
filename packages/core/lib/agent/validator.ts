import { IAgentConfig } from '../types/index';

/**
 * Validates that an IAgentConfig has all required fields populated.
 *
 * @param config - The agent configuration to validate.
 * @param agentType - The type identifier of the agent, used for error messages.
 * @throws Error if config is undefined or missing required fields.
 */
export function validateAgentConfig(config: IAgentConfig | undefined, agentType: string): void {
  if (!config) {
    throw new Error(
      `Agent config is required for '${agentType}'. ` +
        `Ensure AgentRegistry.getAgentConfig() returns a valid config.`
    );
  }

  const required: (keyof IAgentConfig)[] = ['id', 'name', 'enabled'];
  const missing = required.filter(
    (key) => config[key] === undefined || config[key] === null || config[key] === ''
  );

  if (missing.length > 0) {
    throw new Error(
      `Agent config for '${agentType}' missing required fields: ${missing.join(', ')}. ` +
        `Ensure the config is fully populated in AgentRegistry or backbone.ts.`
    );
  }

  // Principle 14: Selection Integrity - Must check enabled === true
  if (config.enabled !== true) {
    throw new Error(
      `Agent '${agentType}' is currently DISABLED. ` +
        `Operation rejected to satisfy Principle 14 (Selection Integrity).`
    );
  }

  // systemPrompt is mandatory for LLM agents (default type)
  if (!config.systemPrompt) {
    throw new Error(`Agent config for '${agentType}' is missing systemPrompt.`);
  }
}
