import { describe, it, expect } from 'vitest';
import { AgentStatus, AGENT_TYPES } from '../types/agent';
import { OrchestrationSignalSchema, QAFailureFeedbackSchema } from './orchestration';

describe('OrchestrationSignalSchema', () => {
  const minimalValid = {
    status: AgentStatus.SUCCESS,
    reasoning: 'Task completed successfully.',
  };

  describe('valid signal validation', () => {
    it('should validate SUCCESS signal with minimal fields', () => {
      const result = OrchestrationSignalSchema.parse(minimalValid);
      expect(result.status).toBe(AgentStatus.SUCCESS);
      expect(result.reasoning).toBe('Task completed successfully.');
    });

    it('should validate FAILED signal', () => {
      const result = OrchestrationSignalSchema.parse({
        status: AgentStatus.FAILED,
        reasoning: 'Goal is unreachable due to missing dependencies.',
      });
      expect(result.status).toBe(AgentStatus.FAILED);
    });

    it('should validate RETRY signal', () => {
      const result = OrchestrationSignalSchema.parse({
        status: AgentStatus.RETRY,
        reasoning: 'Need to retry with updated parameters.',
        nextStep: 'Re-attempt with corrected input.',
      });
      expect(result.status).toBe(AgentStatus.RETRY);
    });

    it('should validate PIVOT signal', () => {
      const result = OrchestrationSignalSchema.parse({
        status: AgentStatus.PIVOT,
        reasoning: 'Current strategy not working, delegating to specialist.',
        nextStep: 'Hand off to QA agent for verification.',
        targetAgentId: AGENT_TYPES.QA,
      });
      expect(result.status).toBe(AgentStatus.PIVOT);
      expect(result.targetAgentId).toBe(AGENT_TYPES.QA);
    });

    it('should validate ESCALATE signal', () => {
      const result = OrchestrationSignalSchema.parse({
        status: AgentStatus.ESCALATE,
        reasoning: 'Ambiguous requirements, need human input.',
        nextStep: 'Should we use REST or GraphQL for the new endpoint?',
      });
      expect(result.status).toBe(AgentStatus.ESCALATE);
    });

    it('should validate CONTINUE signal', () => {
      const result = OrchestrationSignalSchema.parse({
        status: AgentStatus.CONTINUE,
        reasoning: 'Task is still in progress.',
      });
      expect(result.status).toBe(AgentStatus.CONTINUE);
    });

    it('should validate REOPEN signal', () => {
      const result = OrchestrationSignalSchema.parse({
        status: AgentStatus.REOPEN,
        reasoning: 'Previously completed task needs re-evaluation.',
      });
      expect(result.status).toBe(AgentStatus.REOPEN);
    });

    it('should validate with all fields populated', () => {
      const input = {
        status: AgentStatus.PIVOT,
        reasoning: 'Switching strategy after analysis.',
        nextStep: 'Delegate to merger agent.',
        targetAgentId: AGENT_TYPES.MERGER,
        metadata: { priority: 'high', source: 'orchestrator' },
      };
      const result = OrchestrationSignalSchema.parse(input);
      expect(result).toEqual(input);
    });
  });

  describe('invalid signal rejection', () => {
    it('should reject invalid status value', () => {
      expect(() =>
        OrchestrationSignalSchema.parse({ status: 'INVALID', reasoning: 'test' })
      ).toThrow();
    });

    it('should reject missing status', () => {
      expect(() => OrchestrationSignalSchema.parse({ reasoning: 'test' })).toThrow();
    });

    it('should reject missing reasoning', () => {
      expect(() => OrchestrationSignalSchema.parse({ status: AgentStatus.SUCCESS })).toThrow();
    });

    it('should reject empty string reasoning', () => {
      expect(() =>
        OrchestrationSignalSchema.parse({ status: AgentStatus.SUCCESS, reasoning: '' })
      ).toThrow();
    });

    it('should reject extra fields due to strict mode', () => {
      expect(() =>
        OrchestrationSignalSchema.parse({
          ...minimalValid,
          unknownField: 'should fail',
        })
      ).toThrow();
    });

    it('should reject invalid targetAgentId enum', () => {
      expect(() =>
        OrchestrationSignalSchema.parse({
          status: AgentStatus.PIVOT,
          reasoning: 'test',
          targetAgentId: 'nonexistent-agent',
        })
      ).toThrow();
    });

    it('should reject non-string reasoning', () => {
      expect(() =>
        OrchestrationSignalSchema.parse({ status: AgentStatus.SUCCESS, reasoning: 123 })
      ).toThrow();
    });
  });

  describe('required fields', () => {
    it('should require status', () => {
      const { status: _status, ...rest } = minimalValid;
      expect(() => OrchestrationSignalSchema.parse(rest)).toThrow();
    });

    it('should require reasoning', () => {
      const { reasoning: _reasoning, ...rest } = minimalValid;
      expect(() => OrchestrationSignalSchema.parse(rest)).toThrow();
    });
  });

  describe('optional fields', () => {
    it('should make nextStep optional', () => {
      const result = OrchestrationSignalSchema.parse(minimalValid);
      expect(result.nextStep).toBeUndefined();
    });

    it('should make targetAgentId optional', () => {
      const result = OrchestrationSignalSchema.parse(minimalValid);
      expect(result.targetAgentId).toBeUndefined();
    });

    it('should make metadata optional', () => {
      const result = OrchestrationSignalSchema.parse(minimalValid);
      expect(result.metadata).toBeUndefined();
    });

    it('should accept metadata as record', () => {
      const result = OrchestrationSignalSchema.parse({
        ...minimalValid,
        metadata: { key1: 'value1', key2: 42, nested: { a: true } },
      });
      expect(result.metadata).toEqual({ key1: 'value1', key2: 42, nested: { a: true } });
    });

    it('should accept empty metadata object', () => {
      const result = OrchestrationSignalSchema.parse({
        ...minimalValid,
        metadata: {},
      });
      expect(result.metadata).toEqual({});
    });
  });

  describe('all AgentStatus enum values', () => {
    it.each([
      AgentStatus.SUCCESS,
      AgentStatus.FAILED,
      AgentStatus.CONTINUE,
      AgentStatus.REOPEN,
      AgentStatus.RETRY,
      AgentStatus.PIVOT,
      AgentStatus.ESCALATE,
    ])('should accept AgentStatus.%s', (status) => {
      const result = OrchestrationSignalSchema.parse({
        status,
        reasoning: `Testing ${status} status.`,
      });
      expect(result.status).toBe(status);
    });
  });

  describe('all AgentRole enum values for targetAgentId', () => {
    it.each(Object.values(AGENT_TYPES))(
      'should accept AGENT_TYPES.%s as targetAgentId',
      (agentType) => {
        const result = OrchestrationSignalSchema.parse({
          status: AgentStatus.PIVOT,
          reasoning: `Delegating to ${agentType}.`,
          targetAgentId: agentType,
        });
        expect(result.targetAgentId).toBe(agentType);
      }
    );
  });
});

