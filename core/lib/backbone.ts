import {
  AgentType,
  IAgentConfig,
  AgentCategory,
  ConnectionProfile,
  ReasoningProfile,
} from './types/index';
import { TOOLS } from './constants';
import {
  SUPERCLAW_SYSTEM_PROMPT,
  CODER_SYSTEM_PROMPT,
  PLANNER_SYSTEM_PROMPT,
  REFLECTOR_SYSTEM_PROMPT,
  QA_SYSTEM_PROMPT,
} from '../agents/prompts/index';

const TOOL_DISCOVER_SKILLS = TOOLS.discoverSkills;
const TOOL_INSTALL_SKILL = TOOLS.installSkill;
const TOOL_SAVE_MEMORY = TOOLS.saveMemory;
const TOOL_SEEK_CLARIFICATION = TOOLS.seekClarification;
const TOOL_PROVIDE_CLARIFICATION = TOOLS.provideClarification;
const TOOL_RECALL_KNOWLEDGE = TOOLS.recallKnowledge;
const TOOL_SEND_MESSAGE = TOOLS.sendMessage;
const TOOL_MANAGE_GAP = TOOLS.manageGap;
const TOOL_REPORT_GAP = TOOLS.reportGap;
const TOOL_CHECK_HEALTH = TOOLS.checkHealth;
const TOOL_INSPECT_TOPOLOGY = TOOLS.inspectTopology;
const TOOL_LIST_AGENTS = TOOLS.listAgents;
/**
 * Backbone Registry: The single source of truth for essential system components.
 * Reserved for LLM-based Agents and logic-based Handlers.
 * All tools assigned to agents follow camelCase naming conventions.
 */
