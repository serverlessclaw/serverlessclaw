import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CLARIFICATION_POLICY,
  CRITICAL_TASK_POLICY,
  BACKGROUND_TASK_POLICY,
  ADMIN_ESCALATION_POLICY,
  DEFAULT_ESCALATION_POLICIES,
  PRIORITY_TO_POLICY_MAP,
} from './escalation-defaults';
import {
  EscalationPolicy,
  EscalationLevel,
  EscalationChannel,
  EscalationPriority,
} from '../types/escalation';

const ALL_POLICIES: [string, EscalationPolicy][] = [
  ['DEFAULT_CLARIFICATION_POLICY', DEFAULT_CLARIFICATION_POLICY],
  ['CRITICAL_TASK_POLICY', CRITICAL_TASK_POLICY],
  ['BACKGROUND_TASK_POLICY', BACKGROUND_TASK_POLICY],
  ['ADMIN_ESCALATION_POLICY', ADMIN_ESCALATION_POLICY],
];

function validatePolicyStructure(policy: EscalationPolicy) {
  expect(typeof policy.id).toBe('string');
  expect(policy.id.length).toBeGreaterThan(0);
  expect(typeof policy.name).toBe('string');
  expect(policy.name.length).toBeGreaterThan(0);
  expect(typeof policy.description).toBe('string');
  expect(policy.description!.length).toBeGreaterThan(0);
  expect(Object.values(EscalationPriority)).toContain(policy.priority);
  expect(Array.isArray(policy.levels)).toBe(true);
  expect(policy.levels.length).toBeGreaterThan(0);
  expect(['fail', 'continue_with_defaults', 'escalate_to_admin']).toContain(policy.finalAction);
  expect(typeof policy.enabled).toBe('boolean');
  expect(typeof policy.createdAt).toBe('number');
  expect(typeof policy.updatedAt).toBe('number');
}

function validateLevelStructure(level: EscalationLevel) {
  expect(typeof level.level).toBe('number');
  expect(level.level).toBeGreaterThan(0);
  expect(typeof level.timeoutMs).toBe('number');
  expect(level.timeoutMs).toBeGreaterThan(0);
  expect(Array.isArray(level.channels)).toBe(true);
  expect(level.channels.length).toBeGreaterThan(0);
  for (const ch of level.channels) {
    expect(Object.values(EscalationChannel)).toContain(ch);
  }
  expect(typeof level.continueOnFailure).toBe('boolean');
  if (level.messageTemplate !== undefined) {
    expect(typeof level.messageTemplate).toBe('string');
    expect(level.messageTemplate.length).toBeGreaterThan(0);
  }
}

