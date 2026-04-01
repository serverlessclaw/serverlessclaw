import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticLoopDetector, resetSemanticLoopDetector } from './semantic-loop-detector';

describe('SemanticLoopDetector', () => {
  let detector: SemanticLoopDetector;

  beforeEach(() => {
    resetSemanticLoopDetector();
    detector = new SemanticLoopDetector({
      windowSize: 5,
      similarityThreshold: 0.85,
      consecutiveThreshold: 2,
    });
  });

  describe('check', () => {
    it('should not detect a loop for unique outputs', () => {
      const result1 = detector.check('session1', 'The weather is sunny today in New York.');
      expect(result1.isLoop).toBe(false);

      const result2 = detector.check('session1', 'I will now analyze the codebase structure.');
      expect(result2.isLoop).toBe(false);

      const result3 = detector.check(
        'session1',
        'Here is a summary of the findings from the analysis.'
      );
      expect(result3.isLoop).toBe(false);
    });

    it('should detect a loop for repeated similar outputs', () => {
      const output =
        'I need to analyze the codebase first before making any changes to the system.';
      detector.check('session1', output);
      detector.check('session1', output);
      const result = detector.check('session1', output);
      expect(result.isLoop).toBe(true);
      expect(result.consecutiveCount).toBeGreaterThanOrEqual(2);
    });

    it('should not detect loop for short outputs', () => {
      detector.check('session1', 'OK');
      detector.check('session1', 'OK');
      const result = detector.check('session1', 'OK');
      expect(result.isLoop).toBe(false);
    });

    it('should handle different sessions independently', () => {
      const output = 'I am analyzing the requirements for the deployment pipeline configuration.';
      detector.check('session1', output);
      detector.check('session2', 'Different content entirely for the second session here.');
      detector.check('session1', output);
      const result = detector.check('session2', 'More unique content for session two analysis.');
      expect(result.isLoop).toBe(false);
    });

    it('should recommend escalation for very long loops', () => {
      const output =
        'The deployment process requires careful analysis of the infrastructure setup.';
      for (let i = 0; i < 5; i++) {
        detector.check('session1', output);
      }
      const result = detector.check('session1', output);
      expect(result.isLoop).toBe(true);
      expect(result.action).toBe('escalate');
    });

    it('should reset loop detection when output changes', () => {
      const loopOutput = 'I need to analyze the codebase before making changes to the system.';
      detector.check('session1', loopOutput);
      detector.check('session1', loopOutput);
      // Break the loop
      detector.check('session1', 'Analysis complete. Moving forward with implementation plan.');
      // New loop would need to restart
      detector.check('session1', 'Something completely different about the project architecture.');
      const result = detector.check('session1', 'Another unique output for the session.');
      expect(result.isLoop).toBe(false);
    });
  });

  describe('clearSession', () => {
    it('should clear session history', () => {
      detector.check('session1', 'Some test output for the detector to analyze.');
      expect(detector.sessionCount).toBe(1);
      detector.clearSession('session1');
      expect(detector.sessionCount).toBe(0);
    });
  });
});
