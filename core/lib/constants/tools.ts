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
} as const;

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
 * Security-protected files that should not be modified by agents.
 */
export const PROTECTED_FILES = [
  '.git/**',
  '.env*',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'node_modules/**',
  'sst.config.ts',
  'core/tools/index.ts',
  'core/agents/superclaw.ts',
  'core/lib/agent.ts',
  'core/lib/registry/AgentRegistry.ts',
  'core/lib/routing/AgentRouter.ts',
  'buildspec.yml',
  'infra/**',
  // Critical recovery and safety handlers
  'core/handlers/recovery.ts',
  'core/lib/safety/circuit-breaker.ts',
  'core/lib/safety/safety-engine.ts',
  'core/lib/lock/lock-manager.ts',
  // Core system handlers
  'core/handlers/events/index.ts',
];

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
