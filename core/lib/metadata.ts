/**
 * Single Source of Truth for system-wide configuration parameters.
 * Shared between core agents (reasoning) and dashboard (UI).
 */
export interface ConfigOptionMetadata {
  label: string;
  description: string;
  implication: string;
  risk?: string;
  safeguard?: string;
  default: string;
}

export const SYSTEM_CONFIG_METADATA: Record<string, ConfigOptionMetadata> = {
  active_provider: {
    label: 'LLM Provider',
    description: 'The primary LLM provider (OpenAI, Anthropic via Bedrock, etc.).',
    implication:
      'Native providers offer the lowest latency. Switching during a session may cause context disruption.',
    risk: 'High provider latency can stall evolution loops.',
    default: 'openai',
  },
  active_model: {
    label: 'LLM Model',
    description: 'The specific model ID used for system-wide reasoning.',
    implication:
      'Advanced models (GPT-5.4) improve coding quality; smaller models (gpt-5.4-mini) reduce cost and latency.',
    default: 'gpt-5.4',
  },
  deploy_limit: {
    label: 'Daily Deploy Limit',
    description: 'Maximum successful deployments allowed per UTC day.',
    implication: 'Prevents runaway AWS costs during autonomous evolution.',
    risk: 'Setting too high (>50) increases risk of expensive trial-and-error loops.',
    default: '5',
  },
  recursion_limit: {
    label: 'Recursion Limit',
    description: 'Maximum hop count for agent-to-agent delegation.',
    implication: 'Enables complex orchestrations and deep reasoning chains.',
    risk: 'Deeper chains increase token usage and risk of infinite logical loops.',
    default: '15',
  },
  evolution_mode: {
    label: 'Evolution Mode',
    description: 'The autonomy level of the system.',
    implication:
      'HITL requires manual approval; AUTO allows the system to deploy code independently.',
    safeguard: 'System automatically reverts to HITL if the Circuit Breaker is triggered.',
    default: 'hitl',
  },
  circuit_breaker_threshold: {
    label: 'Circuit Breaker Threshold',
    description: 'Consecutive build failures before pausing evolution.',
    implication: 'Stops "Death Spirals" where the system repeatedly tries and fails to fix a bug.',
    safeguard: 'Forces manual intervention to review the breaking change.',
    default: '3',
  },
  reflection_frequency: {
    label: 'Reflection Frequency',
    description: 'Messages interval between cognitive reflection tasks.',
    implication: 'Controls how often the system extracts new long-term memories.',
    risk: 'Too frequent reflections (<5) lead to high token overhead and cognitive noise.',
    default: '10',
  },
  strategic_review_frequency: {
    label: 'Strategic Review Interval',
    description: 'Hours between large-scale architectural reviews.',
    implication: 'Ensures the system periodically re-aligns with high-level goals.',
    default: '12',
  },
  min_gaps_for_review: {
    label: 'Min Gaps for Review',
    description: 'Required capability gaps before a review is triggered.',
    implication: 'Ensures strategic reviews have sufficient data to be meaningful.',
    default: '3',
  },
  max_tool_iterations: {
    label: 'Max Tool Iterations',
    description: 'Maximum loops of tool-calling per request.',
    implication: 'Allows agents to perform multi-step research and cross-verification.',
    risk: 'High values increase per-request cost significantly.',
    default: '15',
  },
};
