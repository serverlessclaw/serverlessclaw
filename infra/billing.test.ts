import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

class MockSnsTopic {
  arn = 'arn:aws:sns:region:123456789012:topic';
  constructor(public name: string, public args: any) {}
}

class MockBudget {
  constructor(public name: string, public args: any) {}
}

const mockSnsTopic = vi.fn(function (name, args) {
  return new MockSnsTopic(name, args);
});
const mockBudget = vi.fn(function (name, args) {
  return new MockBudget(name, args);
});

vi.stubGlobal('sst', {
  aws: {
    SnsTopic: mockSnsTopic,
  },
});

vi.stubGlobal('aws', {
  budgets: {
    Budget: mockBudget,
  },
});

vi.stubGlobal('$app', {
  stage: 'prod',
});

// --- Imports ---
import { createBilling } from './billing';

describe('Billing Infrastructure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BILLING_ALERT_EMAIL = 'test@example.com';
    process.env.BILLING_DAILY_LIMIT = '1';
  });

  it('should create a budget with the correct absolute thresholds even if limit is lower', () => {
    createBilling();

    expect(mockBudget).toHaveBeenCalled();
    const budgetArgs = mockBudget.mock.calls[0][1] as any;

    expect(budgetArgs.budgetType).toBe('COST');
    expect(budgetArgs.limitAmount).toBe('1');
    expect(budgetArgs.timeUnit).toBe('DAILY');

    const expectedThresholds = [1, 4, 16, 64, 256];
    expect(budgetArgs.notifications).toHaveLength(expectedThresholds.length);

    expectedThresholds.forEach((t, i) => {
      expect(budgetArgs.notifications[i].threshold).toBe(t);
      expect(budgetArgs.notifications[i].thresholdType).toBe('ABSOLUTE_VALUE');
    });
  });

  it('should not create billing resources if stage is not prod', () => {
    vi.stubGlobal('$app', { stage: 'dev' });
    const result = createBilling();
    expect(result).toEqual({});
    expect(mockBudget).not.toHaveBeenCalled();
  });
});