export const BACKBONE_REGISTRY: Record<string, IAgentConfig> = {
  [AgentType.SUPERCLAW]: {
    id: AgentType.SUPERCLAW,
    name: 'SuperClaw',
    systemPrompt: SUPERCLAW_SYSTEM_PROMPT,
    description: 'Orchestrator node. Directs traffic, retrieves memory, and delegates tasks.',
    category: AgentCategory.SYSTEM,
    icon: 'Bot',
    enabled: true,
    isBackbone: true,
    provider: 'openrouter',
    model: 'minimax/minimax-m2.7',
    reasoningProfile: ReasoningProfile.STANDARD,
    defaultCommunicationMode: 'text',
    tools: [
      TOOLS.dispatchTask,

      TOOL_LIST_AGENTS,
      TOOL_RECALL_KNOWLEDGE,

      TOOLS.checkConfig,
      TOOL_DISCOVER_SKILLS,
      TOOL_INSTALL_SKILL,

      TOOLS.registerMCPServer,
      TOOL_MANAGE_GAP,
      TOOL_REPORT_GAP,
      TOOL_SAVE_MEMORY,
      TOOL_PROVIDE_CLARIFICATION,
      TOOL_INSPECT_TOPOLOGY,
      'aws-s3_read_file',
      'aws-s3_list_objects',
    ],
    connectionProfile: [
      ConnectionProfile.BUS,
      ConnectionProfile.MEMORY,
      ConnectionProfile.CONFIG,
      ConnectionProfile.TRACE,
      ConnectionProfile.KNOWLEDGE,
    ],
  },
  [AgentType.CODER]: {
    id: AgentType.CODER,
    name: 'Coder Agent',
    systemPrompt: CODER_SYSTEM_PROMPT,
    description: 'Autonomous builder. Implements changes and validates via pre-flight checks.',
    category: AgentCategory.SYSTEM,
    icon: 'Code',
    enabled: true,
    isBackbone: true,
    defaultCommunicationMode: 'json',
    tools: [
      TOOLS.runTests,

      TOOLS.runShellCommand,

      TOOLS.stageChanges,

      TOOLS.triggerDeployment,

      TOOLS.validateCode,
      TOOL_CHECK_HEALTH,

      TOOLS.inspectTrace,
      'aws-s3_read_file',
      'aws-s3_write_file',
      'aws-s3_list_objects',
      'filesystem_read_file',
      'filesystem_write_file',
      'filesystem_list_directory',
      'filesystem_search_files',
      'git_status',
      'git_diff',
      'grep_search',
      'google-search_search',
      'puppeteer_navigate',
      'puppeteer_screenshot',
      'puppeteer_click',
      'fetch_get',
      'aws_list_resources',
      'aws_get_resource',
      TOOL_SEND_MESSAGE,
      TOOL_DISCOVER_SKILLS,
      TOOL_INSTALL_SKILL,
      TOOL_SAVE_MEMORY,
      TOOL_SEEK_CLARIFICATION,
      TOOL_INSPECT_TOPOLOGY,
    ],
    maxIterations: 50,
    provider: 'openrouter',
    model: 'minimax/minimax-m2.7',
    reasoningProfile: ReasoningProfile.DEEP,
    connectionProfile: [
      ConnectionProfile.BUS,
      ConnectionProfile.MEMORY,
      ConnectionProfile.STORAGE,
      ConnectionProfile.CODEBUILD,
      ConnectionProfile.CONFIG,
      ConnectionProfile.TRACE,
      ConnectionProfile.KNOWLEDGE,
    ],
  },
  [AgentType.STRATEGIC_PLANNER]: {
    id: AgentType.STRATEGIC_PLANNER,
    name: 'Strategic Planner',
    systemPrompt: PLANNER_SYSTEM_PROMPT,
    description: 'Design node. Identifies missing features and architecting upgrades.',
    category: AgentCategory.SYSTEM,
    icon: 'Brain',
    enabled: true,
    isBackbone: true,
    provider: 'openrouter',
    model: 'minimax/minimax-m2.7',
    reasoningProfile: ReasoningProfile.DEEP,
    defaultCommunicationMode: 'json',
    tools: [
      TOOL_RECALL_KNOWLEDGE,
      TOOLS.dispatchTask,
      TOOL_MANAGE_GAP,
      TOOL_REPORT_GAP,
      TOOL_SEND_MESSAGE,
      TOOLS.listAgents,
      TOOLS.manageAgentTools,
      TOOL_DISCOVER_SKILLS,
      TOOL_INSTALL_SKILL,
      TOOL_SAVE_MEMORY,
      TOOL_SEEK_CLARIFICATION,
      TOOL_PROVIDE_CLARIFICATION,
      TOOL_INSPECT_TOPOLOGY,
    ],
    connectionProfile: [
      ConnectionProfile.BUS,
      ConnectionProfile.MEMORY,
      ConnectionProfile.CONFIG,
      ConnectionProfile.TRACE,
      ConnectionProfile.KNOWLEDGE,
    ],
  },
  [AgentType.COGNITION_REFLECTOR]: {
    id: AgentType.COGNITION_REFLECTOR,
    name: 'Cognition Reflector',
    systemPrompt: REFLECTOR_SYSTEM_PROMPT,
    description: 'Intelligence audit node. Extracts facts, lessons, and gaps from logs.',
    category: AgentCategory.SYSTEM,
    icon: 'Search',
    enabled: true,
    isBackbone: true,
    provider: 'openrouter',
    model: 'minimax/minimax-m2.7',
    reasoningProfile: ReasoningProfile.STANDARD,
    defaultCommunicationMode: 'json',
    tools: [
      TOOL_RECALL_KNOWLEDGE,
      TOOL_MANAGE_GAP,
      TOOL_REPORT_GAP,
      TOOL_SEND_MESSAGE,
      TOOL_DISCOVER_SKILLS,
      TOOL_INSTALL_SKILL,
      TOOL_SAVE_MEMORY,
      TOOL_SEEK_CLARIFICATION,
    ],
    connectionProfile: [
      ConnectionProfile.BUS,
      ConnectionProfile.MEMORY,
      ConnectionProfile.CONFIG,
      ConnectionProfile.TRACE,
      ConnectionProfile.KNOWLEDGE,
    ],
  },
  [AgentType.QA]: {
    id: AgentType.QA,
    name: 'QA Auditor',
    systemPrompt: QA_SYSTEM_PROMPT,
    description: 'Validation node. Audits deployments to ensure they actually solve the gaps.',
    category: AgentCategory.SYSTEM,
    icon: 'FlaskConical',
    enabled: true,
    isBackbone: true,
    provider: 'openrouter',
    model: 'minimax/minimax-m2.7',
    reasoningProfile: ReasoningProfile.STANDARD,
    defaultCommunicationMode: 'json',
    tools: [
      TOOL_RECALL_KNOWLEDGE,
      TOOL_CHECK_HEALTH,
      TOOL_SEND_MESSAGE,
      TOOL_DISCOVER_SKILLS,
      TOOL_INSTALL_SKILL,
      TOOL_SAVE_MEMORY,
      TOOL_SEEK_CLARIFICATION,
    ],
    connectionProfile: [
      ConnectionProfile.BUS,
      ConnectionProfile.MEMORY,
      ConnectionProfile.CONFIG,
      ConnectionProfile.TRACE,
      ConnectionProfile.KNOWLEDGE,
    ],
  },
  // Handlers (Logic-only, but registered for topology awareness)
  [AgentType.BUILD_MONITOR]: {
    id: AgentType.BUILD_MONITOR,
    name: 'Build Monitor',
    systemPrompt: 'LOGIC_ONLY',
    description: 'Observability node. Watches builds, updates gaps, and discovers infra.',
    category: AgentCategory.SYSTEM,
    icon: 'Activity',
    enabled: true,
    isBackbone: true,
    connectionProfile: [
      ConnectionProfile.BUS,
      ConnectionProfile.CONFIG,
      ConnectionProfile.CODEBUILD,
      ConnectionProfile.MEMORY,
    ],
  },
  [AgentType.RECOVERY]: {
    id: AgentType.RECOVERY,
    name: "Dead Man's Switch",
    systemPrompt: 'LOGIC_ONLY',
    description: 'Resilience node. Performs health probes and emergency git-reverts.',
    category: AgentCategory.SYSTEM,
    icon: 'ShieldCheck',
    enabled: true,
    isBackbone: true,
    connectionProfile: [ConnectionProfile.DEPLOYER, 'memoryTable'],
  },
};
