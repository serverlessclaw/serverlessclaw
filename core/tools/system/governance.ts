import { ITool, ToolResult } from '../../lib/types/index';
import { proposeAutonomyUpdate as proposeLogic } from '../../lib/agent/tools/governance';
import { MCPMultiplexer } from '../../lib/mcp';
import { systemSchema as schema } from './schema';
import { logger } from '../../lib/logger';

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
 * Offloaded to AIReady (AST) MCP suite.
 */
export const scanMetabolism: ITool = {
  ...schema.scanMetabolism,
  execute: async (_args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      // 1. Discover Metabolism-related tools from the AIReady (AST) MCP suite
      const astTools = await MCPMultiplexer.getToolsFromServer('ast', '');
      const auditTool = astTools.find(
        (t: { name: string }) =>
          t.name === 'metabolism_audit' ||
          t.name === 'codebase_audit' ||
          t.name.includes('metabolism')
      );

      if (!auditTool) {
        return {
          text: 'Metabolism scan failed: No specialized audit tool found in AIReady (AST) MCP suite.',
          images: [],
          metadata: { status: 'error', reason: 'tool_not_found' },
          ui_blocks: [],
        };
      }

      // 2. Execute the audit via MCP
      const result = await auditTool.execute({
        path: './core',
        includeTelemetry: true,
        depth: 'full',
      });

      // 3. Map Results
      if (result && typeof result === 'object') {
        const data = ('metadata' in result ? (result.metadata as any) : result) as any;
        const swarmIssues = (data.findings || []).filter((f: any) =>
          f.actual?.includes('Swarm')
        ).length;
        const codeIssues = data.debtMarkers || 0;

        return {
          text: `Metabolism scan identified ${swarmIssues} swarm-level issues and ${codeIssues} codebase-level debt markers. A prune proposal has been recorded in the AIReady suite.`,
          images: [],
          metadata: {
            findings: data.findings || [],
            debtMarkers: data.debtMarkers,
          },
          ui_blocks: [],
        };
      }

      return {
        text: 'Metabolism scan complete. No significant bloat detected by AIReady suite.',
        images: [],
        metadata: { status: 'lean' },
        ui_blocks: [],
      };
    } catch (e) {
      logger.error('[Tool] scanMetabolism failed:', e);
      return {
        text: `Metabolism scan failed: ${(e as Error).message}`,
        images: [],
        metadata: { status: 'error' },
        ui_blocks: [],
      };
    }
  },
};