describe('QAFailureFeedbackSchema', () => {
  const validFeedback = {
    failureType: 'LOGIC_ERROR' as const,
    issues: [
      {
        file: 'src/utils.ts',
        line: 42,
        description: 'Function returns undefined for null input',
        expected: 'Should return empty array',
        actual: 'Returns undefined',
      },
    ],
  };

  it('should validate valid feedback', () => {
    const result = QAFailureFeedbackSchema.parse(validFeedback);
    expect(result.failureType).toBe('LOGIC_ERROR');
    expect(result.issues).toHaveLength(1);
  });

  it('should validate all failure types', () => {
    const failureTypes = ['LOGIC_ERROR', 'MISSING_TEST', 'DOCS_DRIFT', 'SECURITY_RISK'] as const;
    for (const ft of failureTypes) {
      const result = QAFailureFeedbackSchema.parse({
        failureType: ft,
        issues: [{ file: 'test.ts', line: 1, description: 'd', expected: 'e', actual: 'a' }],
      });
      expect(result.failureType).toBe(ft);
    }
  });

  it('should validate multiple issues', () => {
    const result = QAFailureFeedbackSchema.parse({
      failureType: 'MISSING_TEST',
      issues: [
        { file: 'a.ts', line: 1, description: 'd1', expected: 'e1', actual: 'a1' },
        { file: 'b.ts', line: 2, description: 'd2', expected: 'e2', actual: 'a2' },
      ],
    });
    expect(result.issues).toHaveLength(2);
  });

  it('should reject missing failureType', () => {
    expect(() => QAFailureFeedbackSchema.parse({ issues: validFeedback.issues })).toThrow();
  });

  it('should reject invalid failureType', () => {
    expect(() =>
      QAFailureFeedbackSchema.parse({
        failureType: 'UNKNOWN_TYPE',
        issues: validFeedback.issues,
      })
    ).toThrow();
  });

  it('should reject missing issues', () => {
    expect(() => QAFailureFeedbackSchema.parse({ failureType: 'LOGIC_ERROR' })).toThrow();
  });

  it('should reject empty issues array', () => {
    expect(() =>
      QAFailureFeedbackSchema.parse({ failureType: 'LOGIC_ERROR', issues: [] })
    ).toThrow();
  });

  it('should reject issue with missing file', () => {
    expect(() =>
      QAFailureFeedbackSchema.parse({
        failureType: 'LOGIC_ERROR',
        issues: [{ line: 1, description: 'd', expected: 'e', actual: 'a' }],
      })
    ).toThrow();
  });

  it('should reject issue with non-positive line number', () => {
    expect(() =>
      QAFailureFeedbackSchema.parse({
        failureType: 'LOGIC_ERROR',
        issues: [{ file: 'test.ts', line: 0, description: 'd', expected: 'e', actual: 'a' }],
      })
    ).toThrow();
  });

  it('should reject issue with missing description', () => {
    expect(() =>
      QAFailureFeedbackSchema.parse({
        failureType: 'LOGIC_ERROR',
        issues: [{ file: 'test.ts', line: 1, expected: 'e', actual: 'a' }],
      })
    ).toThrow();
  });

  it('should reject issue with missing expected', () => {
    expect(() =>
      QAFailureFeedbackSchema.parse({
        failureType: 'LOGIC_ERROR',
        issues: [{ file: 'test.ts', line: 1, description: 'd', actual: 'a' }],
      })
    ).toThrow();
  });

  it('should reject issue with missing actual', () => {
    expect(() =>
      QAFailureFeedbackSchema.parse({
        failureType: 'LOGIC_ERROR',
        issues: [{ file: 'test.ts', line: 1, description: 'd', expected: 'e' }],
      })
    ).toThrow();
  });
});

