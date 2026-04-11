import { AgentRegistry } from '../../../lib/registry/AgentRegistry';
import { ConfigManager } from '../../../lib/registry/config';
import { DYNAMO_KEYS } from '../../../lib/constants';
import { logger } from '../../../lib/logger';
import { TOOLS } from '../../../tools/index';
import { BACKBONE_REGISTRY } from '../../../lib/backbone';
import * as fs from 'fs';
import * as path from 'path';

export interface PruneProposal {
  swarm: {
    unusedTools: string[];
    zombieAgents: string[];
    perAgentBloat: Array<{ agentId: string; unusedTools: string[] }>;
  };
  codebase: {
    emptyDirs: string[];
    debtMarkers: number;
    orphanedFiles: string[];
  };
  thresholdDays: number;
  lastAudit: number;
}

/**
 * ScytheLogic handles the identification and telemetry of bloat and debt.
 * It is the core engine for Silo 7 (The Scythe) of the Cognition Reflector.
 */
export class ScytheLogic {
  private static get BACKBONE_IDS(): string[] {
    return Object.keys(BACKBONE_REGISTRY);
  }
  private static IMMUNE_TOOLS = [
    'dispatchTask',
    'listAgents',
    'saveMemory',
    'recallKnowledge',
    'sendMessage',
    'checkHealth',
    'triggerRollback',
    'forceReleaseLock',
    'runShellCommand',
    'validateCode',
  ];

  /**
   * Retrieves the combined list of immune tools (hardcoded + config).
   */
  private static async getImmuneTools(): Promise<string[]> {
    const configuredImmunity = await ConfigManager.getTypedConfig<string[]>('immune_tools', []);
    return Array.from(new Set([...ScytheLogic.IMMUNE_TOOLS, ...configuredImmunity]));
  }

