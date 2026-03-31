/**
 * @module Constants
 * @description System-wide constants to prevent magic literals and improve AI signal clarity.
 * These constants are used across the Serverless Claw stack for configuration,
 * resource naming, and status codes.
 */

import { CONFIG_DEFAULTS } from './config/config-defaults';
import { LLMProvider, OpenAIModel, BedrockModel, OpenRouterModel, MiniMaxModel } from './types/llm';
import { TraceType, TraceStatus, OptimizationPolicy } from './types/constants';
export { NODE_ICON } from './utils/topology/constants';

/**
 * System-wide defaults and operational limits.
 */
export const SYSTEM = {
  /** The primary LLM provider used by default (e.g., MiniMax). */
  DEFAULT_PROVIDER: LLMProvider.MINIMAX,
  /** The default model identifier for the primary provider. */
  DEFAULT_MODEL: MiniMaxModel.M2_7,
  /** The default OpenAI model for fallback or specialized tasks. */
  DEFAULT_OPENAI_MODEL: OpenAIModel.GPT_5_4_MINI,
  /** The default AWS Bedrock model (Claude). */
  DEFAULT_BEDROCK_MODEL: BedrockModel.CLAUDE_4_6,
  /** The default OpenRouter model. */
  DEFAULT_OPENROUTER_MODEL: OpenRouterModel.GLM_5,
  /** The default MiniMax model explicitly defined. */
  DEFAULT_MINIMAX_MODEL: MiniMaxModel.M2_7,
  /** Default limit for nested agent-to-agent calls to prevent infinite loops. */
  DEFAULT_RECURSION_LIMIT: CONFIG_DEFAULTS.RECURSION_LIMIT.code,
  /** Default limit for autonomous code deployments per session. */
  DEFAULT_DEPLOY_LIMIT: CONFIG_DEFAULTS.DEPLOY_LIMIT.code,
  /** Absolute maximum deployments allowed before hard-stop. */
  MAX_DEPLOY_LIMIT: CONFIG_DEFAULTS.MAX_DEPLOY_LIMIT.code,
  /** Key used for system recovery state in persistent storage. */
  RECOVERY_KEY: 'SYSTEM#RECOVERY',
  /** Key for tracking deployment statistics across the swarm. */
  DEPLOY_STATS_KEY: 'SYSTEM#DEPLOY_STATS',
  /** Key for tracking system uptime and health heartbeats. */
  UPTIME_KEY: 'SYSTEM#UPTIME',
  /** The reserved user ID for system-initiated actions. */
  USER_ID: 'SYSTEM',
  /** Resource names for infrastructure components. */
  RESOURCES: {
    API: 'api',
    DASHBOARD: 'dashboard',
    ROUTER: 'router',
    BUS: 'bus',
  },
} as const;

/**
 * DynamoDB Table Item Keys (PK/SK patterns).
 */
