import { logger } from '../../lib/logger';

/**
 * Simple schema validation for incoming event details.
 */
export function validateEvent(eventDetail: Record<string, unknown>): {
  valid: boolean;
  errors?: string[];
} {
  const requiredFields = ['sessionId', 'traceId'];
  const missing = requiredFields.filter((field) => !(field in eventDetail));

  if (missing.includes('sessionId')) {
    eventDetail.sessionId = 'system-spine';
    logger.warn('[VALIDATION] Missing sessionId, using default: system-spine');
  }

  if (missing.includes('traceId')) {
    eventDetail.traceId = `t-sys-${Date.now()}`;
    logger.warn(`[VALIDATION] Missing traceId, using default: ${eventDetail.traceId}`);
  }

  return { valid: true };
}
