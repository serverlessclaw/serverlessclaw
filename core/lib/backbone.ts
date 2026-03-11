import { AgentType, IAgentConfig } from './types/agent';
import { SUPERCLAW_SYSTEM_PROMPT } from '../agents/superclaw';
import { CODER_SYSTEM_PROMPT } from '../agents/coder';
import { PLANNER_SYSTEM_PROMPT } from '../agents/strategic-planner';
import { REFLECTOR_SYSTEM_PROMPT } from '../agents/cognition-reflector';
import { QA_SYSTEM_PROMPT } from '../agents/qa';

/**
 * Backbone Registry: The single source of truth for essential system components.
 * Reserved for LLM-based Agents and logic-based Handlers.
 */
export const BACKBONE_REGISTRY: Record<string, IAgentConfig> = {
  [AgentType.MAIN]: {
    id: AgentType.MAIN,
    name: 'SuperClaw',
    systemPrompt: SUPERCLAW_SYSTEM_PROMPT,
    description: 'Orchestrator node. Directs traffic, retrieves memory, and delegates tasks.',
    icon: 'Bot',
    enabled: true,
    isBackbone: true,
    tools: [
      'dispatch_task',
      'list_agents',
      'recall_knowledge',
      'switch_model',
      'check_health',
      'manage_gap',
      'trigger_rollback',
    ],
    connectionProfile: ['bus', 'memory', 'config', 'trace'],
  },
  [AgentType.CODER]: {
    id: AgentType.CODER,
    name: 'Coder Agent',
    systemPrompt: CODER_SYSTEM_PROMPT,
    description: 'Autonomous builder. Implements changes and validates via pre-flight checks.',
    icon: 'Code',
    enabled: true,
    isBackbone: true,
    tools: [
      'file_write',
      'file_read',
      'validate_code',
      'stage_changes',
      'trigger_deployment',
      'run_tests',
      'run_shell_command',
    ],
    maxIterations: 50,
    connectionProfile: ['bus', 'memory', 'storage', 'codebuild', 'config', 'trace'],
  },
  [AgentType.STRATEGIC_PLANNER]: {
    id: AgentType.STRATEGIC_PLANNER,
    name: 'Strategic Planner',
    systemPrompt: PLANNER_SYSTEM_PROMPT,
    description: 'Design node. Identifies missing features and architecting upgrades.',
    icon: 'Brain',
    enabled: true,
    isBackbone: true,
    tools: ['recall_knowledge', 'manage_gap', 'dispatch_task', 'file_read', 'list_files'],
    connectionProfile: ['bus', 'memory', 'config', 'trace'],
  },
  [AgentType.COGNITION_REFLECTOR]: {
    id: AgentType.COGNITION_REFLECTOR,
    name: 'Cognition Reflector',
    systemPrompt: REFLECTOR_SYSTEM_PROMPT,
    description: 'Intelligence audit node. Extracts facts, lessons, and gaps from logs.',
    icon: 'Search',
    enabled: true,
    isBackbone: true,
    tools: ['recall_knowledge', 'manage_gap'],
    connectionProfile: ['bus', 'memory', 'config', 'trace'],
  },
  [AgentType.QA]: {
    id: AgentType.QA,
    name: 'QA Auditor',
    systemPrompt: QA_SYSTEM_PROMPT,
    description: 'Validation node. Audits deployments to ensure they actually solve the gaps.',
    icon: 'FlaskConical',
    enabled: true,
    isBackbone: true,
    tools: ['recall_knowledge', 'check_health', 'file_read', 'list_files'],
    connectionProfile: ['bus', 'memory', 'config', 'trace'],
  },
  // Handlers (Logic-only, but registered for topology awareness)
  [AgentType.BUILD_MONITOR]: {
    id: AgentType.BUILD_MONITOR,
    name: 'Build Monitor',
    systemPrompt: 'LOGIC_ONLY',
    description: 'Observability node. Watches builds, updates gaps, and discovers infra.',
    icon: 'Activity',
    enabled: true,
    isBackbone: true,
    connectionProfile: ['bus', 'config', 'codebuild', 'memory'],
  },
  [AgentType.RECOVERY]: {
    id: AgentType.RECOVERY,
    name: "Dead Man's Switch",
    systemPrompt: 'LOGIC_ONLY',
    description: 'Resilience node. Performs health probes and emergency git-reverts.',
    icon: 'ShieldCheck',
    enabled: true,
    isBackbone: true,
    connectionProfile: ['deployer', 'memoryTable'],
  },
};
