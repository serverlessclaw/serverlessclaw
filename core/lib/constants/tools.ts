export { PROTECTED_FILES } from './safety';

/**
 * Registry tool definitions.
 */
export const TOOLS = {
  dispatchTask: 'dispatchTask',
  listAgents: 'listAgents',
  checkConfig: 'checkConfig',
  getMcpConfig: 'getMcpConfig',
  registerMCPServer: 'registerMCPServer',
  inspectTrace: 'inspectTrace',
  runTests: 'runTests',
  runShellCommand: 'runShellCommand',
  stageChanges: 'stageChanges',
  generatePatch: 'generatePatch',
  triggerDeployment: 'triggerDeployment',
  validateCode: 'validateCode',
  verifyChanges: 'verifyChanges',
  triggerRollback: 'triggerRollback',
  triggerTrunkSync: 'triggerTrunkSync',
  discoverSkills: 'discoverSkills',
  installSkill: 'installSkill',
  uninstallSkill: 'uninstallSkill',
  saveMemory: 'saveMemory',
  seekClarification: 'seekClarification',
  provideClarification: 'provideClarification',
  recallKnowledge: 'recallKnowledge',
  sendMessage: 'sendMessage',
  getMessages: 'getMessages',
  broadcastMessage: 'broadcastMessage',
  manageGap: 'manageGap',
  reportGap: 'reportGap',
  manageAgentTools: 'manageAgentTools',
  checkHealth: 'checkHealth',
  runCognitiveHealthCheck: 'runCognitiveHealthCheck',
  inspectTopology: 'inspectTopology',
  setSystemConfig: 'setSystemConfig',
  listSystemConfigs: 'listSystemConfigs',
  getSystemConfigMetadata: 'getSystemConfigMetadata',
  createAgent: 'createAgent',
  deleteAgent: 'deleteAgent',
  syncAgentRegistry: 'syncAgentRegistry',
  forceReleaseLock: 'forceReleaseLock',
  triggerInfraRebuild: 'triggerInfraRebuild',
  triggerBatchEvolution: 'triggerBatchEvolution',
  prioritizeMemory: 'prioritizeMemory',
  deleteTraces: 'deleteTraces',
  discoverPeers: 'discoverPeers',
  registerPeer: 'registerPeer',
  requestConsensus: 'requestConsensus',
  createWorkspace: 'createWorkspace',
  inviteMember: 'inviteMember',
  updateMemberRole: 'updateMemberRole',
  removeMember: 'removeMember',
  getWorkspace: 'getWorkspace',
  listWorkspaces: 'listWorkspaces',
  createCollaboration: 'createCollaboration',
  joinCollaboration: 'joinCollaboration',
  getCollaborationContext: 'getCollaborationContext',
  writeToCollaboration: 'writeToCollaboration',
  closeCollaboration: 'closeCollaboration',
  listMyCollaborations: 'listMyCollaborations',
  debugAgent: 'debugAgent',
  switchModel: 'switchModel',
  cancelGoal: 'cancelGoal',
  listSchedules: 'listSchedules',
  signalOrchestration: 'signalOrchestration',
  voteOnProposal: 'voteOnProposal',
  rollbackDeployment: 'rollbackDeployment',
  checkReputation: 'checkReputation',
  requestResearch: 'requestResearch',
  technicalResearch: 'technicalResearch',
  renderComponent: 'renderComponent',
  navigateTo: 'navigateTo',
  uiAction: 'uiAction',
  proposeAutonomyUpdate: 'proposeAutonomyUpdate',
  scanMetabolism: 'scanMetabolism',
  pulseCheck: 'pulseCheck',
  promoteCapability: 'promoteCapability',
} as const;

/**
 * Standard tool groups for common agent profiles.
 * Consolidates literal strings into reusable arrays to prevent backbone duplication.
 */
export const DEVELOPER_TOOLS = [
  'filesystem_read_file',
  'filesystem_write_file',
  'filesystem_list_directory',
  'filesystem_search_files',
  'git_status',
  'git_diff',
  'grep_search',
  'ast_search_code',
  'ast_get_file_structure',
  'aws_list_resources',
  'aws_get_resource',
];

export const AWS_TOOLS = ['aws-s3_read_file', 'aws-s3_write_file', 'aws-s3_list_objects'];

export const WEB_TOOLS = [
  'google-search_search',
  'fetch_get',
  'puppeteer_navigate',
  'puppeteer_screenshot',
  'puppeteer_click',
  'playwright_navigate',
  'playwright_screenshot',
  'playwright_click',
];

/**
 * Universal system tools provided to all backbone agents.
 */
export const UNIVERSAL_SYSTEM_TOOLS = [
  TOOLS.saveMemory,
  TOOLS.recallKnowledge,
  TOOLS.sendMessage,
  TOOLS.discoverSkills,
  TOOLS.installSkill,
  TOOLS.seekClarification,
  TOOLS.provideClarification,
  TOOLS.pulseCheck,
];

/**
 * OpenAI-specific configuration and role mapping.
 */
export const OPENAI = {
  ROLES: {
    USER: 'user',
    ASSISTANT: 'assistant',
    DEVELOPER: 'developer',
  },
  ITEM_TYPES: {
    MESSAGE: 'message',
    FUNCTION_CALL: 'function_call',
    FUNCTION_CALL_OUTPUT: 'function_call_output',
  },
  CONTENT_TYPES: {
    INPUT_TEXT: 'input_text',
    INPUT_FILE: 'input_file',
    IMAGE_URL: 'image_url',
  },
  DEFAULT_FILE_NAME: 'document.pdf',
  DEFAULT_MIME_TYPE: 'application/octet-stream',
  FUNCTION_TYPE: 'function',
  MCP_TYPE: 'mcp',
} as const;

/**
 * Storage configuration and limits.
 */
export const STORAGE = {
  MAX_FILE_SIZE_MB: 10,
  ALLOWED_EXTENSIONS: ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.yml', '.yaml'],
  TMP_STAGING_ZIP: '/tmp/staging.zip',
  STAGING_ZIP: 'staged_changes.zip',
  WORKSPACE_BASE: '/tmp/workspace',
  MERGE_BASE: '/tmp/merge',
} as const;

/**
 * MCP (Model Context Protocol) configuration.
 */
export const MCP = {
  DEFAULT_CACHE_TTL_MS: 900000, // 15 minutes
  FAILURE_BACKOFF_MS: 30000, // 30 seconds
  DEFAULT_CONNECT_TIMEOUT_MS: 15000, // 15 seconds
  HUB_CONNECT_TIMEOUT_MS: 5000, // 5 seconds
  CONNECTION_TTL_MS: 900000, // 15 minutes
  TOOL_EXECUTION_TIMEOUT_MS: 120000, // 2 minutes
  LOCK_ACQUIRE_TIMEOUT_MS: 60000, // 60 seconds
  LOCK_ACQUIRE_RETRIES: 3,
} as const;
