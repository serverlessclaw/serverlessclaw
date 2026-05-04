/**
 * Shared type definitions for dashboard components.
 * Extracted to eliminate duplicate interface definitions across components.
 */

export interface TrackBudget {
  track: string;
  allocated: number;
  spent: number;
}

export interface Anomaly {
  type: string;
  severity: string;
  message: string;
}
