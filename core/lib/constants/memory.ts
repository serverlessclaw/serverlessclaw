import { CONFIG_DEFAULTS } from '../config/config-defaults';
import { OptimizationPolicy } from '../types/constants';

/**
 * Memory Partition/Sort Key prefixes.
 */
export const MEMORY_KEYS = {
  CONVERSATION_PREFIX: 'CONV#',
  FACT_PREFIX: 'FACT#',
  LESSON_PREFIX: 'LESSON#',
  SUMMARY_PREFIX: 'SUMMARY#',
  METADATA_PREFIX: 'META#',
  RECOVERY: 'SYSTEM#RECOVERY',
  STRATEGIC_REVIEW: 'SYSTEM#STRATEGIC_REVIEW',
  REPUTATION_PREFIX: 'REPUTATION#',
  WORKSPACE_PREFIX: 'WORKSPACE#',
  HEALTH_PREFIX: 'HEALTH#',
  TRACK_PREFIX: 'TRACK#',
  GAP_LOCK_PREFIX: 'GAP_LOCK#',
} as const;

/**
 * Retention policies (days).
 */
export const RETENTION = {
  MESSAGES_DAYS: CONFIG_DEFAULTS.MESSAGE_RETENTION_DAYS.code,
  TRACES_DAYS: CONFIG_DEFAULTS.TRACE_RETENTION_DAYS.code,
  FACTS_DAYS: 365,
  LESSONS_DAYS: 90,
  SUMMARY_DAYS: 30,
  GAPS_DAYS: 730,
  REPUTATION_DAYS: 365,
  SESSION_METADATA_DAYS: 90,
  EPHEMERAL_DAYS: 1,
  HEALTH_DAYS: 7,
} as const;

/**
 * Resource Limits.
 */
export const LIMITS = {
  MAX_CONTEXT_LENGTH: 32768,
  MAX_MESSAGES: 100,
  STALE_GAP_DAYS: CONFIG_DEFAULTS.STALE_GAP_DAYS.code,
  TRACE_TRUNCATE_LENGTH: 2000,
  DEFAULT_LOCK_TTL: CONFIG_DEFAULTS.RECOVERY_LOCK_TTL_SECONDS.code / 3,
  TWO_YEARS_DAYS: 730,
} as const;

/**
 * Optimization Policies.
 */
export const OPTIMIZATION_POLICIES = {
  AGGRESSIVE: OptimizationPolicy.AGGRESSIVE,
  CONSERVATIVE: OptimizationPolicy.CONSERVATIVE,
  BALANCED: OptimizationPolicy.BALANCED,
} as const;

/**
 * Default values for system insights and gap analysis.
 */
export const INSIGHT_DEFAULTS = {
  CONFIDENCE: 9,
  IMPACT: 6,
  COMPLEXITY: 4,
  RISK: 2,
  URGENCY: 5,
  PRIORITY: 5,
} as const;
