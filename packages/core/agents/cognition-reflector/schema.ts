import { InsightCategory } from '../../lib/types/memory';

/**
 * The structured JSON schema for the Reflector Agent's analysis report.
 * This schema enforces strict extraction of facts, lessons, and capability gaps.
 */
export const ReflectionReportSchema = {
  type: 'json_schema',
  json_schema: {
    name: 'reflection_report',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        facts: { type: 'string' },
        lessons: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              category: { type: 'string' },
              impact: { type: 'integer', minimum: 1, maximum: 10 },
            },
            required: ['content', 'category', 'impact'],
            additionalProperties: false,
          },
        },
        gaps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              impact: { type: 'integer', minimum: 1, maximum: 10 },
              urgency: { type: 'integer', minimum: 1, maximum: 10 },
            },
            required: ['content', 'impact', 'urgency'],
            additionalProperties: false,
          },
        },
        updatedGaps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              impact: { type: 'integer', minimum: 1, maximum: 10 },
              urgency: { type: 'integer', minimum: 1, maximum: 10 },
            },
            required: ['id', 'impact', 'urgency'],
            additionalProperties: false,
          },
        },
        resolvedGapIds: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['facts', 'lessons', 'gaps', 'updatedGaps', 'resolvedGapIds'],
      additionalProperties: false,
    },
  },
} as const;

/**
 * TypeScript interface for the parsed reflection report.
 */
export interface ReflectionReport {
  facts: string;
  lessons: Array<{
    content: string;
    category: InsightCategory;
    impact: number;
    confidence?: number;
    complexity?: number;
    risk?: number;
    urgency?: number;
    priority?: number;
  }>;
  gaps: Array<{
    content: string;
    impact: number;
    urgency: number;
    confidence?: number;
    complexity?: number;
    risk?: number;
    priority?: number;
  }>;
  updatedGaps: Array<{ id: string; impact: number; urgency: number }>;
  resolvedGapIds: string[];
}