  /**
   * Generates a "Prune Proposal" explicitly categorized by debt level:
   * 1. Agentic Swarm Level (Tools, Agents, Registry)
   * 2. Codebase Level (Files, Markers, Debris)
   */
  public static async generatePruneProposal(): Promise<PruneProposal | undefined> {
    const isEnabled = await ConfigManager.getTypedConfig('auto_prune_enabled', false);
    if (!isEnabled) {
      logger.info('[SCYTHE] Auto-pruning is disabled. Skipping proposal generation.');
      return undefined;
    }

    const thresholdDays = await ConfigManager.getTypedConfig('tool_prune_threshold_days', 30);
    const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
    const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // 1. Swarm Level: Unused Tools
    const toolUsage = (await ConfigManager.getRawConfig(DYNAMO_KEYS.TOOL_USAGE)) as
      | Record<string, { count: number; lastUsed: number; firstRegistered?: number }>
      | undefined;

    const unusedTools: string[] = [];
    if (toolUsage) {
      const registeredToolNames = Object.keys(TOOLS);
      const immuneTools = await this.getImmuneTools();
      const missingStats: string[] = [];

      for (const name of registeredToolNames) {
        if (immuneTools.includes(name)) continue;
        const stats = toolUsage[name];
        if (!stats) {
          missingStats.push(name);
          continue;
        }
        const firstRegistered = stats.firstRegistered || stats.lastUsed;
        if (now - firstRegistered < GRACE_PERIOD_MS) continue;
        const effectiveLastUsed = stats.lastUsed || stats.firstRegistered || 0;
        if (effectiveLastUsed === 0 || now - effectiveLastUsed > thresholdMs) {
          unusedTools.push(name);
        }
      }
      if (missingStats.length > 0) await AgentRegistry.initializeToolStats(missingStats);
    }

    // 2. Swarm Level: Per-Agent Bloat & Zombie Agents
    const perAgentBloat: Array<{ agentId: string; unusedTools: string[] }> = [];
    const zombieAgents: string[] = [];
    try {
      const allAgents = await AgentRegistry.getAllConfigs();
      const immuneTools = await this.getImmuneTools();

      for (const [agentId, config] of Object.entries(allAgents)) {
        const usageKey = `tool_usage_${agentId}`;
        const agentToolUsage = (await ConfigManager.getRawConfig(usageKey)) as
          | Record<string, { count: number; lastUsed: number }>
          | undefined;

        if (agentToolUsage && Object.keys(agentToolUsage).length > 0) {
          // Check for Per-Agent Bloat
          if (config.tools) {
            const unusedByAgent = config.tools.filter((t) => {
              if (immuneTools.includes(t)) return false;
              const stats = agentToolUsage[t];
              return !stats || now - stats.lastUsed > thresholdMs;
            });
            if (unusedByAgent.length > 5) {
              perAgentBloat.push({ agentId, unusedTools: unusedByAgent });
            }
          }
        } else {
          // Zombie Agent? (No usage history recorded at all, and is a dynamic agent)
          const isBackbone = ScytheLogic.BACKBONE_IDS.includes(agentId);
          if (!isBackbone) {
            zombieAgents.push(agentId);
          }
        }
      }
    } catch (e) {
      logger.warn('[SCYTHE] Swarm debt analysis failed:', e);
    }

    // 3. Codebase Level: Markets & Markers
    let debtMarkers = 0;
    const emptyDirs: string[] = [];
    const orphanedFiles: string[] = [];

    try {
      const coreDir = path.resolve(process.cwd(), 'core');
      if (fs.existsSync(coreDir)) {
        const allFiles: string[] = [];

        // Simple search for TODO/FIXME and collect files
        const scan = (dir: string) => {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
              if (file === 'node_modules' || file === '.git' || file === '.gemini') continue;
              const subFiles = fs.readdirSync(fullPath);
              if (subFiles.length === 0) emptyDirs.push(path.relative(process.cwd(), fullPath));
              else scan(fullPath);
            } else if (file.endsWith('.ts') || file.endsWith('.js')) {
              allFiles.push(fullPath);
              const content = fs.readFileSync(fullPath, 'utf8');
              const matches = content.match(/\/\/\s*(TODO|FIXME)/gi);
              if (matches) debtMarkers += matches.length;
            }
          }
        };
        scan(coreDir);

        // Heuristic: Orphaned Files
        // If a file is not imported by any other file (excluding its own directory siblings for simplicity?)
        // Actually, check if the filename without ext is mentioned in any other file.
        for (const file of allFiles) {
          const base = path.basename(file, path.extname(file));
          if (base === 'index') continue; // Index files are usually entry points

          let referenced = false;
          for (const other of allFiles) {
            if (file === other) continue;
            const content = fs.readFileSync(other, 'utf8');
            if (content.includes(base)) {
              referenced = true;
              break;
            }
          }
          if (!referenced) {
            orphanedFiles.push(path.relative(process.cwd(), file));
          }
        }
      }
    } catch (e) {
      logger.warn('[SCYTHE] Codebase debt analysis failed:', e);
    }

    if (
      unusedTools.length === 0 &&
      perAgentBloat.length === 0 &&
      zombieAgents.length === 0 &&
      debtMarkers === 0 &&
      emptyDirs.length === 0
    ) {
      return undefined;
    }

    return {
      swarm: { unusedTools, zombieAgents, perAgentBloat },
      codebase: { emptyDirs, debtMarkers, orphanedFiles },
      thresholdDays,
      lastAudit: now,
    };
  }

  /**
   * Records a prune proposal in the system knowledge.
   */
  public static async recordPruneProposal(proposal: PruneProposal, memory?: any): Promise<void> {
    const gapId = `prune_proposal_${Date.now()}`;

    await ConfigManager.saveRawConfig(`pending_prune_proposal`, {
      ...proposal,
      status: 'PENDING_REVIEW',
      id: gapId,
    });

    if (memory && typeof memory.addMemory === 'function') {
      try {
        const { InsightCategory } = await import('../../../lib/types/memory');
        const swarmDebtCount =
          proposal.swarm.unusedTools.length + proposal.swarm.zombieAgents.length;
        const codeDebtCount =
          proposal.codebase.emptyDirs.length + (proposal.codebase.debtMarkers > 20 ? 1 : 0);

        await memory.addMemory(
          'system',
          InsightCategory.SYSTEM_IMPROVEMENT,
          `Scythe Debt Proposal: Identified ${swarmDebtCount} swarm-level issues and ${codeDebtCount} codebase-level issues.`,
          {
            impact: 4,
            urgency: 2,
            priority: 3,
            tags: ['scythe', 'debt-reduction', 'swarm-debt', 'code-debt'],
            details: proposal,
          }
        );
      } catch (e) {
        logger.error('[SCYTHE] Failed to record prune proposal in memory:', e);
      }
    }
  }

  /**
   * Updates the tool count history to enable trend analysis in audits.
   */
  public static async updateToolHistory(memory?: any): Promise<void> {
    const TOOL_HISTORY_KEY = 'scythe:tool_count_history';
    const MAX_HISTORY = 50;

    try {
      const toolNames = Object.keys(TOOLS);
      const currentCount = toolNames.length;

      let history: Array<{ count: number; timestamp: number }> = [];

      if (memory && typeof memory.get === 'function') {
        history = (await memory.get(TOOL_HISTORY_KEY)) || [];
      } else {
        history = await ConfigManager.getTypedConfig<Array<{ count: number; timestamp: number }>>(
          TOOL_HISTORY_KEY,
          []
        );
      }

      if (!Array.isArray(history)) history = [];
      history.push({ count: currentCount, timestamp: Date.now() });

      const trimmedHistory = history.slice(-MAX_HISTORY);

      if (memory && typeof memory.set === 'function') {
        await memory.set(TOOL_HISTORY_KEY, trimmedHistory);
      }
      await ConfigManager.saveRawConfig(TOOL_HISTORY_KEY, trimmedHistory);
    } catch (e) {
      logger.error('[SCYTHE] Failed to update tool history:', e);
    }
  }
}