describe('escalation-defaults', () => {
  describe('policy structure validation', () => {
    it.each(ALL_POLICIES)('%s has all required fields', (_name, policy) => {
      validatePolicyStructure(policy);
    });

    it.each(ALL_POLICIES)('%s levels have correct structure', (_name, policy) => {
      for (const level of policy.levels) {
        validateLevelStructure(level);
      }
    });

    it.each(ALL_POLICIES)('%s levels are sequential starting at 1', (_name, policy) => {
      for (let i = 0; i < policy.levels.length; i++) {
        expect(policy.levels[i].level).toBe(i + 1);
      }
    });

    it.each(ALL_POLICIES)('%s only the last level has continueOnFailure=false', (_name, policy) => {
      for (let i = 0; i < policy.levels.length - 1; i++) {
        expect(policy.levels[i].continueOnFailure).toBe(true);
      }
      expect(policy.levels[policy.levels.length - 1].continueOnFailure).toBe(false);
    });

    it.each(ALL_POLICIES)('%s channels expand or stay same at each level', (_name, policy) => {
      for (let i = 1; i < policy.levels.length; i++) {
        expect(policy.levels[i].channels.length).toBeGreaterThanOrEqual(
          policy.levels[i - 1].channels.length
        );
      }
    });
  });

  describe('DEFAULT_CLARIFICATION_POLICY', () => {
    it('has correct id and priority', () => {
      expect(DEFAULT_CLARIFICATION_POLICY.id).toBe('default-clarification');
      expect(DEFAULT_CLARIFICATION_POLICY.priority).toBe(EscalationPriority.MEDIUM);
      expect(DEFAULT_CLARIFICATION_POLICY.finalAction).toBe('fail');
    });

    it('has 3 escalation levels', () => {
      expect(DEFAULT_CLARIFICATION_POLICY.levels).toHaveLength(3);
    });

    it('has increasing timeouts', () => {
      const timeouts = DEFAULT_CLARIFICATION_POLICY.levels.map((l) => l.timeoutMs);
      for (let i = 1; i < timeouts.length; i++) {
        expect(timeouts[i]).toBeGreaterThan(timeouts[i - 1]);
      }
    });

    it('level 1 timeout is 5 minutes', () => {
      expect(DEFAULT_CLARIFICATION_POLICY.levels[0].timeoutMs).toBe(300000);
    });

    it('level 2 timeout is 10 minutes', () => {
      expect(DEFAULT_CLARIFICATION_POLICY.levels[1].timeoutMs).toBe(600000);
    });

    it('level 3 timeout is 15 minutes', () => {
      expect(DEFAULT_CLARIFICATION_POLICY.levels[2].timeoutMs).toBe(900000);
    });

    it('starts with TELEGRAM only at level 1', () => {
      expect(DEFAULT_CLARIFICATION_POLICY.levels[0].channels).toEqual([EscalationChannel.TELEGRAM]);
    });

    it('adds DASHBOARD at level 2', () => {
      expect(DEFAULT_CLARIFICATION_POLICY.levels[1].channels).toContain(EscalationChannel.TELEGRAM);
      expect(DEFAULT_CLARIFICATION_POLICY.levels[1].channels).toContain(
        EscalationChannel.DASHBOARD
      );
    });

    it('adds EMAIL at level 3', () => {
      expect(DEFAULT_CLARIFICATION_POLICY.levels[2].channels).toContain(EscalationChannel.EMAIL);
    });

    it('is enabled', () => {
      expect(DEFAULT_CLARIFICATION_POLICY.enabled).toBe(true);
    });

    it('message templates contain {{question}} placeholder', () => {
      for (const level of DEFAULT_CLARIFICATION_POLICY.levels) {
        expect(level.messageTemplate).toContain('{{question}}');
      }
    });
  });

  describe('CRITICAL_TASK_POLICY', () => {
    it('has correct id and priority', () => {
      expect(CRITICAL_TASK_POLICY.id).toBe('critical-task');
      expect(CRITICAL_TASK_POLICY.priority).toBe(EscalationPriority.CRITICAL);
      expect(CRITICAL_TASK_POLICY.finalAction).toBe('fail');
    });

    it('has 2 escalation levels', () => {
      expect(CRITICAL_TASK_POLICY.levels).toHaveLength(2);
    });

    it('level 1 timeout is 2 minutes', () => {
      expect(CRITICAL_TASK_POLICY.levels[0].timeoutMs).toBe(120000);
    });

    it('level 2 timeout is 5 minutes', () => {
      expect(CRITICAL_TASK_POLICY.levels[1].timeoutMs).toBe(300000);
    });

    it('level 2 includes all 4 channels', () => {
      const channels = CRITICAL_TASK_POLICY.levels[1].channels;
      expect(channels).toContain(EscalationChannel.TELEGRAM);
      expect(channels).toContain(EscalationChannel.DASHBOARD);
      expect(channels).toContain(EscalationChannel.EMAIL);
      expect(channels).toContain(EscalationChannel.SMS);
      expect(channels).toHaveLength(4);
    });

    it('has shorter timeouts than DEFAULT_CLARIFICATION_POLICY', () => {
      expect(CRITICAL_TASK_POLICY.levels[0].timeoutMs).toBeLessThan(
        DEFAULT_CLARIFICATION_POLICY.levels[0].timeoutMs
      );
    });
  });

  describe('BACKGROUND_TASK_POLICY', () => {
    it('has correct id and priority', () => {
      expect(BACKGROUND_TASK_POLICY.id).toBe('background-task');
      expect(BACKGROUND_TASK_POLICY.priority).toBe(EscalationPriority.LOW);
      expect(BACKGROUND_TASK_POLICY.finalAction).toBe('continue_with_defaults');
    });

    it('has 2 escalation levels', () => {
      expect(BACKGROUND_TASK_POLICY.levels).toHaveLength(2);
    });

    it('level 1 timeout is 30 minutes', () => {
      expect(BACKGROUND_TASK_POLICY.levels[0].timeoutMs).toBe(1800000);
    });

    it('level 2 timeout is 1 hour', () => {
      expect(BACKGROUND_TASK_POLICY.levels[1].timeoutMs).toBe(3600000);
    });

    it('level 1 starts with DASHBOARD only', () => {
      expect(BACKGROUND_TASK_POLICY.levels[0].channels).toEqual([EscalationChannel.DASHBOARD]);
    });

    it('has longer timeouts than DEFAULT_CLARIFICATION_POLICY', () => {
      expect(BACKGROUND_TASK_POLICY.levels[0].timeoutMs).toBeGreaterThan(
        DEFAULT_CLARIFICATION_POLICY.levels[2].timeoutMs
      );
    });
  });

  describe('ADMIN_ESCALATION_POLICY', () => {
    it('has correct id and priority', () => {
      expect(ADMIN_ESCALATION_POLICY.id).toBe('admin-escalation');
      expect(ADMIN_ESCALATION_POLICY.priority).toBe(EscalationPriority.HIGH);
      expect(ADMIN_ESCALATION_POLICY.finalAction).toBe('escalate_to_admin');
    });

    it('has 3 escalation levels', () => {
      expect(ADMIN_ESCALATION_POLICY.levels).toHaveLength(3);
    });

    it('has adminUserIds field', () => {
      expect(ADMIN_ESCALATION_POLICY).toHaveProperty('adminUserIds');
      expect(Array.isArray(ADMIN_ESCALATION_POLICY.adminUserIds)).toBe(true);
    });

    it('level 1 timeout is 5 minutes', () => {
      expect(ADMIN_ESCALATION_POLICY.levels[0].timeoutMs).toBe(300000);
    });

    it('level 2 timeout is 10 minutes', () => {
      expect(ADMIN_ESCALATION_POLICY.levels[1].timeoutMs).toBe(600000);
    });

    it('level 3 timeout is 15 minutes', () => {
      expect(ADMIN_ESCALATION_POLICY.levels[2].timeoutMs).toBe(900000);
    });

    it('has increasing timeouts', () => {
      const timeouts = ADMIN_ESCALATION_POLICY.levels.map((l) => l.timeoutMs);
      for (let i = 1; i < timeouts.length; i++) {
        expect(timeouts[i]).toBeGreaterThan(timeouts[i - 1]);
      }
    });
  });

  describe('DEFAULT_ESCALATION_POLICIES array', () => {
    it('contains exactly 4 policies', () => {
      expect(DEFAULT_ESCALATION_POLICIES).toHaveLength(4);
    });

    it('contains all individual policies', () => {
      expect(DEFAULT_ESCALATION_POLICIES).toContain(DEFAULT_CLARIFICATION_POLICY);
      expect(DEFAULT_ESCALATION_POLICIES).toContain(CRITICAL_TASK_POLICY);
      expect(DEFAULT_ESCALATION_POLICIES).toContain(BACKGROUND_TASK_POLICY);
      expect(DEFAULT_ESCALATION_POLICIES).toContain(ADMIN_ESCALATION_POLICY);
    });

    it('has unique policy ids', () => {
      const ids = DEFAULT_ESCALATION_POLICIES.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('covers all escalation priorities', () => {
      const priorities = new Set(DEFAULT_ESCALATION_POLICIES.map((p) => p.priority));
      expect(priorities).toContain(EscalationPriority.LOW);
      expect(priorities).toContain(EscalationPriority.MEDIUM);
      expect(priorities).toContain(EscalationPriority.HIGH);
      expect(priorities).toContain(EscalationPriority.CRITICAL);
    });
  });

  describe('PRIORITY_TO_POLICY_MAP', () => {
    it('maps LOW to background-task', () => {
      expect(PRIORITY_TO_POLICY_MAP[EscalationPriority.LOW]).toBe('background-task');
    });

    it('maps MEDIUM to default-clarification', () => {
      expect(PRIORITY_TO_POLICY_MAP[EscalationPriority.MEDIUM]).toBe('default-clarification');
    });

    it('maps HIGH to admin-escalation', () => {
      expect(PRIORITY_TO_POLICY_MAP[EscalationPriority.HIGH]).toBe('admin-escalation');
    });

    it('maps CRITICAL to critical-task', () => {
      expect(PRIORITY_TO_POLICY_MAP[EscalationPriority.CRITICAL]).toBe('critical-task');
    });

    it('has an entry for every priority', () => {
      const allPriorities = Object.values(EscalationPriority);
      for (const p of allPriorities) {
        expect(PRIORITY_TO_POLICY_MAP).toHaveProperty(p);
        expect(typeof PRIORITY_TO_POLICY_MAP[p]).toBe('string');
      }
    });

    it('map values correspond to actual policy ids', () => {
      for (const policyId of Object.values(PRIORITY_TO_POLICY_MAP)) {
        const match = DEFAULT_ESCALATION_POLICIES.find((p) => p.id === policyId);
        expect(match).toBeDefined();
      }
    });

    it('each map value matches the policy priority', () => {
      for (const [priority, policyId] of Object.entries(PRIORITY_TO_POLICY_MAP)) {
        const policy = DEFAULT_ESCALATION_POLICIES.find((p) => p.id === policyId);
        expect(policy!.priority).toBe(priority);
      }
    });
  });

  describe('timeout reasonableness', () => {
    it('all timeouts are at least 1 minute', () => {
      for (const [, policy] of ALL_POLICIES) {
        for (const level of policy.levels) {
          expect(level.timeoutMs).toBeGreaterThanOrEqual(120000);
        }
      }
    });

    it('all timeouts are at most 2 hours', () => {
      for (const [, policy] of ALL_POLICIES) {
        for (const level of policy.levels) {
          expect(level.timeoutMs).toBeLessThanOrEqual(7200000);
        }
      }
    });

    it('timeouts increase within each policy', () => {
      for (const [, policy] of ALL_POLICIES) {
        for (let i = 1; i < policy.levels.length; i++) {
          expect(policy.levels[i].timeoutMs).toBeGreaterThan(policy.levels[i - 1].timeoutMs);
        }
      }
    });
  });

  describe('unique policy ids', () => {
    it('all policy ids are unique', () => {
      const ids = ALL_POLICIES.map(([, p]) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
