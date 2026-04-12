import { ITool, ToolResult } from '../../lib/types/index';
import { proposeAutonomyUpdate as proposeLogic } from '../../lib/agent/tools/governance';
import { systemSchema as schema } from './schema';
import { logger } from '../../lib/logger';
import { MetabolismService } from '../../lib/maintenance/metabolism';
import { DynamoMemory } from '../../lib/memory/dynamo-memory';

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
      // 1. Initialize memory for repair context - uses default client
      const memory = new DynamoMemory();

      // 2. Perform the audit (with repair enabled if requested via args or default true)
      const repairEnabled = _args.repair !== false;
      const findings = await MetabolismService.runMetabolismAudit(memory, {
        repair: repairEnabled,
      });

      // 3. Map findings to response text
      const summary = findings.map((f) => `[${f.severity}] ${f.silo}: ${f.actual}`).join('\n');
      const p1Count = findings.filter((f) => f.severity === 'P1').length;
      const p2Count = findings.filter((f) => f.severity === 'P2').length;

      return {
        text: `Metabolism scan identify ${findings.length} findings (${p1Count} P1, ${p2Count} P2).\n\n${summary}`,
        images: [],
        metadata: {
          status: findings.length === 0 ? 'lean' : 'debt_detected',
          findings,
          summary,
        },
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
