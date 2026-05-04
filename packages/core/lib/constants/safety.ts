/**
 * @module SafetyConstants
 * @description Centralized constants for the Safety vertical (Silo 3 & Silo 6).
 */

/**
 * System-protected resource paths and glob patterns.
 * Accessing these requires manual approval or elevated trust in AUTO mode.
 * Consolidated from legacy PROTECTED_FILES and SafetyBase hardcodings.
 */
export const PROTECTED_PATHS = [
  // Core Infrastructure
  'core/**',
  'infra/**',
  'sst.config.ts',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '.env*',
  '.github/**',
  '.antigravity/**',

  // Sensitive Governance Docs
  'docs/governance/**',

  // Critical Code Base
  'core/tools/index.ts',
  'core/agents/superclaw.ts',
  'core/lib/agent.ts',
  'core/lib/registry/AgentRegistry.ts',
  'core/lib/routing/AgentRouter.ts',
  'buildspec.yml',

  // Recovery and Safety Handlers
  'core/handlers/recovery.ts',
  'core/lib/safety/circuit-breaker.ts',
  'core/lib/safety/safety-engine.ts',
  'core/lib/lock/lock-manager.ts',
  'core/handlers/events/index.ts',

  // Legacy patterns for compatibility
  '.git/**',
  'node_modules/**',
] as const;

/**
 * Legacy alias for PROTECTED_PATHS to maintain backward compatibility with Silo 2 (The Hand).
 * Consolidated into Silo 3 (The Shield) for Principle 10 compliance.
 */
export const PROTECTED_FILES = PROTECTED_PATHS;

/**
 * Common keys in tool arguments that typically contain file or resource paths.
 * Used for heuristic scanning during resource discovery.
 */
export const PATH_KEYS = [
  'path',
  'path_to_file',
  'file_path',
  'filePath',
  'source',
  'destination',
  'dir',
  'dir_path',
  'dirPath',
  'filename',
  'file',
  'location',
  'uri',
] as const;

/**
 * Class C actions: Sensitive changes requiring blast radius tracking and elevated approval.
 * Aligned with PRINCIPLES.md Risk Classification Matrix.
 */
export const CLASS_C_ACTIONS = [
  'iam_change',
  'infra_topology',
  'memory_retention',
  'tool_permission',
  'deployment',
  'security_guardrail',
  'code_change',
  'audit_override',
  'policy_update',
] as const;

/**
 * Class D actions: Permanently blocked operations (Policy Protected).
 */
export const CLASS_D_ACTIONS = [
  'trust_manipulation',
  'mode_shift',
  'policy_core_override',
] as const;

/**
 * Safety-related operational limits.
 */
export const SAFETY_LIMITS = {
  VIOLATION_MEMORY_LIMIT: 100,
  CLASS_C_MAX_DAILY: 5,
  CLASS_C_MAX_PER_HOUR: 5,
  HEURISTIC_SCAN_DEPTH: 5,
} as const;
