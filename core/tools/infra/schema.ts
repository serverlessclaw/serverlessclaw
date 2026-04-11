import { z } from 'zod';
import { IToolDefinition, ToolType } from '../../lib/types/index';
import { AgentStatus, AgentType } from '../../lib/types/agent';

/**
 * Infra Domain Tool Definitions
 */

export const infraSchema: Record<string, IToolDefinition> = {
  // Deployment (from deployment.ts)
  stageChanges: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    name: 'stageChanges',
    description:
      'Compresses modified files into a ZIP and uploads to a unique S3 staging path for CodeBuild. Returns the staging key.',
    parameters: {
      type: 'object',
      properties: {
        modifiedFiles: { type: 'array', items: { type: 'string' } },
        sessionId: { type: 'string' },
        skipValidation: { type: 'boolean' },
      },
      required: ['modifiedFiles', 'sessionId', 'skipValidation'],
      additionalProperties: false,
    },
    connectionProfile: ['storage'],
    requiresApproval: false,
    requiredPermissions: [],
  },
  generatePatch: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    name: 'generatePatch',
    description:
      'Generates a git diff patch of all uncommitted changes. Use this instead of stageChanges when working in parallel with other agents to avoid S3 staging conflicts.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        skipValidation: { type: 'boolean' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
    connectionProfile: ['storage'],
    requiresApproval: false,
    requiredPermissions: [],
  },
  triggerDeployment: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    name: 'triggerDeployment',
    description: 'Triggers an autonomous self-deployment of the agent infrastructure.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
        gapIds: { type: 'array', items: { type: 'string' } },
        stagingKey: {
          type: 'string',
          description: 'Optional: Specific staging ZIP key returned by stageChanges.',
        },
      },
      required: ['reason', 'gapIds'],
      additionalProperties: false,
    },
    connectionProfile: ['codebuild'],
    requiresApproval: true,
    requiredPermissions: ['admin'],
  },
  triggerInfraRebuild: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    name: 'triggerInfraRebuild',
    description: 'Triggers a full infrastructure rebuild via CodeBuild.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
      },
      required: ['reason'],
      additionalProperties: false,
    },
    requiresApproval: true,
    connectionProfile: ['codebuild'],
    requiredPermissions: [],
  },

  // Rollback (from rollback.ts)
  triggerRollback: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    name: 'triggerRollback',
    description: 'Trigger an emergency rollback by reverting the last commit and redeploying.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
      },
      required: ['reason'],
      additionalProperties: false,
    },
    connectionProfile: ['codebuild'],
    requiresApproval: true,
    requiredPermissions: ['admin'],
  },

  // Scheduler (from scheduler.ts)
  scheduleGoal: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    name: 'scheduleGoal',
    description: 'Proactively schedules a future task or recurring "wake-up" heartbeat.',
    parameters: {
      type: 'object',
      properties: {
        goalId: { type: 'string' },
        task: { type: 'string' },
        agentId: { type: 'string' },
        scheduleExpression: { type: 'string' },
        metadata: { type: 'object' },
      },
      required: ['goalId', 'task', 'scheduleExpression', 'agentId', 'metadata'],
      additionalProperties: false,
    },
    connectionProfile: ['scheduler'],
    requiresApproval: true,
    requiredPermissions: ['admin'],
  },
  cancelGoal: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    name: 'cancelGoal',
    description: 'Cancels and removes a previously scheduled proactive goal.',
    parameters: {
      type: 'object',
      properties: {
        goalId: { type: 'string' },
      },
      required: ['goalId'],
      additionalProperties: false,
    },
    connectionProfile: ['scheduler'],
    requiresApproval: false,
    requiredPermissions: [],
  },
  listGoals: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    name: 'listGoals',
    description: 'Lists all currently active proactive goals and scheduled heartbeats.',
    parameters: {
      type: 'object',
      properties: {
        namePrefix: { type: 'string' },
      },
      required: ['namePrefix'],
      additionalProperties: false,
    },
    connectionProfile: ['scheduler'],
    requiresApproval: false,
    requiredPermissions: [],
  },

  // Orchestration (from orchestration.ts)
  triggerBatchEvolution: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    name: 'triggerBatchEvolution',
    description: 'Triggers evolution for multiple capability gaps at once.',
    parameters: {
      type: 'object',
      properties: {
        gapIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['gapIds'],
      additionalProperties: false,
    },
    connectionProfile: ['bus'],
    requiresApproval: false,
    requiredPermissions: [],
  },
  signalOrchestration: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    connectionProfile: [],
    connector_id: '',
    auth: { type: 'api_key', resource_id: '' },
    requiresApproval: false,
    requiredPermissions: [],
    name: 'signalOrchestration',
    description:
      'Emits a high-level orchestration signal to decide the next step in a task lifecycle.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: [
            AgentStatus.SUCCESS,
            AgentStatus.FAILED,
            AgentStatus.RETRY,
            AgentStatus.PIVOT,
            AgentStatus.ESCALATE,
          ],
        },
        reasoning: { type: 'string' },
        nextStep: { type: 'string' },
        targetAgentId: { type: 'string', enum: Object.values(AgentType) },
        emit: {
          type: 'boolean',
          description: 'Whether to emit this signal to the EventBus for automated transition.',
        },
      },
      required: ['status', 'reasoning', 'nextStep', 'targetAgentId'],
      additionalProperties: false,
    },
  },
  requestConsensus: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    name: 'requestConsensus',
    description: 'Requests swarm consensus from multiple agents on a proposal.',
    parameters: {
      type: 'object',
      properties: {
        proposal: { type: 'string' },
        voterIds: { type: 'array', items: { type: 'string' } },
        mode: { type: 'string', enum: ['majority', 'unanimous', 'weighted'] },
        timeoutMs: { type: 'number' },
      },
      required: ['proposal', 'voterIds'],
      additionalProperties: false,
    },
    connectionProfile: ['bus'],
    requiresApproval: false,
    requiredPermissions: [],
  },
  voteOnProposal: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    name: 'voteOnProposal',
    description: 'Submits a vote on an active consensus proposal.',
    parameters: {
      type: 'object',
      properties: {
        proposalId: { type: 'string' },
        vote: { type: 'string', enum: ['approve', 'reject', 'abstain'] },
        reason: { type: 'string' },
      },
      required: ['proposalId', 'vote', 'reason'],
      additionalProperties: false,
    },
    connectionProfile: ['bus'],
    requiresApproval: false,
    requiredPermissions: [],
  },

  // Topology (from system.ts / topology-discovery.ts)
  inspectTopology: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    name: 'inspectTopology',
    description:
      'Returns a structured map of the entire system (agents, infrastructure, and connections).',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    connectionProfile: ['config'],
    requiresApproval: false,
    requiredPermissions: [],
  },
  discoverPeers: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    name: 'discoverPeers',
    description: 'Discovers available peer agents in the swarm for dynamic topology construction.',
    parameters: {
      type: 'object',
      properties: {
        capability: { type: 'string' },
        category: { type: 'string' },
        topologyType: { type: 'string', enum: ['mesh', 'hierarchy', 'pipeline'] },
      },
      required: [],
      additionalProperties: false,
    },
    connectionProfile: ['config'],
    requiresApproval: false,
    requiredPermissions: [],
  },
  registerPeer: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    name: 'registerPeer',
    description: 'Registers a peer connection in the swarm topology.',
    parameters: {
      type: 'object',
      properties: {
        sourceAgentId: { type: 'string' },
        targetAgentId: { type: 'string' },
        topologyType: { type: 'string', enum: ['mesh', 'hierarchy', 'pipeline'] },
        label: { type: 'string' },
      },
      required: ['sourceAgentId', 'targetAgentId', 'topologyType'],
      additionalProperties: false,
    },
    connectionProfile: ['config'],
    requiresApproval: false,
    requiredPermissions: [],
  },
};
