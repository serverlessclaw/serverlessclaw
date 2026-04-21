/**
 * Audit Protocol Module
 *
 * Enables the Cognition Reflector to run system-wide audits against
 * the silos defined in docs/governance/AUDIT.md
 */

import { logger } from '../../lib/logger';
import { emitEvent } from '../../lib/utils/bus';
import { AgentType, EventType, GapStatus } from '../../lib/types/agent';
import { AuditSilo, AuditFinding, AuditReport, AUDIT_SILOS } from './lib/audit-definitions';
import { MetabolismService } from '../../lib/maintenance/metabolism';
import { setGap } from '../../lib/memory/gap-operations';
import { InsightCategory } from '../../lib/types/memory';

/**
 * Interface representing the subset of the memory provider used for audits.
 */
export interface MemoryForAudit {
  getAllGaps(
    status?: import('../../lib/types/agent').GapStatus,
    scope?: string | import('../../lib/types/memory').ContextualScope
  ): Promise<import('../../lib/types/memory').MemoryInsight[]>;
  getFailurePatterns(
    limit?: number,
    scope?: string | import('../../lib/types/memory').ContextualScope
  ): Promise<import('../../lib/types/memory').MemoryInsight[]>;
  recordFailurePattern(
    planHash: string,
    planContent: string,
    gapIds: string[],
    failureReason: string,
    metadata?: Partial<import('../../lib/types/memory').InsightMetadata>,
    scope?: string | import('../../lib/types/memory').ContextualScope
  ): Promise<number | string>;
  getScopedUserId(
    userId: string,
    scope?: string | import('../../lib/types/memory').ContextualScope
  ): string;
  set?(key: string, value: unknown): Promise<void>;
  get?(key: string): Promise<unknown>;
}

/**
 * Runs a full system audit across all defined silos.
 */
export async function runSystemAudit(
  memory: MemoryForAudit,
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
  memory: MemoryForAudit,
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
      case 'Metabolism':
        findings.push(...(await auditMetabolism(memory)));
        break;
    }
  } catch (e) {
    logger.error(`[Audit] Error auditing silo ${silo.name}:`, e);
  }

  return findings;
}

// --- Silo Implementations ---

async function auditSpine(memory: MemoryForAudit): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const openGaps = (await memory.getAllGaps(
    GapStatus.OPEN
  )) as import('../../lib/types/memory').MemoryInsight[];

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

async function auditHand(memory: MemoryForAudit): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const failures = (await memory.getFailurePatterns(
    10
  )) as import('../../lib/types/memory').MemoryInsight[];

  const toolFailurePatterns = failures.filter((f) => f.metadata?.category === 'TOOL_EXECUTION');

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

async function auditShield(memory: MemoryForAudit): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const safeGet = async (key: string) =>
    typeof memory.get === 'function' ? await memory.get(key) : null;

  // Sh1: Check for recent safety violations
  const recentViolations = (await safeGet('safety:violations:recent')) as { count?: number } | null;
  if (!recentViolations || recentViolations.count === 0) {
    findings.push({
      silo: 'Shield',
      expected: 'Safety violation logging persisted to DynamoDB',
      actual: 'No persisted violation data found',
      severity: 'P2',
      recommendation: 'Persist safety violations to DynamoDB for persistent audit trail',
    });
  }

  // Sh4: Check recovery Dead Man's Switch health
  const recoveryHealth = (await safeGet('recovery:health')) as { lastCheck: number } | null;
  const healthCheckAge = recoveryHealth ? Date.now() - recoveryHealth.lastCheck : Infinity;
  if (!recoveryHealth || healthCheckAge > 5 * 60 * 1000) {
    findings.push({
      silo: 'Shield',
      expected: 'Recovery health checks within last 5 minutes',
      actual: `Last health check ${recoveryHealth ? Math.round(healthCheckAge / 60000) : 'N/A'} min ago`,
      severity: 'P1',
      recommendation: "Verify Dead Man's Switch recovery logic is functioning",
    });
  }

  return findings;
}

async function auditBrain(memory: MemoryForAudit): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const doneGaps = (await memory.getAllGaps(GapStatus.DONE)) as Array<{
    metadata?: { updatedAt?: number };
  }>;
  const staleLimit = 90 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const staleGaps = doneGaps.filter((g) => now - (g.metadata?.updatedAt || 0) > staleLimit);

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

async function auditEye(memory: MemoryForAudit): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const safeGet = async (key: string) =>
    typeof memory.get === 'function' ? await memory.get(key) : null;

  const e2eStatus = (await safeGet('e2e:last_run')) as { passed: number; failed: number } | null;
  if (e2eStatus) {
    const total = e2eStatus.passed + e2eStatus.failed;
    const passRate = total > 0 ? e2eStatus.passed / total : 0;
    if (passRate < 0.8) {
      findings.push({
        silo: 'Eye',
        expected: 'E2E test pass rate >= 80%',
        actual: `E2E pass rate: ${Math.round(passRate * 100)}%`,
        severity: 'P1',
        recommendation: 'Review failing E2E tests',
      });
    }
  }

  const ciStatus = (await safeGet('ci:last_run')) as { status: string } | null;
  if (!ciStatus || ciStatus.status === 'failed') {
    findings.push({
      silo: 'Eye',
      expected: 'CI pipeline passing',
      actual: ciStatus ? `CI failed: ${ciStatus.status}` : 'No CI status found',
      severity: 'P1',
      recommendation: 'Fix CI pipeline failures before deployment',
    });
  }

  return findings;
}

async function auditScales(memory: MemoryForAudit): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const safeGet = async (key: string) =>
    typeof memory.get === 'function' ? await memory.get(key) : null;

  const trustHistory = (await safeGet('trust:score_history')) as unknown[];
  if (!trustHistory || trustHistory.length < 2) {
    findings.push({
      silo: 'Scales',
      expected: 'TrustScore history persisted for trend detection',
      actual: 'Insufficient TrustScore history found',
      severity: 'P2',
      recommendation: 'Persist TrustScore snapshots to enable drift detection',
    });
  }

  return findings;
}

/**
 * Audits Silo 7: The Metabolism (Bloat & Debt)
 * Now uses the central MetabolismService for Regenerative Repair.
 */
async function auditMetabolism(memory: MemoryForAudit): Promise<AuditFinding[]> {
  // @ts-expect-error - MetabolismService expects BaseMemoryProvider but MemoryForAudit is a compatible subset for what it needs here
  const findings = await MetabolismService.runMetabolismAudit(memory, { repair: true });

  // Propagate critical metabolism findings as Strategic Gaps for the Planner to pick up
  for (const f of findings) {
    if (f.severity === 'P1' || f.severity === 'P2') {
      try {
        await setGap(
          // @ts-expect-error - setGap expects BaseMemoryProvider
          memory,
          `MAINTENANCE-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          `[Metabolism] ${f.actual}. Recommendation: ${f.recommendation}`,
          { category: InsightCategory.STRATEGIC_GAP, urgency: 5, impact: 8 }
        );
      } catch (e) {
        logger.warn('[Audit] Failed to propagate maintenance gap:', e);
      }
    }
  }

  return findings;
}

// --- Persistence & Signaling ---

async function saveAuditReport(memory: MemoryForAudit, report: AuditReport): Promise<void> {
  try {
    if (memory.set) {
      await memory.set(`audit:${report.auditId}`, report);
    }
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
