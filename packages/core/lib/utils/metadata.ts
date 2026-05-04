import { z } from 'zod';
import { logger } from '../logger';
import {
  CODER_TASK_METADATA,
  QA_AUDIT_METADATA,
  PLANNER_TASK_METADATA,
  BUILD_TASK_METADATA,
  CLARIFICATION_TASK_METADATA,
  CoderTaskMetadata,
  QaAuditMetadata,
  PlannerTaskMetadata,
  BuildTaskMetadata,
  ClarificationTaskMetadata,
} from '../schema/events';

/**
 * Generic helper to extract and validate metadata with schema defaults.
 */
export function extractMetadata<T>(schema: z.ZodSchema<T>, metadata: unknown): T {
  try {
    return schema.parse(metadata ?? {});
  } catch (error) {
    logger.warn('Metadata validation failed, returning defaults:', error);
    // Return defaults by parsing an empty object
    return schema.parse({});
  }
}

/** Extracts typed Coder metadata. */
export const extractCoderMetadata = (metadata: unknown): CoderTaskMetadata =>
  extractMetadata(CODER_TASK_METADATA, metadata);

/** Extracts typed QA metadata. */
export const extractQaMetadata = (metadata: unknown): QaAuditMetadata =>
  extractMetadata(QA_AUDIT_METADATA, metadata);

/** Extracts typed Planner metadata. */
export const extractPlannerMetadata = (metadata: unknown): PlannerTaskMetadata =>
  extractMetadata(PLANNER_TASK_METADATA, metadata);

/** Extracts typed Build metadata. */
export const extractBuildMetadata = (metadata: unknown): BuildTaskMetadata =>
  extractMetadata(BUILD_TASK_METADATA, metadata);

/** Extracts typed Clarification metadata. */
export const extractClarificationMetadata = (metadata: unknown): ClarificationTaskMetadata =>
  extractMetadata(CLARIFICATION_TASK_METADATA, metadata);