export const DYNAMO_KEYS = {
  /** PK for agent configuration records. */
  AGENTS_CONFIG: 'agents_config',
  /** Key for current deployment limits. */
  DEPLOY_LIMIT: 'deploy_limit',
  /** Key for current recursion depth limits. */
  RECURSION_LIMIT: 'recursion_limit',
  /** Key for memory retention and pruning settings. */
  RETENTION_CONFIG: 'retention_config',
  /** Global aggregator for tool usage metrics. */
  TOOL_USAGE: 'tool_usage_global',
  /** Currently active LLM provider. */
  ACTIVE_PROVIDER: 'active_provider',
  /** Currently active LLM model. */
  ACTIVE_MODEL: 'active_model',
  /** The active optimization policy (Balanced/Aggressive/Conservative). */
  OPTIMIZATION_POLICY: 'optimization_policy',
  /** Definitions for reasoning profiles (FAST/STANDARD/DEEP). */
  REASONING_PROFILES: 'reasoning_profiles',
  /** Limit on iterative tool calls per agent loop. */
  MAX_TOOL_ITERATIONS: 'max_tool_iterations',
  /** Global emergency pause flag for agent evolution. */
  GLOBAL_PAUSE: 'global_pause',
  /** Infrastructure configuration and discovery state. */
  INFRA_CONFIG: 'infra_config',
  /** Visual representation of the agent-tool topology. */
  SYSTEM_TOPOLOGY: 'system_topology',
  /** Timeout for human-in-the-loop clarification requests. */
  CLARIFICATION_TIMEOUT_MS: 'clarification_timeout_ms',
  /** Maximum retry attempts for clarification before failure. */
  CLARIFICATION_MAX_RETRIES: 'clarification_max_retries',
  /** Safety buffer for context window calculations. */
  CONTEXT_SAFETY_MARGIN: 'context_safety_margin',
  /** Token ratio that triggers context summarization. */
  CONTEXT_SUMMARY_TRIGGER_RATIO: 'context_summary_trigger_ratio',
  /** Target compression ratio for summaries. */
  CONTEXT_SUMMARY_RATIO: 'context_summary_ratio',
  /** Ratio of recent history kept in the active context window. */
  CONTEXT_ACTIVE_WINDOW_RATIO: 'context_active_window_ratio',
  /** Storage field names and types for indexing. */
  FIELDS: {
    USER_ID: 'userId',
    TIMESTAMP: 'timestamp',
    TYPE: 'type',
    TRACE_ID: 'traceId',
    NODE_ID: 'nodeId',
    KEY: 'key',
    STRING: 'string',
    NUMBER: 'number',
  },
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

/**
 * Configuration Keys for the global ConfigTable.
 */
export const CONFIG_KEYS = {
  /** The currently active LLM provider (e.g., 'openai', 'bedrock'). */
  ACTIVE_PROVIDER: 'active_provider',
  /** The currently active LLM model ID. */
  ACTIVE_MODEL: 'active_model',
  /** The primary optimization strategy (e.g., 'balanced'). */
  OPTIMIZATION_POLICY: 'optimization_policy',
  /** Key for reasoning profile definitions. */
  REASONING_PROFILES: 'reasoning_profiles',
  /** The maximum number of tool iterations an agent can perform. */
  MAX_TOOL_ITERATIONS: 'max_tool_iterations',
  /** The maximum depth of agent-to-agent delegation. */
  RECURSION_LIMIT: 'recursion_limit',
  /** Flag for enabling/disabling selective skill discovery. */
  SELECTIVE_DISCOVERY_MODE: 'selective_discovery_mode',
} as const;

/**
 * Memory Partition/Sort Key prefixes.
 */
export const MEMORY_KEYS = {
  /** Prefix for conversation history partition keys. */
  CONVERSATION_PREFIX: 'CONV#',
  /** Prefix for extracted facts and user preferences. */
  FACT_PREFIX: 'FACT#',
  /** Prefix for tactical lessons learned during execution. */
  LESSON_PREFIX: 'LESSON#',
  /** Prefix for conversation summaries. */
  SUMMARY_PREFIX: 'SUMMARY#',
  /** Prefix for item-level metadata. */
  METADATA_PREFIX: 'META#',
  /** Key for system-wide recovery state. */
  RECOVERY: 'SYSTEM#RECOVERY',
  /** Key for tracking the last strategic review timestamp. */
  STRATEGIC_REVIEW: 'SYSTEM#STRATEGIC_REVIEW',
  /** Prefix for agent reputation data. */
  REPUTATION_PREFIX: 'REPUTATION#',
  /** Prefix for workspace data (multi-human collaboration). */
  WORKSPACE_PREFIX: 'WORKSPACE#',
  /** Prefix for cognitive health records. */
  HEALTH_PREFIX: 'HEALTH#',
  /** Prefix for gap-to-track assignments (multi-track evolution). */
  TRACK_PREFIX: 'TRACK#',
} as const;

/**
 * HTTP Status Codes.
 */
export const HTTP_STATUS = {
  /** Standard success response. */
  OK: 200,
  /** Resource successfully created. */
  CREATED: 201,
  /** Request accepted for background processing. */
  ACCEPTED: 202,
  /** Invalid request parameters or body. */
  BAD_REQUEST: 400,
  /** Missing or invalid authentication. */
  UNAUTHORIZED: 401,
  /** Authenticated but lacking required permissions. */
  FORBIDDEN: 403,
  /** Requested resource does not exist. */
  NOT_FOUND: 404,
  /** State conflict (e.g., duplicate resource). */
  CONFLICT: 409,
  /** Unexpected server-side failure. */
  INTERNAL_ERROR: 500,
  /** Alias for internal error. */
  INTERNAL_SERVER_ERROR: 500,
  /** System overloaded or undergoing maintenance. */
  SERVICE_UNAVAILABLE: 503,
} as const;

/**
 * Trace types for ClawTracer.
 */
export const TRACE_TYPES = {
  /** A prompt submission to an LLM provider. */
  LLM_CALL: TraceType.LLM_CALL,
  /** The final completion result from an LLM. */
  LLM_RESPONSE: TraceType.LLM_RESPONSE,
  /** An agent initiating a tool execution. */
  TOOL_CALL: TraceType.TOOL_CALL,
  /** The raw response data from a tool. */
  TOOL_RESPONSE: TraceType.TOOL_RESPONSE,
  /** Alias for tool response. */
  TOOL_RESULT: TraceType.TOOL_RESPONSE,
  /** A self-reflection cycle by an agent. */
  REFLECT: TraceType.REFLECT,
  /** An event being emitted to the AgentBus. */
  EMIT: TraceType.EMIT,
  /** A message crossing provider/interface boundaries. */
  BRIDGE: TraceType.BRIDGE,
  /** An operation failure or exception. */
  ERROR: TraceType.ERROR,
  /** Agent requesting clarification from initiator. */
  CLARIFICATION_REQUEST: TraceType.CLARIFICATION_REQUEST,
  /** Initiator providing clarification answer. */
  CLARIFICATION_RESPONSE: TraceType.CLARIFICATION_RESPONSE,
  /** Parallel task fan-out dispatch. */
  PARALLEL_DISPATCH: TraceType.PARALLEL_DISPATCH,
  /** Parallel barrier waiting for sub-agents. */
  PARALLEL_BARRIER: TraceType.PARALLEL_BARRIER,
  /** Parallel aggregation completed. */
  PARALLEL_COMPLETED: TraceType.PARALLEL_COMPLETED,
  /** Council of Agents peer review. */
  COUNCIL_REVIEW: TraceType.COUNCIL_REVIEW,
  /** Continuation task routing result back to initiator. */
  CONTINUATION: TraceType.CONTINUATION,
  /** Multi-party collaboration session initiated. */
  COLLABORATION_STARTED: TraceType.COLLABORATION_STARTED,
  /** Multi-party collaboration session closed. */
  COLLABORATION_COMPLETED: TraceType.COLLABORATION_COMPLETED,
  /** A circuit breaker activation event. */
  CIRCUIT_BREAKER: TraceType.CIRCUIT_BREAKER,

  /** Task cancellation event. */
  CANCELLATION: TraceType.CANCELLATION,
  /** Memory operation (fact/lesson storage). */
  MEMORY_OPERATION: TraceType.MEMORY_OPERATION,
  /** Agent waiting for external input. */
  AGENT_WAITING: TraceType.AGENT_WAITING,
  /** Agent resumed after waiting. */
  AGENT_RESUMED: TraceType.AGENT_RESUMED,
  /** Plan generated by Strategic Planner. */
  PLAN_GENERATED: TraceType.PLAN_GENERATED,
  /** Code written by Coder Agent. */
  CODE_WRITTEN: TraceType.CODE_WRITTEN,
  /** Review completed by Critic Agent. */
  REVIEW_COMPLETE: TraceType.REVIEW_COMPLETE,
  /** Audit completed by QA Agent. */
  AUDIT_COMPLETE: TraceType.AUDIT_COMPLETE,
  /** Parallel aggregation completed. */
  AGGREGATION_COMPLETE: TraceType.AGGREGATION_COMPLETE,
} as const;

/**
 * Status values for Traces.
 */
export const TRACE_STATUS = {
  /** Operation just started. */
  STARTED: TraceStatus.STARTED,
  /** Operation finished successfully. */
  COMPLETED: TraceStatus.COMPLETED,
  /** Operation failed with error. */
  FAILED: TraceStatus.FAILED,
  /** Operation waiting for external input or approval. */
  PAUSED: TraceStatus.PAUSED,
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
  /** Maximum token count allowed for an agent's context window. */
  MAX_CONTEXT_LENGTH: 32768,
  /** Maximum number of messages kept in active memory. */
  MAX_MESSAGES: 100,
  /** Days after which an unaddressed gap is considered stale. */
  STALE_GAP_DAYS: CONFIG_DEFAULTS.STALE_GAP_DAYS.code,
  /** Length at which large traces are truncated in memory. */
  TRACE_TRUNCATE_LENGTH: 2000,
  /** Default duration for resource acquisition locks. */
  DEFAULT_LOCK_TTL: CONFIG_DEFAULTS.RECOVERY_LOCK_TTL_SECONDS.code / 3,
  /** Constant for 730 days limit. */
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
 * Time constants.
 */
export const TIME = {
  MS_PER_SECOND: 1000,
  SECONDS_IN_MINUTE: 60,
  MS_PER_MINUTE: 60000,
  SECONDS_IN_HOUR: 3600,
  MS_PER_HOUR: 3600000,
  SECONDS_IN_DAY: 86400,
  MS_PER_DAY: 86400000,
  /** Default cadence for system-wide health checks. */
  HEALTH_CHECK_CADENCE_MS: 900000, // 15 minutes
  /** Timeout for individual health probe execution. */
  HEALTH_PROBE_TIMEOUT_MS: 10000,
} as const;

/**
 * Registry tool definitions.
 */
export const TOOLS = {
  /** Dispatches or delegates a specific task to another specialized agent persona. */
  dispatchTask: 'dispatchTask',
  /** Lists all available agent personas and their current status/capabilities. */
  listAgents: 'listAgents',
  /** Checks current system configuration or a specific configuration key. */
  checkConfig: 'checkConfig',
  /** Registers a new MCP (Model Context Protocol) server to expand agent capabilities. */
  registerMCPServer: 'registerMCPServer',
  /** Inspects a specific execution trace for debugging or auditing. */
  inspectTrace: 'inspectTrace',
  /** Executes automated tests within the current project scope. */
  runTests: 'runTests',
  /** Runs a safe, sandboxed shell command on the host environment. */
  runShellCommand: 'runShellCommand',
  /** Stages pending file changes to the git index or staging area. */
  stageChanges: 'stageChanges',
  /** Triggers an autonomous deployment of the latest verified changes. */
  triggerDeployment: 'triggerDeployment',
  /** Validates code quality, types, and logic via static analysis. */
  validateCode: 'validateCode',
  /** Triggers an automated rollback to the last known stable state. */
  triggerRollback: 'triggerRollback',
  /** Synchronizes the current workspace with the main/trunk branch. */
  triggerTrunkSync: 'triggerTrunkSync',
  /** Queries historical performance or cost statistics. */
  queryStats: 'queryStats',
  /** Discovers new skills or tools available via external MCP registries. */
  discoverSkills: 'discoverSkills',
  /** Installs a specific discovered skill into the agent's toolbox. */
  installSkill: 'installSkill',
  /** Persists a significant fact or lesson into the tiered memory engine. */
  saveMemory: 'saveMemory',
  /** Pauses execution to ask the human user for missing information. */
  seekClarification: 'seekClarification',
  /** Provides information requested by another agent in a collaboration loop. */
  provideClarification: 'provideClarification',
  /** Recalls relevant facts or lessons from long-term memory. */
  recallKnowledge: 'recallKnowledge',
  /** Sends a message to an external interface (Dashboard, Telegram, etc.). */
  sendMessage: 'sendMessage',
  /** Manages the status or lifecycle of a strategic capability gap. */
  manageGap: 'manageGap',
  /** Reports a new technical or knowledge gap discovered during execution. */
  reportGap: 'reportGap',
  /** Configures or modifies the tool linking for a specific agent persona. */
  manageAgentTools: 'manageAgentTools',
  /** Performs a system-wide health and connectivity check. */
  checkHealth: 'checkHealth',
  /** Returns a graph of the current agent-tool-resource linkages. */
  inspectTopology: 'inspectTopology',
  /** Updates a global or agent-specific configuration parameter. */
  setSystemConfig: 'setSystemConfig',
  /** Lists all hot-swappable system configuration parameters. */
  listSystemConfigs: 'listSystemConfigs',
  /** Retrieves technical metadata/risks for a specific configuration key. */
  getSystemConfigMetadata: 'getSystemConfigMetadata',
  /** Uploads a file for multi-modal agent analysis. */
  fileUpload: 'fileUpload',
  /** Deletes a previously uploaded multi-modal artifact. */
  fileDelete: 'fileDelete',
  /** Lists all artifacts currently available for multi-modal ingestion. */
  listUploadedFiles: 'listUploadedFiles',
  /** Creates a new agent persona in the registry. */
  createAgent: 'createAgent',
  /** Removes a non-backbone agent from the registry. */
  deleteAgent: 'deleteAgent',
  /** Synchronizes the agent registry and discovers topology. */
  syncAgentRegistry: 'syncAgentRegistry',
  /** Forces release of a distributed session lock. */
  forceReleaseLock: 'forceReleaseLock',
  /** Triggers a full infrastructure rebuild via CodeBuild. */
  triggerInfraRebuild: 'triggerInfraRebuild',
  /** Triggers batch evolution for multiple capability gaps. */
  triggerBatchEvolution: 'triggerBatchEvolution',
  /** Adjusts priority/urgency/impact of a memory item. */
  prioritizeMemory: 'prioritizeMemory',
  /** Deletes execution traces (single or all). */
  deleteTraces: 'deleteTraces',
  /** Discovers available peer agents in the swarm. */
  discoverPeers: 'discoverPeers',
  /** Registers a peer connection in the swarm topology. */
  registerPeer: 'registerPeer',
  /** Requests swarm consensus from multiple agents on a proposal. */
  requestConsensus: 'requestConsensus',
  /** Creates a new workspace for multi-human multi-agent collaboration. */
  createWorkspace: 'createWorkspace',
  /** Invites a member to a workspace. */
  inviteMember: 'inviteMember',
  /** Updates a member's role within a workspace. */
  updateMemberRole: 'updateMemberRole',
  /** Removes a member from a workspace. */
  removeMember: 'removeMember',
  /** Retrieves workspace details including members. */
  getWorkspace: 'getWorkspace',
  /** Lists all workspace IDs. */
  listWorkspaces: 'listWorkspaces',
  /** Creates a new collaboration session. */
  createCollaboration: 'createCollaboration',
  /** Joins an existing collaboration. */
  joinCollaboration: 'joinCollaboration',
  /** Gets the shared session context for a collaboration. */
  getCollaborationContext: 'getCollaborationContext',
  /** Writes a message to the shared collaboration session. */
  writeToCollaboration: 'writeToCollaboration',
  /** Closes a collaboration session. */
  closeCollaboration: 'closeCollaboration',
  /** Lists collaborations for the current agent. */
  listMyCollaborations: 'listMyCollaborations',
} as const;

/**
 * OpenAI-specific configuration and role mapping.
 */
export const OPENAI = {
  /** Standard message roles for the OpenAI Chat/Responses API. */
  ROLES: {
    USER: 'user',
    ASSISTANT: 'assistant',
    DEVELOPER: 'developer',
  },
  /** Item types for the structured Responses context. */
  ITEM_TYPES: {
    MESSAGE: 'message',
    FUNCTION_CALL: 'function_call',
    FUNCTION_CALL_OUTPUT: 'function_call_output',
  },
  /** Content block types for multi-modal ingestion. */
  CONTENT_TYPES: {
    INPUT_TEXT: 'input_text',
    INPUT_FILE: 'input_file',
    IMAGE_URL: 'image_url',
  },
  /** Default filename for file-based model inputs. */
  DEFAULT_FILE_NAME: 'document.pdf',
  /** MIME type for generic file ingestion. */
  DEFAULT_MIME_TYPE: 'application/octet-stream',
  /** Identifier for standard function-call tools. */
  FUNCTION_TYPE: 'function',
  /** Identifier for MCP-server-based tools. */
  MCP_TYPE: 'mcp',
} as const;

/**
 * Security-protected files that should not be modified by agents.
 */
export const PROTECTED_FILES = [
  '.git',
  '.env',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'node_modules',
];

/**
 * Storage configuration and limits.
 */
export const STORAGE = {
  /** Maximum size for individual file uploads via agents. */
  MAX_FILE_SIZE_MB: 10,
  /** Supported file extensions for agent ingestion. */
  ALLOWED_EXTENSIONS: ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.yml', '.yaml'],
  /** Temporary path for preparing deployment bundles. */
  TMP_STAGING_ZIP: '/tmp/staging.zip',
  /** Key for the deployment artifact in S3. */
  STAGING_ZIP: 'staging.zip',
} as const;

/**
 * Common Error Messages.
 */
export const AGENT_ERRORS = {
  PROCESS_FAILURE:
    "I encountered an internal error during my cognitive processing cycle and was unable to fulfill your request. This has been logged as a strategic gap for my system's next evolution cycle, and my engineering team will review it. Please try again or rephrase your query.",
  CONNECTION_FAILURE:
    'SYSTEM_ERROR: Connection interrupted or internal failure. Technical details logged as strategic gap.',
} as const;
