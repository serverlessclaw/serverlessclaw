/**
 * Audit Protocol Module
 *
 * Enables the Cognition Reflector to run system-wide audits against
 * the silos defined in docs/governance/AUDIT.md
 */

import { logger } from '../../lib/logger';
import { emitEvent } from '../../lib/utils/bus';
import { AgentType, EventType } from '../../lib/types/agent';
import { ScytheLogic } from './lib/scythe';
import { TOOLS } from '../../tools/index';
import * as fs from 'fs';
import * as path from 'path';

export interface AuditSilo {
  name: string;
  perspective: string;
  angle: string;
  keyConcepts: string[];
}

export interface AuditFinding {
  silo: string;
  expected: string;
  actual: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  recommendation: string;
}

export interface AuditReport {
  auditId: string;
  timestamp: number;
  triggerType: string;
  silosReviewed: string[];
  findings: AuditFinding[];
  summary: string;
}

export const AUDIT_SILOS: AuditSilo[] = [
  {
    name: 'Spine',
    perspective: 'How does the system ensure the signal never dies?',
    angle:
      'Audit the journey of events through the asynchronous backbone. Look for "dead ends," race conditions in the distributed lock, and the effectiveness of Conflict Resolution Timeouts during agent handoffs.',
    keyConcepts: [
      'Event routing',
      'recursion limits',
      'strategic tie-break logic',
      'adapter normalization',
    ],
  },
  {
    name: 'Hand',
    perspective: 'How effectively can the system manipulate its environment?',
    angle:
      'Explore the boundary between agent intent and tool execution. Review the "creative" prompts of personas like Coder and Planner and the reliability of the "Unified MCP Multiplexer" under heavy load.',
    keyConcepts: [
      'Prompt engineering',
      'skill discovery',
      'tool schema consistency',
      'MCP resource efficiency',
    ],
  },
  {
    name: 'Shield',
    perspective: 'What happens when things break or the perimeter is breached?',
    angle:
      'Stress-test the "survival instincts" of the platform. Audit IAM least-privilege policies and the effectiveness of Proactive Trunk Evolution for autonomous infrastructure changes.',
    keyConcepts: [
      'Safety guardrails',
      'recovery logic',
      'Class C blast-radius limits',
      'real-time security signaling',
    ],
  },
  {
    name: 'Brain',
    perspective: 'How does the system maintain its "sense of self" and history?',
    angle:
      'Investigate the continuity of context across multi-turn sessions. Audit the multi-tenant Workspace isolation and the efficiency of the Hybrid Memory Model for high-speed recall and strategic reflection.',
    keyConcepts: [
      'Tiered retention',
      'Vector RAG efficiency',
      'RBAC',
      'strategic gap identification',
    ],
  },
  {
    name: 'Eye',
    perspective: "Is the system's view of itself accurate?",
    angle:
      'Audit the feedback loops. Review the Playwright E2E suite and the LLM-as-a-Judge semantic evaluation layer to ensure "truth" matches backend state.',
    keyConcepts: [
      'Dashboard tracing accuracy',
      'LLM-as-a-Judge consistency',
      'build-monitor signaling',
      'autonomous test suite evolution',
    ],
  },
  {
    name: 'Scales',
    perspective: 'Is the system grading its own homework too leniently?',
    angle:
      'Audit the SafetyEngine and the LLM-as-a-Judge semantic evaluation layer to ensure TrustScore calculations are resistant to artificial inflation. Verify that failures accurately and immediately penalize the trust score.',
    keyConcepts: [
      'Trust decay rates',
      'metric gaming',
      'false-positive evaluations',
      'mode-shift thrashing',
    ],
  },
  {
    name: 'Scythe',
    perspective:
      'How can we refactor for a leaner, more consistent, and efficient codebase? What is strictly necessary?',
    angle:
      'Audit the workspace for generated sprawl and over-engineered implementations. Act as a critic on necessity to prevent overgrowth. Identify redundant tools, overlapping logic, "dark" code that is never executed, and overly thick abstraction layers. Prioritize consolidating patterns and ensuring that code additions pull their weight.',
    keyConcepts: [
      'Necessity critique',
      'bloat prevention',
      'pattern consolidation',
      'tool pruning',
      'cyclomatic complexity reduction',
      'semantic compression',
    ],
  },
];

