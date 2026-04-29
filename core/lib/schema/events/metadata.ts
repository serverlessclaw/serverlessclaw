import { z } from 'zod';

/** Metadata schema for Coder tasks (gap tracking, build IDs). */
export const CODER_TASK_METADATA = z
  .object({
    /** Array of GAP identifiers being addressed. */
    gapIds: z.array(z.string()).default([]),
    /** Optional build ID associated with the task. */
    buildId: z.string().nullable().default(null),
    /** Primary file being targeted. */
    targetFile: z.string().nullable().default(null),
    /** Git branch name. */
    branch: z.string().nullable().default(null),
  })
  .default({ gapIds: [], buildId: null, targetFile: null, branch: null });

/** Metadata schema for QA audit tasks. */
export const QA_AUDIT_METADATA = z
  .object({
    /** Array of GAP identifiers being audited. */
    gapIds: z.array(z.string()).default([]),
    /** Build ID that was audited. */
    buildId: z.string().nullable().default(null),
    /** URL of the temporary deployment. */
    deploymentUrl: z.string().nullable().default(null),
  })
  .default({ gapIds: [], buildId: null, deploymentUrl: null });

/** Metadata schema for Strategic Planner tasks. */
export const PLANNER_TASK_METADATA = z
  .object({
    /** GAP identifier. */
    gapId: z.string().nullable().default(null),
    /** Classification category. */
    category: z.string().nullable().default(null),
    /** Priority weight. */
    priority: z.number().nullable().default(null),
  })
  .default({ gapId: null, category: null, priority: null });

/** Metadata schema for build-related tasks. */
export const BUILD_TASK_METADATA = z
  .object({
    /** GAP identifiers related to the build. */
    gapIds: z.array(z.string()).default([]),
    /** Build project identifier. */
    buildId: z.string().nullable().default(null),
    /** Friendly project name. */
    projectName: z.string().nullable().default(null),
  })
  .default({ gapIds: [], buildId: null, projectName: null });

/** Metadata schema for clarification requests. */
export const CLARIFICATION_TASK_METADATA = z
  .object({
    /** The specific question asked. */
    question: z.string().nullable().default(null),
    /** Reference to the original task. */
    originalTask: z.string().nullable().default(null),
    /** Number of retry attempts. */
    retryCount: z.number().default(0),
  })
  .default({ question: null, originalTask: null, retryCount: 0 });

/** Metadata schema for research tasks. */
export const RESEARCH_TASK_METADATA = z
  .object({
    /** Mode of research (domain knowledge or evolution history). */
    researchMode: z.enum(['evolution', 'domain']).default('domain'),
    /** Search depth. */
    depth: z.number().default(2),
    /** Time budget limit. */
    timeBudgetMs: z.number().optional(),
    /** Whether to run parallel sub-queries. */
    parallel: z.boolean().default(false),
  })
  .default({ researchMode: 'domain', depth: 2, parallel: false });

export type CoderTaskMetadata = z.infer<typeof CODER_TASK_METADATA>;
export type QaAuditMetadata = z.infer<typeof QA_AUDIT_METADATA>;
export type PlannerTaskMetadata = z.infer<typeof PLANNER_TASK_METADATA>;
export type BuildTaskMetadata = z.infer<typeof BUILD_TASK_METADATA>;
export type ClarificationTaskMetadata = z.infer<typeof CLARIFICATION_TASK_METADATA>;
export type ResearchTaskMetadata = z.infer<typeof RESEARCH_TASK_METADATA>;
