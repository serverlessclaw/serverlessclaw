/**
 * Registry tool definitions.
 */
export const TOOLS = {
  dispatchTask: 'dispatchTask',
  listAgents: 'listAgents',
  checkConfig: 'checkConfig',
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
  queryStats: 'queryStats',
  discoverSkills: 'discoverSkills',
  installSkill: 'installSkill',
  saveMemory: 'saveMemory',
  seekClarification: 'seekClarification',
  provideClarification: 'provideClarification',
  recallKnowledge: 'recallKnowledge',
  sendMessage: 'sendMessage',
  manageGap: 'manageGap',
  reportGap: 'reportGap',
  manageAgentTools: 'manageAgentTools',
  checkHealth: 'checkHealth',
  runCognitiveHealthCheck: 'runCognitiveHealthCheck',
  inspectTopology: 'inspectTopology',
  setSystemConfig: 'setSystemConfig',
  listSystemConfigs: 'listSystemConfigs',
  getSystemConfigMetadata: 'getSystemConfigMetadata',
  fileUpload: 'fileUpload',
  fileDelete: 'fileDelete',
  listUploadedFiles: 'listUploadedFiles',
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
  unregisterPeer: 'unregisterPeer',
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
} as const;

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
  MAX_FILE_SIZE_MB: 10,
  ALLOWED_EXTENSIONS: ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.yml', '.yaml'],
  TMP_STAGING_ZIP: '/tmp/staging.zip',
  STAGING_ZIP: 'staged_changes.zip',
  WORKSPACE_BASE: '/tmp/workspace',
  MERGE_BASE: '/tmp/merge',
} as const;