export async function runSystemAudit(
  memory: {
    getAllGaps(status: unknown): Promise<unknown[]>;
    getFailurePatterns(userId: string, pattern: string, limit: number): Promise<unknown[]>;
    set(key: string, value: unknown): Promise<void>;
    get?(key: string): Promise<unknown>;
  },
  triggerType: string,
  context?: Record<string, unknown>
): Promise<AuditReport> {
  const auditId = `AUDIT-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  logger.info(`[Audit] Starting system audit ${auditId}, trigger: ${triggerType}`);

  const findings: AuditFinding[] = [];
  const silosReviewed: string[] = [];

  for (const silo of AUDIT_SILOS) {
    silosReviewed.push(silo.name);
    logger.info(`[Audit] Reviewing silo: ${silo.name}`);

    const siloFindings = await auditSilo(memory, silo, context);
    findings.push(...siloFindings);
  }

  const p0Count = findings.filter((f) => f.severity === 'P0').length;
  const p1Count = findings.filter((f) => f.severity === 'P1').length;

  const summary = `Audit ${auditId} completed. ${findings.length} findings: ${p0Count} P0, ${p1Count} P1, ${findings.length - p0Count - p1Count} P2/P3.`;

  const report: AuditReport = {
    auditId,
    timestamp: Date.now(),
    triggerType,
    silosReviewed,
    findings,
    summary,
  };

  await saveAuditReport(memory, report);
  await emitAuditCompleteEvent(report);

  logger.info(`[Audit] ${summary}`);
  return report;
}

async function auditSilo(
  memory: {
    getAllGaps(status: unknown): Promise<unknown[]>;
    getFailurePatterns(userId: string, pattern: string, limit: number): Promise<unknown[]>;
    get?(key: string): Promise<unknown>;
  },
  silo: AuditSilo,
  _context?: Record<string, unknown>
): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  try {
    switch (silo.name) {
      case 'Spine':
        findings.push(...(await auditSpine(memory)));
        break;
      case 'Hand':
        findings.push(...(await auditHand(memory)));
        break;
      case 'Shield':
        findings.push(...(await auditShield(memory)));
        break;
      case 'Brain':
        findings.push(...(await auditBrain(memory)));
        break;
      case 'Eye':
        findings.push(...(await auditEye(memory)));
        break;
      case 'Scales':
        findings.push(...(await auditScales(memory)));
        break;
      case 'Scythe':
        findings.push(...(await auditScythe(memory)));
        break;
    }
  } catch (e) {
    logger.error(`[Audit] Error auditing silo ${silo.name}:`, e);
  }

  return findings;
}

async function auditSpine(memory: {
  getAllGaps(status: unknown): Promise<unknown[]>;
}): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  const openGaps = (await memory.getAllGaps('OPEN')) as unknown[];

  if (openGaps.length > 50) {
    findings.push({
      silo: 'Spine',
      expected: 'Less than 50 open gaps indicating healthy event flow',
      actual: `${openGaps.length} open gaps - potential event backlog`,
      severity: 'P2',
      recommendation: 'Review agent processing throughput and consider scaling event handlers',
    });
  }

  return findings;
}

async function auditHand(memory: {
  getFailurePatterns(userId: string, pattern: string, limit: number): Promise<unknown[]>;
}): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  const failures = (await memory.getFailurePatterns('*', '*', 10)) as unknown[];

  const toolFailurePatterns = failures.filter((f: unknown) => {
    const pattern = f as { category?: string };
    return pattern.category === 'TOOL_EXECUTION';
  });

  if (toolFailurePatterns.length > 3) {
    findings.push({
      silo: 'Hand',
      expected: 'Less than 3 tool execution failure patterns',
      actual: `${toolFailurePatterns.length} tool execution failures`,
      severity: 'P1',
      recommendation: 'Review MCP server health and tool schema consistency',
    });
  }

  return findings;
}

async function auditShield(memory: {
  getAllGaps(status: unknown): Promise<unknown[]>;
  getFailurePatterns(userId: string, pattern: string, limit: number): Promise<unknown[]>;
  get?(key: string): Promise<unknown>;
}): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // Helper to safely get memory value if get() method exists
  const safeGet = async (key: string): Promise<unknown | null> => {
    if (typeof memory.get === 'function') {
      return await memory.get(key);
    }
    return null;
  };

  // Sh1: Check for recent safety violations (in-memory only - gap from audit)
  const recentViolationsKey = 'safety:violations:recent';
  const recentViolations = (await safeGet(recentViolationsKey)) as {
    count: number;
    timestamp: number;
  } | null;

  if (!recentViolations || recentViolations.count === 0) {
    findings.push({
      silo: 'Shield',
      expected: 'Safety violation logging persisted to DynamoDB for audit trail',
      actual: 'No persisted violation data found - violations only stored in-memory (max 1000)',
      severity: 'P2',
      recommendation:
        'Persist safety violations to DynamoDB for persistent audit trail and compliance',
    });
  }

  // Sh2: Check for Class C action blast-radius tracking
  const classCActionsKey = 'safety:class_c:blast_radius';
  const blastRadius = (await safeGet(classCActionsKey)) as Record<
    string,
    { count: number; affectedResources: number }
  > | null;

  if (!blastRadius) {
    findings.push({
      silo: 'Shield',
      expected: 'Class C actions have blast-radius tracking (number of affected resources)',
      actual:
        'No blast-radius tracking found - Class C classification exists but no containment enforcement',
      severity: 'P2',
      recommendation:
        'Add blast-radius tracking for Class C actions to measure and limit propagation scope',
    });
  }

  // Sh3: Check for dedicated security alert channel
  const securityChannelKey = 'security:alert_channel';
  const securityChannel = (await safeGet(securityChannelKey)) as { configured: boolean } | null;

  if (!securityChannel?.configured) {
    findings.push({
      silo: 'Shield',
      expected: 'Dedicated security alert channel (e.g., Slack/PagerDuty webhook)',
      actual: 'Security issues emitted as generic health events - no separate security signaling',
      severity: 'P2',
      recommendation: 'Create dedicated security event channel separate from general health events',
    });
  }

  // Sh4: Check recovery Dead Man's Switch health
  const recoveryHealthKey = 'recovery:health';
  const recoveryHealth = (await safeGet(recoveryHealthKey)) as {
    lastCheck: number;
    status: string;
  } | null;

  const healthCheckAge = recoveryHealth ? Date.now() - recoveryHealth.lastCheck : Infinity;
  if (!recoveryHealth || healthCheckAge > 5 * 60 * 1000) {
    findings.push({
      silo: 'Shield',
      expected: 'Recovery health checks within last 5 minutes',
      actual: `Last health check ${Math.round(healthCheckAge / 60000)} minutes ago`,
      severity: 'P1',
      recommendation:
        "Verify Dead Man's Switch recovery logic is functioning - health checks may be stalled",
    });
  }

  return findings;
}

async function auditBrain(memory: {
  getAllGaps(status: unknown): Promise<unknown[]>;
}): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  const doneGaps = (await memory.getAllGaps('DONE')) as unknown[];
  const staleGaps = doneGaps.filter((g: unknown) => {
    const gap = g as { metadata?: { updatedAt?: number } };
    const updatedAt = gap.metadata?.updatedAt || 0;
    return Date.now() - updatedAt > 90 * 24 * 60 * 60 * 1000;
  });

  if (staleGaps.length > 20) {
    findings.push({
      silo: 'Brain',
      expected: 'Less than 20 stale resolved gaps',
      actual: `${staleGaps.length} stale resolved gaps`,
      severity: 'P3',
      recommendation: 'Consider purging old resolved gaps to optimize memory retrieval',
    });
  }

  return findings;
}

async function auditEye(memory: {
  getAllGaps(status: unknown): Promise<unknown[]>;
  getFailurePatterns(userId: string, pattern: string, limit: number): Promise<unknown[]>;
  get?(key: string): Promise<unknown>;
}): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // Helper to safely get memory value if get() method exists
  const safeGet = async (key: string): Promise<unknown | null> => {
    if (typeof memory.get === 'function') {
      return await memory.get(key);
    }
    return null;
  };

  // E1: Check E2E test pass rate
  const e2eStatusKey = 'e2e:last_run';
  const e2eStatus = (await safeGet(e2eStatusKey)) as {
    passed: number;
    failed: number;
    timestamp: number;
  } | null;

  if (e2eStatus) {
    const total = e2eStatus.passed + e2eStatus.failed;
    const passRate = total > 0 ? e2eStatus.passed / total : 0;
    if (passRate < 0.8) {
      findings.push({
        silo: 'Eye',
        expected: 'E2E test pass rate >= 80%',
        actual: `E2E pass rate: ${Math.round(passRate * 100)}% (${e2eStatus.passed}/${total})`,
        severity: 'P1',
        recommendation: 'Review failing E2E tests - system truth may not match backend state',
      });
    }

    // Check if E2E tests are stale (not run in last 24 hours)
    const e2eAge = Date.now() - e2eStatus.timestamp;
    if (e2eAge > 24 * 60 * 60 * 1000) {
      findings.push({
        silo: 'Eye',
        expected: 'E2E tests run within last 24 hours',
        actual: `Last E2E run: ${Math.round(e2eAge / 3600000)} hours ago`,
        severity: 'P2',
        recommendation: 'Run E2E tests to verify current system truth against backend state',
      });
    }
  } else {
    findings.push({
      silo: 'Eye',
      expected: 'E2E test results recorded for truth verification',
      actual: 'No E2E test results found - cannot verify truth matches backend state',
      severity: 'P2',
      recommendation: 'Integrate E2E test results into audit system for truth verification',
    });
  }

  // E2: Check LLM-as-a-Judge module existence
  const judgeModuleKey = 'quality:judge_module';
  const judgeModule = (await safeGet(judgeModuleKey)) as { exists: boolean } | null;

  if (!judgeModule?.exists) {
    findings.push({
      silo: 'Eye',
      expected: 'Dedicated LLM-as-a-Judge module for systematic semantic evaluation',
      actual: 'No LLM-as-a-Judge module found - semantic evaluation is ad-hoc via QA agent prompts',
      severity: 'P2',
      recommendation: 'Create dedicated LLM-as-a-Judge module for consistent semantic evaluation',
    });
  }

  // E3: Check CI/CD pipeline health
  const ciStatusKey = 'ci:last_run';
  const ciStatus = (await safeGet(ciStatusKey)) as {
    status: string;
    timestamp: number;
  } | null;

  if (!ciStatus || ciStatus.status === 'failed') {
    findings.push({
      silo: 'Eye',
      expected: 'CI pipeline passing - deployment lifecycle truth verified',
      actual: ciStatus ? `CI failed: ${ciStatus.status}` : 'No CI status found',
      severity: 'P1',
      recommendation: 'Fix CI pipeline failures before deployment to maintain truth integrity',
    });
  }

  // E4: Check trace dashboard data consistency
  const traceHealthKey = 'traces:health';
  const traceHealth = (await safeGet(traceHealthKey)) as {
    lastSync: number;
    consistency: string;
  } | null;

  if (!traceHealth) {
    findings.push({
      silo: 'Eye',
      expected: 'Trace dashboard data synced with backend state',
      actual: 'No trace health data found - cannot verify dashboard accuracy',
      severity: 'P3',
      recommendation: 'Add trace consistency checks to verify dashboard truth',
    });
  }

  return findings;
}

/**
 * Audits Silo 6: The Scales (Trust & Calibration)
 * Checks whether the TrustScore system is accurately penalizing failures
 * and resistant to artificial inflation.
 */
async function auditScales(memory: {
  getFailurePatterns(userId: string, pattern: string, limit: number): Promise<unknown[]>;
  get?(key: string): Promise<unknown>;
}): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  const safeGet = async (key: string): Promise<unknown | null> => {
    if (typeof memory.get === 'function') {
      return await memory.get(key);
    }
    return null;
  };

  // Sc1: Check if TrustScore history is being persisted for trend analysis
  const trustHistoryKey = 'trust:score_history';
  const trustHistory = (await safeGet(trustHistoryKey)) as Array<{
    score: number;
    timestamp: number;
  }> | null;

  if (!trustHistory || trustHistory.length === 0) {
    findings.push({
      silo: 'Scales',
      expected: 'TrustScore history persisted for trend detection (mode-shift thrashing)',
      actual: 'No TrustScore history found — cannot detect inflation or thrashing patterns',
      severity: 'P2',
      recommendation: 'Persist TrustScore snapshots per epoch to enable drift and gaming detection',
    });
  } else {
    // Sc2: Detect mode-shift thrashing — rapidly toggling between HITL and AUTO
    const shifts = trustHistory.filter((entry, i) => {
      if (i === 0) return false;
      const prev = trustHistory[i - 1];
      // A shift occurs when score crosses 95 (AUTO threshold) in either direction
      return (entry.score >= 95 && prev.score < 95) || (entry.score < 95 && prev.score >= 95);
    });

    if (shifts.length > 4) {
      findings.push({
        silo: 'Scales',
        expected: 'Stable TrustScore with fewer than 5 mode-shift crossings per epoch',
        actual: `${shifts.length} mode-shift crossings detected — potential system thrashing`,
        severity: 'P1',
        recommendation:
          'Add a hysteresis band (e.g., require 95+ for 3 consecutive checks before AUTO) to prevent thrashing',
      });
    }
  }

  // Sc3: Check if failures are penalizing the TrustScore promptly
  const recentFailures = (await memory.getFailurePatterns('*', '*', 5)) as unknown[];
  const trustPenaltyLogKey = 'trust:penalty_log';
  const penaltyLog = (await safeGet(trustPenaltyLogKey)) as Array<{
    timestamp: number;
  }> | null;

  if (recentFailures.length > 0 && (!penaltyLog || penaltyLog.length === 0)) {
    findings.push({
      silo: 'Scales',
      expected: 'Each failure pattern triggers a corresponding TrustScore penalty event',
      actual:
        'Failure patterns exist but no TrustScore penalty log found — failures may not be penalizing the score',
      severity: 'P2',
      recommendation:
        'Ensure SafetyEngine.recordFailure() atomically writes to the penalty log and decrements TrustScore',
    });
  }

  return findings;
}

/**
 * Audits Silo 7: The Scythe (Bloat & Debt)
 * Identifies unused tools, stale prune proposals, and high tool-count agents
 * that are accumulating cognitive load without capability gain.
 */
async function auditScythe(memory: {
  get?(key: string): Promise<unknown>;
}): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  const safeGet = async (key: string): Promise<unknown | null> => {
    if (typeof memory.get === 'function') {
      return await memory.get(key);
    }
    return null;
  };

  // Sy0: Core Scythe Scan (Proactive)
  try {
    // 1. Update tool count history for trend analysis
    await ScytheLogic.updateToolHistory(memory);

    // 2. Generate a fresh pruning proposal
    const freshProposal = await ScytheLogic.generatePruneProposal();
    if (freshProposal) {
      // 3. Record it as a pending proposal and a system improvement (memory)
      await ScytheLogic.recordPruneProposal(freshProposal, memory);

      const swarmIssues =
        freshProposal.swarm.unusedTools.length + freshProposal.swarm.zombieAgents.length;
      if (swarmIssues > 0) {
        findings.push({
          silo: 'Scythe',
          expected: 'Agent registry and swarm topology should be lean and high-utilization',
          actual: `[Swarm Debt] Identified ${freshProposal.swarm.unusedTools.length} unused tools and ${freshProposal.swarm.zombieAgents.length} zombie agents.`,
          severity: 'P2',
          recommendation: `Review the prune proposal for swarm-level optimization.`,
        });
      }

      const codeIssues =
        freshProposal.codebase.emptyDirs.length + (freshProposal.codebase.debtMarkers > 20 ? 1 : 0);
      if (codeIssues > 0) {
        findings.push({
          silo: 'Scythe',
          expected: 'Codebase should be lean and free of technical debt markers or artifact debris',
          actual: `[Codebase Debt] Identified ${freshProposal.codebase.emptyDirs.length} empty directories and ${freshProposal.codebase.debtMarkers} debt markers (TODO/FIXME).`,
          severity: 'P3',
          recommendation: `Review codebase debt findings and schedule Refactoring Hour.`,
        });
      }
    }
  } catch (e) {
    logger.warn('[Audit] Sy0: Failed to run proactive Scythe scan:', e);
  }

  // Sy1: Check for stale pending prune proposals
  const pruneProposalKey = 'pending_prune_proposal';
  const pruneProposal = (await safeGet(pruneProposalKey)) as {
    unusedTools: string[];
    thresholdDays: number;
    status: string;
    id: string;
    lastAudit?: number;
  } | null;

  if (pruneProposal && pruneProposal.status === 'PENDING_REVIEW') {
    const ageSinceProposal = pruneProposal.lastAudit
      ? Date.now() - pruneProposal.lastAudit
      : Infinity;
    const STALE_PROPOSAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

    if (ageSinceProposal > STALE_PROPOSAL_MS) {
      findings.push({
        silo: 'Scythe',
        expected: 'Prune proposals actioned within 7 days',
        actual: `[Governance Debt] Prune proposal ${pruneProposal.id} has been pending for ${Math.round(ageSinceProposal / 86400000)} days.`,
        severity: 'P2',
        recommendation:
          'Review the stale prune proposal and either action or dismiss it via the Strategic Planner',
      });
    }
  }

  // Sy2: Check if auto-pruning is disabled (a configuration debt observation)
  try {
    const { ConfigManager } = await import('../../lib/registry/config');
    const autoPruneEnabled = await ConfigManager.getTypedConfig('auto_prune_enabled', false);

    if (!autoPruneEnabled) {
      findings.push({
        silo: 'Scythe',
        expected: 'Automated tool pruning enabled or explicitly managed via HITL proposals',
        actual:
          '[Strategy Debt] auto_prune_enabled is false — pruning relies entirely on manual review of proposals',
        severity: 'P3',
        recommendation:
          'Enable auto_prune_enabled=true once trust is established, or ensure prune proposals are reviewed at each strategic cycle',
      });
    }
  } catch {
    // Registry not available in this context — skip check
  }

  // Sy3: Check tool growth — detect if total registered tools are growing rapidly
  try {
    const toolGrowthKey = 'scythe:tool_count_history';
    const toolHistory = (await safeGet(toolGrowthKey)) as Array<{
      count: number;
      timestamp: number;
    }> | null;

    if (toolHistory && toolHistory.length >= 2) {
      const oldest = toolHistory[0];
      const newest = toolHistory[toolHistory.length - 1];
      const growthRate = (newest.count - oldest.count) / oldest.count;

      if (growthRate > 0.2) {
        findings.push({
          silo: 'Scythe',
          expected: 'Tool registry growth < 20% between audits',
          actual: `Tool count grew ${(growthRate * 100).toFixed(1)}% from ${oldest.count} to ${newest.count}`,
          severity: 'P2',
          recommendation:
            'Review newly added tools for overlap with existing capabilities before the registry becomes unmanageable.',
        });
      }
    } else {
      logger.debug('[Audit] Sy3: Insufficient tool count history for trend analysis.');
    }
  } catch (e) {
    logger.warn('[Audit] Sy3: Failed to analyze tool growth history:', e);
  }

  // Sy4: Semantic Overlap Detection
  try {
    const toolNames = Object.keys(TOOLS);
    const overlaps: string[] = [];
    const SIMILARITY_THRESHOLD = 0.8;

    const getSimilarity = (s1: string, s2: string): number => {
      const longer = s1.length > s2.length ? s1 : s2;
      const shorter = s1.length > s2.length ? s2 : s1;
      if (longer.length === 0) return 1.0;
      return (longer.length - editDistance(longer, shorter)) / longer.length;
    };

    const editDistance = (s1: string, s2: string): number => {
      const costs = [];
      for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
          if (i === 0) costs[j] = j;
          else {
            if (j > 0) {
              let newValue = costs[j - 1];
              if (s1.charAt(i - 1) !== s2.charAt(j - 1))
                newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
              costs[j - 1] = lastValue;
              lastValue = newValue;
            }
          }
        }
        if (i > 0) costs[s2.length] = lastValue;
      }
      return costs[s2.length];
    };

    for (let i = 0; i < toolNames.length; i++) {
      for (let j = i + 1; j < toolNames.length; j++) {
        const t1 = toolNames[i];
        const t2 = toolNames[j];
        if (getSimilarity(t1, t2) > SIMILARITY_THRESHOLD) {
          overlaps.push(`${t1} <-> ${t2}`);
        }
      }
    }

    if (overlaps.length > 0) {
      findings.push({
        silo: 'Scythe',
        expected: 'Tools should be lean and strictly necessary without semantic overlap',
        actual: `Identified ${overlaps.length} potentially overlapping tool name pairs. Examples: ${overlaps.slice(0, 3).join(', ')}`,
        severity: 'P3',
        recommendation:
          'Refactor to consolidate overlapping patterns to reduce cognitive load and prevent overgrowth.',
      });
    }
  } catch (e) {
    logger.warn('[Audit] Sy4: Failed to run semantic overlap check:', e);
  }

  // Sy5: File System Bloat (Empty Directories & Debris)
  try {
    const coreDir = path.resolve(process.cwd(), 'core');
    const emptyDirs: string[] = [];

    const checkEmpty = (dir: string) => {
      const files = fs.readdirSync(dir);
      if (files.length === 0) {
        emptyDirs.push(path.relative(process.cwd(), dir));
        return;
      }
      for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          checkEmpty(fullPath);
        }
      }
    };

    if (fs.existsSync(coreDir)) {
      checkEmpty(coreDir);
    }

    if (emptyDirs.length > 0) {
      findings.push({
        silo: 'Scythe',
        expected: 'Codebase should be lean, efficient, and free of artifact debris',
        actual: `Found ${emptyDirs.length} empty directories in /core. Example: ${emptyDirs[0]}`,
        severity: 'P3',
        recommendation: 'Clean up empty directories to prevent bloated project structure.',
      });
    }
  } catch (e) {
    logger.warn('[Audit] Sy5: Failed to run file bloat check:', e);
  }

  // Sy6: Debt Index (TODO/FIXME tracking)
  try {
    // Note: In a real environment, we'd use grep. Here we do a limited scan of /core.
    let todoCount = 0;
    const scanTodos = (dir: string) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stats = fs.statSync(fullPath);
        if (stats.isDirectory() && !file.includes('node_modules')) {
          scanTodos(fullPath);
        } else if (file.endsWith('.ts') || file.endsWith('.js')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          const matches = content.match(/\/\/\s*(TODO|FIXME)/gi);
          if (matches) todoCount += matches.length;
        }
      }
    };

    const coreDir = path.resolve(process.cwd(), 'core');
    if (fs.existsSync(coreDir)) {
      scanTodos(coreDir);
    }

    if (todoCount > 20) {
      findings.push({
        silo: 'Scythe',
        expected:
          'Codebase should be lean and consistent; technical debt markers (TODO/FIXME) must be resolved to prevent overgrowth (<20)',
        actual: `Identified ${todoCount} unresolved debt markers in /core.`,
        severity: 'P3',
        recommendation:
          'Conduct a necessity critique and schedule refactoring to address accumulated technical debt and bloated implementations.',
      });
    }
  } catch (e) {
    logger.warn('[Audit] Sy6: Failed to run debt index check:', e);
  }

  // Sy7: Per-Agent Bloat Reporting
  try {
    const freshProposal = await ScytheLogic.generatePruneProposal();
    if (freshProposal && freshProposal.swarm.perAgentBloat?.length > 0) {
      const bloatCount = freshProposal.swarm.perAgentBloat.length;
      findings.push({
        silo: 'Scythe',
        expected: 'Agents should only have necessary tools enabled to minimize prompt size',
        actual: `[Swarm Debt] ${bloatCount} agents have high tool bloat (>5 unused tools).`,
        severity: 'P2',
        recommendation: `Review and prune tool overrides for agents: ${freshProposal.swarm.perAgentBloat.map((b: any) => b.agentId).join(', ')}`,
      });
    }
  } catch (e) {
    logger.warn('[Audit] Sy7: Failed to run per-agent bloat report:', e);
  }

  // Sy8: Dark Code Critique (Identify tools that have NEVER been executed)
  try {
    const { ConfigManager } = await import('../../lib/registry/config');
    const { DYNAMO_KEYS } = await import('../../lib/constants');

    const toolUsage = (await ConfigManager.getRawConfig(DYNAMO_KEYS.TOOL_USAGE)) as
      | Record<string, { count: number; lastUsed: number; firstRegistered?: number }>
      | undefined;

    if (toolUsage) {
      const toolNames = Object.keys(TOOLS);
      const darkTools = toolNames.filter((name) => !toolUsage[name]);

      if (darkTools.length > 5) {
        findings.push({
          silo: 'Scythe',
          expected:
            'Codebase additions should pull their weight; all registered tools should have usage telemetry',
          actual: `Identified ${darkTools.length} "dark" tools that have never been executed: ${darkTools.slice(0, 5).join(', ')}${darkTools.length > 5 ? '...' : ''}`,
          severity: 'P2',
          recommendation:
            'Refactor for a leaner codebase by removing these bloated implementations or ensuring they are strictly necessary.',
        });
      }
    }
  } catch (e) {
    logger.warn('[Audit] Sy8: Failed to run dark code critique:', e);
  }

  return findings;
}

async function saveAuditReport(
  memory: { set(key: string, value: unknown): Promise<void> },
  report: AuditReport
): Promise<void> {
  try {
    const key = `audit:${report.auditId}`;
    await memory.set(key, report);
    logger.info(`[Audit] Report saved: ${report.auditId}`);
  } catch (e) {
    logger.warn('[Audit] Failed to save report:', e);
  }
}

async function emitAuditCompleteEvent(report: AuditReport): Promise<void> {
  try {
    await emitEvent(AgentType.COGNITION_REFLECTOR, EventType.SYSTEM_AUDIT_TRIGGER, {
      auditId: report.auditId,
      triggerType: 'AUDIT_COMPLETED',
      findingsCount: report.findings.length,
      p0Count: report.findings.filter((f) => f.severity === 'P0').length,
      summary: report.summary,
    });
  } catch (e) {
    logger.warn('[Audit] Failed to emit audit complete event:', e);
  }
}
