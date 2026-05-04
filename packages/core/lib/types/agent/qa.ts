/**
 * Individual issue identified during QA audit feedback.
 */
export interface QAFailureIssue {
  file: string;
  line: number;
  description: string;
  expected: string;
  actual: string;
}

/**
 * Structured feedback block returned by QA Auditor on REOPEN status.
 */
export interface QAFailureFeedback {
  failureType: 'LOGIC_ERROR' | 'MISSING_TEST' | 'DOCS_DRIFT' | 'SECURITY_RISK';
  issues: QAFailureIssue[];
}
