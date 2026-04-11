import { ITool, ToolResult } from '../../lib/types/index';
import { proposeAutonomyUpdate as proposeLogic } from '../../lib/agent/tools/governance';
import { ScytheLogic } from '../../agents/cognition-reflector/lib/scythe';
import { getAgentContext } from '../../lib/utils/agent-helpers';
import { systemSchema as schema } from './schema';

/**
 * Tool for SuperClaw to propose autonomy level updates (AUTO vs HITL).
 */
export const proposeAutonomyUpdate: ITool = {
  ...schema.proposeAutonomyUpdate,
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const result = await proposeLogic(args as Parameters<typeof proposeLogic>[0]);
    return {
      text: result,
      images: [],
      metadata: {},
      ui_blocks: [],
    };
  },
};

/**
 * Tool for Cognition Reflector to scan for system bloat and technical debt.
 */
export const scanScythe: ITool = {
  ...schema.scanScythe,
  execute: async (_args: Record<string, unknown>): Promise<ToolResult> => {
    const { memory } = await getAgentContext();

    // 1. Update history
    await ScytheLogic.updateToolHistory(memory);

    // 2. Generate proposal
    const proposal = await ScytheLogic.generatePruneProposal();

    if (!proposal) {
      return {
        text: 'Scythe scan complete. No significant bloat detected at this time.',
        images: [],
        metadata: { status: 'lean' },
        ui_blocks: [],
      };
    }

    // 3. Record proposal
    await ScytheLogic.recordPruneProposal(proposal, memory);

    const swarmIssues = proposal.swarm.unusedTools.length + proposal.swarm.zombieAgents.length;
    const codeIssues =
      proposal.codebase.emptyDirs.length + (proposal.codebase.debtMarkers > 0 ? 1 : 0);

    return {
      text: `Scythe scan identified ${swarmIssues} swarm-level issues and ${codeIssues} codebase-level issues. A prune proposal has been recorded for review.`,
      images: [],
      metadata: {
        swarm: proposal.swarm,
        codebase: proposal.codebase,
        thresholdDays: proposal.thresholdDays,
      },
      ui_blocks: [],
    };
  },
};
