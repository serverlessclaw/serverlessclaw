import { describe, it, expect } from 'vitest';
import {
  TraceType,
  TraceStatus,
  OptimizationPolicy,
  BuildStatus,
  ParallelTaskStatus,
  HealthSeverity,
} from './constants';

describe('TraceType', () => {
  it('should have expected values', () => {
    expect(TraceType.LLM_CALL).toBe('llm_call');
    expect(TraceType.LLM_RESPONSE).toBe('llm_response');
    expect(TraceType.TOOL_CALL).toBe('tool_call');
    expect(TraceType.TOOL_RESPONSE).toBe('tool_result');
    expect(TraceType.REFLECT).toBe('reflect');
    expect(TraceType.EMIT).toBe('emit');
    expect(TraceType.BRIDGE).toBe('bridge');
    expect(TraceType.ERROR).toBe('error');
  });

  it('should have unique values', () => {
    const values = Object.values(TraceType);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('TraceStatus', () => {
  it('should have expected values', () => {
    expect(TraceStatus.STARTED).toBe('started');
    expect(TraceStatus.COMPLETED).toBe('completed');
    expect(TraceStatus.FAILED).toBe('failed');
    expect(TraceStatus.PAUSED).toBe('paused');
  });

  it('should have unique values', () => {
    const values = Object.values(TraceStatus);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('OptimizationPolicy', () => {
  it('should have expected values', () => {
    expect(OptimizationPolicy.AGGRESSIVE).toBe('aggressive');
    expect(OptimizationPolicy.CONSERVATIVE).toBe('conservative');
    expect(OptimizationPolicy.BALANCED).toBe('balanced');
  });
});

describe('BuildStatus', () => {
  it('should have expected values', () => {
    expect(BuildStatus.SUCCEEDED).toBe('SUCCEEDED');
    expect(BuildStatus.FAILED).toBe('FAILED');
    expect(BuildStatus.STOPPED).toBe('STOPPED');
    expect(BuildStatus.TIMED_OUT).toBe('TIMED_OUT');
    expect(BuildStatus.FAULT).toBe('FAULT');
    expect(BuildStatus.IN_PROGRESS).toBe('IN_PROGRESS');
  });

  it('should have unique values', () => {
    const values = Object.values(BuildStatus);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('ParallelTaskStatus', () => {
  it('should have expected values', () => {
    expect(ParallelTaskStatus.SUCCESS).toBe('success');
    expect(ParallelTaskStatus.PARTIAL).toBe('partial');
    expect(ParallelTaskStatus.FAILED).toBe('failed');
  });
});

describe('HealthSeverity', () => {
  it('should have expected values', () => {
    expect(HealthSeverity.LOW).toBe('low');
    expect(HealthSeverity.MEDIUM).toBe('medium');
    expect(HealthSeverity.HIGH).toBe('high');
    expect(HealthSeverity.CRITICAL).toBe('critical');
  });

  it('should have escalating severity order', () => {
    const levels = [
      HealthSeverity.LOW,
      HealthSeverity.MEDIUM,
      HealthSeverity.HIGH,
      HealthSeverity.CRITICAL,
    ];
    expect(levels).toHaveLength(4);
  });
});
