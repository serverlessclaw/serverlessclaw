import { describe, it, expect, beforeEach } from 'vitest';
import { SafetyBase } from './safety-base';

describe('SafetyBase', () => {
  let safetyBase: SafetyBase;

  beforeEach(() => {
    safetyBase = new SafetyBase();
  });

  describe('Class C / Class D Action Classification', () => {
    describe('isClassCAction', () => {
      it('should identify Class C actions (approvable)', () => {
        expect(safetyBase.isClassCAction('iam_change')).toBe(true);
        expect(safetyBase.isClassCAction('infra_topology')).toBe(true);
        expect(safetyBase.isClassCAction('deployment')).toBe(true);
        expect(safetyBase.isClassCAction('security_guardrail')).toBe(true);
        expect(safetyBase.isClassCAction('memory_retention')).toBe(true);
        expect(safetyBase.isClassCAction('tool_permission')).toBe(true);
        expect(safetyBase.isClassCAction('code_change')).toBe(true);
        expect(safetyBase.isClassCAction('audit_override')).toBe(true);
      });

      it('should be case insensitive', () => {
        expect(safetyBase.isClassCAction('IAM_CHANGE')).toBe(true);
        expect(safetyBase.isClassCAction('Deployment')).toBe(true);
      });

      it('should return false for Class D actions', () => {
        expect(safetyBase.isClassCAction('trust_manipulation')).toBe(false);
        expect(safetyBase.isClassCAction('mode_shift')).toBe(false);
        expect(safetyBase.isClassCAction('policy_core_override')).toBe(false);
      });

      it('should return false for non-sensitive actions', () => {
        expect(safetyBase.isClassCAction('file_read')).toBe(false);
        expect(safetyBase.isClassCAction('prompt_tuning')).toBe(false);
      });
    });

    describe('isClassDAction', () => {
      it('should identify Class D actions (blocked)', () => {
        expect(safetyBase.isClassDAction('trust_manipulation')).toBe(true);
        expect(safetyBase.isClassDAction('mode_shift')).toBe(true);
        expect(safetyBase.isClassDAction('policy_core_override')).toBe(true);
      });

      it('should return false for Class C actions', () => {
        expect(safetyBase.isClassDAction('deployment')).toBe(false);
        expect(safetyBase.isClassDAction('iam_change')).toBe(false);
      });
    });

    describe('getClassCActions / getClassDActions', () => {
      it('should return array of registered actions', () => {
        const classCActions = SafetyBase.getClassCActions();
        expect(classCActions).toContain('iam_change');
        expect(classCActions).toContain('deployment');

        const classDActions = SafetyBase.getClassDActions();
        expect(classDActions).toContain('trust_manipulation');
        expect(classDActions).toContain('mode_shift');
      });
    });
  });

  describe('matchesGlob', () => {
    it('should match exact paths', () => {
      expect(safetyBase.matchesGlob('package.json', 'package.json')).toBe(true);
    });

    it('should match wildcards', () => {
      expect(safetyBase.matchesGlob('core/lib/foo.ts', 'core/**')).toBe(true);
      expect(safetyBase.matchesGlob('core/lib/foo.ts', 'core/lib/*.ts')).toBe(true);
      expect(safetyBase.matchesGlob('core/lib/foo.ts', '*.ts')).toBe(false);
    });

    it('should match double wildcards', () => {
      expect(safetyBase.matchesGlob('a/b/c/file.ts', '**/*.ts')).toBe(true);
      expect(safetyBase.matchesGlob('a/b/c/file.ts', 'a/**/*.ts')).toBe(true);
    });
  });
});
