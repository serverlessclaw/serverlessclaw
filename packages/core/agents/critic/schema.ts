/**
 * JSON Schema for the Critic Agent verdict.
 * Used by the Council of Agents to review strategic plans before execution.
 */
export const CriticVerdictSchema = {
  type: 'object' as const,
  properties: {
    verdict: { type: 'string', enum: ['APPROVED', 'REJECTED', 'CONDITIONAL'] },
    reviewMode: { type: 'string', enum: ['security', 'performance', 'architect'] },
    confidence: { type: 'number', minimum: 1, maximum: 10 },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          category: { type: 'string' },
          description: { type: 'string' },
          location: { type: 'string' },
          suggestion: { type: 'string' },
        },
        required: ['severity', 'category', 'description'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string' },
  },
  required: ['verdict', 'reviewMode', 'confidence', 'findings', 'summary'],
  additionalProperties: false,
};

/**
 * Review mode for the Critic Agent.
 */
export type ReviewMode = 'security' | 'performance' | 'architect';

/**
 * Severity level for findings.
 */
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * A single finding from the review.
 */
export interface Finding {
  severity: FindingSeverity;
  category: string;
  description: string;
  location?: string;
  suggestion?: string;
}

/**
 * The complete verdict from the Critic Agent.
 */
export interface CriticVerdict {
  verdict: 'APPROVED' | 'REJECTED' | 'CONDITIONAL';
  reviewMode: ReviewMode;
  confidence: number;
  findings: Finding[];
  summary: string;
}
