import { beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.fn();
const info = vi.fn();
const error = vi.fn();

vi.mock('./logger', () => ({
  logger: {
    warn,
    info,
    error,
  },
}));

describe('verifyEventRoutingConfiguration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not report GAP for routed/eventbridge-only enum values', async () => {
    const { verifyEventRoutingConfiguration } = await import('./event-routing');

    const mismatches = verifyEventRoutingConfiguration();

    expect(mismatches).toEqual([]);

    const historicalFalsePositives = [
      'qa_task',
      'cognition_reflector_task',
      'strategic_planner_task',
      'strategic_tie_break',
      'report_back',
      'system_audit_trigger',
      'dashboard_failure_detected',
      'dlq_route',
    ];

    for (const eventType of historicalFalsePositives) {
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining(`GAP: ${eventType}`));
    }

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('GAP: qa_task'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('GAP: dlq_route'));
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('Configuration verified - EventBridge-only events correctly excluded')
    );
  });
});