describe('QAFailureFeedbackSchema', () => {
  const validFeedback = {
    failureType: 'LOGIC_ERROR' as const,
    issues: [
      {
        file: 'src/utils.ts',
        line: 42,
        description: 'Function returns undefined for null input',
        expected: 'Should return empty array',
        actual: 'Returns undefined',
      },
    ],
  };

  it('should validate valid feedback', () => {
    const result = QAFailureFeedbackSchema.parse(validFeedback);
    expect(result.failureType).toBe('LOGIC_ERROR');
    expect(result.issues).toHaveLength(1);
  });

  it('should validate all failure types', () => {
    const failureTypes = ['LOGIC_ERROR', 'MISSING_TEST', 'DOCS_DRIFT', 'SECURITY_RISK'] as const;
    for (const ft of failureTypes) {
      const result = QAFailureFeedbackSchema.parse({
        failureType: ft,
        issues: [{ file: 'test.ts', line: 1, description: 'd', expected: 'e', actual: 'a' }],
      });
      expect(result.failureType).toBe(ft);
    }
  });

  it('should validate multiple issues', () => {
    const result = QAFailureFeedbackSchema.parse({
      failureType: 'MISSING_TEST',
      issues: [
        { file: 'a.ts', line: 1, description: 'd1', expected: 'e1', actual: 'a1' },
        { file: 'b.ts', line: 2, description: 'd2', expected: 'e2', actual: 'a2' },
      ],
    });
    expect(result.issues).toHaveLength(2);
  });

  it('should reject missing failureType', () => {
    expect(() => QAFailureFeedbackSchema.parse({ issues: validFeedback.issues })).toThrow();
  });

  it('should reject invalid failureType', () => {
    expect(() =>
      QAFailureFeedbackSchema.parse({
        failureType: 'UNKNOWN_TYPE',
        issues: validFeedback.issues,
      })
    ).toThrow();
  });

  it('should reject missing issues', () => {
    expect(() => QAFailureFeedbackSchema.parse({ failureType: 'LOGIC_ERROR' })).toThrow();
  });

  it('should reject empty issues array', () => {
    expect(() =>
      QAFailureFeedbackSchema.parse({ failureType: 'LOGIC_ERROR', issues: [] })
    ).toThrow();
  });

  it('should reject issue with missing file', () => {
    expect(() =>
      QAFailureFeedbackSchema.parse({
        failureType: 'LOGIC_ERROR',
        issues: [{ line: 1, description: 'd', expected: 'e', actual: 'a' }],
      })
    ).toThrow();
  });

  it('should reject issue with non-positive line number', () => {
    expect(() =>
      QAFailureFeedbackSchema.parse({
        failureType: 'LOGIC_ERROR',
        issues: [{ file: 'test.ts', line: 0, description: 'd', expected: 'e', actual: 'a' }],
      })
    ).toThrow();
  });

  it('should reject issue with missing description', () => {
    expect(() =>
      QAFailureFeedbackSchema.parse({
        failureType: 'LOGIC_ERROR',
        issues: [{ file: 'test.ts', line: 1, expected: 'e', actual: 'a' }],
      })
    ).toThrow();
  });

  it('should reject issue with missing expected', () => {
    expect(() =>
      QAFailureFeedbackSchema.parse({
        failureType: 'LOGIC_ERROR',
        issues: [{ file: 'test.ts', line: 1, description: 'd', actual: 'a' }],
      })
    ).toThrow();
  });

  it('should reject issue with missing actual', () => {
    expect(() =>
      QAFailureFeedbackSchema.parse({
        failureType: 'LOGIC_ERROR',
        issues: [{ file: 'test.ts', line: 1, description: 'd', expected: 'e' }],
      })
    ).toThrow();
  });
});
