/**
 * Typed Metadata Extraction Helpers
 *
 * Provides type-safe extraction of metadata from event payloads.
 * Replaces unsafe type assertions like `(metadata?.gapIds as string[])`
 * with schema-validated extraction that applies defaults.
 *
 * @module metadata
 */
import { z } from 'zod';
import {
  CODER_TASK_METADATA,
  QA_AUDIT_METADATA,
  PLANNER_TASK_METADATA,
  BUILD_TASK_METADATA,
  type CoderTaskMetadata,
  type QaAuditMetadata,
  type PlannerTaskMetadata,
  type BuildTaskMetadata,
} from '../schema/events';
import { logger } from '../logger';

/**
 * Extracts and validates metadata against a Zod schema.
 * Returns the validated data with defaults applied, or a safe fallback on error.
 *
 * @param metadata - The raw metadata object (typically Record<string, unknown>).
 * @param schema - The Zod schema to validate against.
 * @param fallback - Optional fallback value if validation fails. Defaults to schema defaults.
 * @returns The validated metadata with defaults applied.
 */
export function extractMetadata<T extends z.ZodTypeAny>(
  metadata: unknown,
  schema: T,
  fallback?: z.infer<T>
): z.infer<T> {
  const result = schema.safeParse(metadata);
  if (!result.success) {
    logger.warn(
      `Metadata validation failed: ${result.error.message}. Using ${fallback ? 'provided fallback' : 'schema defaults'}.`
    );
    return fallback ?? schema.parse({});
  }
  return result.data;
}

/**
 * Extracts Coder task metadata from a generic metadata object.
 * Applies defaults: gapIds=[], no buildId, no targetFile, no branch.
 *
 * @example
 * const meta = extractCoderMetadata(payload.metadata);
 * console.log(meta.gapIds); // string[] (never undefined)
 * console.log(meta.buildId); // string | undefined
 */
export function extractCoderMetadata(metadata: unknown): CoderTaskMetadata {
  return extractMetadata(metadata, CODER_TASK_METADATA);
}

/**
 * Extracts QA audit metadata from a generic metadata object.
 * Applies defaults: gapIds=[], no buildId, no deploymentUrl.
 */
export function extractQaMetadata(metadata: unknown): QaAuditMetadata {
  return extractMetadata(metadata, QA_AUDIT_METADATA);
}

/**
 * Extracts Strategic Planner task metadata from a generic metadata object.
 * Applies defaults: no gapId, no category, no priority.
 */
export function extractPlannerMetadata(metadata: unknown): PlannerTaskMetadata {
  return extractMetadata(metadata, PLANNER_TASK_METADATA);
}

/**
 * Extracts build task metadata from a generic metadata object.
 * Applies defaults: gapIds=[], no buildId, no projectName.
 */
export function extractBuildMetadata(metadata: unknown): BuildTaskMetadata {
  return extractMetadata(metadata, BUILD_TASK_METADATA);
}
