/**
 * Audit Handler
 *
 * Handles SYSTEM_AUDIT_TRIGGER events to run system audits.
 */

import { logger } from '../../lib/logger';
import { getDynamicConfigValue } from '../../lib/config';
import { emitEvent } from '../../lib/utils/bus';
import { AGENT_TYPES, EventType } from '../../lib/types/agent';
import { runSystemAudit } from '../../agents/cognition-reflector/audit-protocol';
import { getAgentContext } from '../../lib/utils/agent-helpers';

export interface AuditTriggerEvent {
  triggerType: string;
  metrics?: {
    previousLOC: number;
    currentLOC: number;
    growthPercentage: number;
    timestamp: number;
  };
  timestamp: number;
  userId?: string;
  traceId?: string;
  sessionId?: string;
}

export async function handleSystemAuditTrigger(
  event: AuditTriggerEvent,
  _detailType: string
): Promise<void> {
  const auditEnabled = await getDynamicConfigValue('AUDIT_EVENT_TRIGGERS_ENABLED');
  if (!auditEnabled) {
    logger.info('[AuditHandler] Audit triggers disabled, skipping');
    return;
  }

  logger.info('[AuditHandler] Received audit trigger:', event.triggerType);

  const VALID_TRIGGER_TYPES = [
    'EVENT_TRIGGER',
    'CODE_GROWTH',
    'PRE_FLIGHT_READY',
    'TRUST_SCORE_DROP',
    'MAJOR_SWARM_COMPLETE',
    'TRUNK_SYNC',
    'DEPLOYMENT_COMPLETE',
  ];

  try {
    const { memory } = await getAgentContext();

    const triggerType = event.triggerType || 'EVENT_TRIGGER';

    if (triggerType === 'AUDIT_COMPLETED') {
      logger.info(
        '[AuditHandler] Audit completion event received, skipping to avoid infinite loop.'
      );
      return;
    }

    if (!VALID_TRIGGER_TYPES.includes(triggerType)) {
      logger.warn(
        `[AuditHandler] Invalid triggerType: ${triggerType}. Falling back to EVENT_TRIGGER.`
      );
    }

    const auditReport = await runSystemAudit(
      memory as unknown as import('../../agents/cognition-reflector/audit-protocol').MemoryForAudit,
      triggerType,
      {
        codeMetrics: event.metrics,
        userId: event.userId,
        traceId: event.traceId,
      }
    );

    logger.info('[AuditHandler] Audit completed:', auditReport.summary);

    const p0Findings = auditReport.findings.filter(
      (f: { severity: string }) => f.severity === 'P0'
    );
    if (p0Findings.length > 0) {
      logger.error(`[AuditHandler] P0 findings detected: ${p0Findings.length}`);
      await emitEvent(AGENT_TYPES.COGNITION_REFLECTOR, EventType.HEALTH_ALERT, {
        component: 'AuditSystem',
        issue: `P0 audit findings: ${p0Findings.map((f: { silo: string }) => f.silo).join(', ')}`,
        severity: 'critical',
        auditId: auditReport.auditId,
        findings: p0Findings,
      });
    }
  } catch (e) {
    logger.error('[AuditHandler] Failed to run system audit:', e);
  }
}
