/**
 * Audit Protocol Module
 *
 * Enables the Cognition Reflector to run system-wide audits against
 * the silos defined in docs/governance/AUDIT.md
 */

import { logger } from '../../lib/logger';
import { emitEvent } from '../../lib/utils/bus';
import { AgentType, EventType } from '../../lib/types/agent';

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
];

export async function runSystemAudit(
  memory: {
    getAllGaps(status: unknown): Promise<unknown[]>;
    getFailurePatterns(userId: string, pattern: string, limit: number): Promise<unknown[]>;
    set(key: string, value: unknown): Promise<void>;
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

async function auditShield(_memory: unknown): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

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

async function auditEye(_memory: unknown): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

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
