/**
 * Single Source of Truth for system-wide configuration parameters.
 * Shared between core agents (reasoning) and dashboard (UI).
 */

import { LLMProvider, MiniMaxModel } from './types/llm';
import { EvolutionMode } from './types/agent';
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
    default: LLMProvider.MINIMAX,
  },
  active_model: {
    label: 'LLM Model',
    description: 'The specific model ID used for system-wide reasoning.',
    implication:
      'Advanced models improve quality and reasoning depth; smaller models reduce cost and latency.',
    default: MiniMaxModel.M2_7,
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
    safeguard:
      'System automatically blocks autonomous deploys if the Circuit Breaker is triggered.',
    default: EvolutionMode.HITL,
  },
  circuit_breaker_threshold: {
    label: 'Circuit Breaker Threshold',
    description: 'Number of failures in the sliding window before opening the circuit.',
    implication:
      'Stops "Death Spirals" where the system repeatedly fails to fix a bug or health check.',
    safeguard: 'Blocks autonomous deployments until the cooldown period expires.',
    default: '5',
  },
  circuit_breaker_window_ms: {
    label: 'Circuit Breaker Window (ms)',
    description: 'Sliding window duration for tracking system failures.',
    implication: 'Controls the "memory" of recent failures.',
    default: '3600000',
  },
  circuit_breaker_cooldown_ms: {
    label: 'Circuit Breaker Cooldown (ms)',
    description: 'Wait time before transitioning from OPEN to HALF-OPEN state.',
    implication: 'Ensures the system "rests" before attempting a probe deployment.',
    default: '600000',
  },
  circuit_breaker_half_open_max: {
    label: 'Half-Open Max Probes',
    description: 'Number of test deployments allowed while in the HALF-OPEN state.',
    implication: 'Limits the risk of re-failure during recovery.',
    default: '1',
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
    default: '48',
  },
  min_gaps_for_review: {
    label: 'Min Gaps for Review',
    description: 'Required capability gaps before a review is triggered.',
    implication: 'Ensures strategic reviews have sufficient data to be meaningful.',
    default: '20',
  },
  max_tool_iterations: {
    label: 'Max Tool Iterations',
    description: 'Maximum loops of tool-calling per request.',
    implication: 'Allows agents to perform multi-step research and cross-verification.',
    risk: 'High values increase per-request cost significantly.',
    default: '15',
  },
  context_safety_margin: {
    label: 'Context Safety Margin',
    description: 'Fraction of context window reserved for the LLM response and safety buffer.',
    implication: 'Higher values reduce the risk of context overflow errors during long tasks.',
    risk: 'Setting too high (>0.4) wastes available context budget for conversation.',
    default: '0.2',
  },
  context_summary_trigger_ratio: {
    label: 'Context Summary Trigger',
    description: 'Ratio of context usage that triggers background history summarization.',
    implication: 'Lower values trigger compaction earlier, preserving more structure.',
    risk: 'Too aggressive triggering (<0.5) loses recent context before summarization completes.',
    default: '0.8',
  },
  context_summary_ratio: {
    label: 'Compressed History Budget',
    description: 'Fraction of available context budget allocated to the compressed history tier.',
    implication:
      'Higher values preserve more historical context but reduce room for recent messages.',
    default: '0.3',
  },
  context_active_window_ratio: {
    label: 'Active Window Budget',
    description:
      'Fraction of available context budget allocated to the priority-scored active window.',
    implication: 'Works in concert with compressed history budget (must sum to ≤1.0).',
    risk: 'Values close to 1.0 leave no room for compressed history/facts.',
    default: '0.7',
  },
  feature_flags_enabled: {
    label: 'Feature Flags',
    description: 'Global enable/disable for feature flag evaluation.',
    implication: 'When disabled, all feature flags evaluate to false regardless of flag state.',
    risk: 'Disabling mid-features may leave agents in undefined state.',
    safeguard: 'Flags are evaluated per-invocation; disabling halts new evaluations immediately.',
    default: 'true',
  },
  alert_error_rate_threshold: {
    label: 'Error Rate Alert',
    description: 'Error rate threshold (0-1) for agent alerting.',
    implication: 'Lower values trigger alerts more frequently.',
    risk: 'Too low (<0.1) may cause alert fatigue.',
    default: '0.3',
  },
  alert_dlq_threshold: {
    label: 'DLQ Overflow Alert',
    description: 'Number of DLQ events before alerting.',
    implication: 'Lower values catch issues earlier.',
    default: '10',
  },
  alert_token_anomaly_multiplier: {
    label: 'Token Anomaly Multiplier',
    description: 'Alert if tokens exceed this multiplier above rolling average.',
    implication: 'Higher values reduce false positives but may miss gradual drift.',
    risk: 'Too low (<2.0) may cause alert fatigue on normal variance.',
    default: '3.0',
  },
  escalation_enabled: {
    label: 'Escalation Engine',
    description: 'Whether multi-level escalation is enabled for clarification requests.',
    implication:
      'When enabled, the system uses configurable ladders (Telegram, Dashboard, Email, etc.) before failing a task.',
    safeguard: 'Falls back to legacy retry behavior if the escalation engine fails.',
    default: 'true',
  },
  protocol_fallback_enabled: {
    label: 'Protocol Fallback',
    description: 'Whether protocol fallback (JSON -> Text) is enabled.',
    implication:
      'If JSON parsing fails during agent communication, the system automatically retries in Text mode to preserve task continuity.',
    safeguard: 'Only triggers after a failed JSON parse or provider error.',
    default: 'true',
  },
  router_success_weight: {
    label: 'Router Success Weight',
    description: 'Multiplier for agent success rate in routing decisions.',
    implication:
      'Higher values favor agents with a high historical success rate, even if they are more expensive.',
    default: '1.0',
  },
  router_token_penalty_weight: {
    label: 'Router Token Penalty',
    description: 'Weight of the token usage penalty in routing decisions.',
    implication:
      'Higher values favor cheaper, more token-efficient agents. Lower values prioritize quality over cost.',
    default: '0.0001',
  },
  safety_policies: {
    label: 'Global Safety Policies',
    description: 'Dynamic override for all safety tiers (Sandbox/Autonomous).',
    implication: 'Allows changing blocked paths and approval requirements without redeploy.',
    risk: 'Malformed JSON here can block all agent actions. Use with caution.',
    default: '{}',
  },
};
