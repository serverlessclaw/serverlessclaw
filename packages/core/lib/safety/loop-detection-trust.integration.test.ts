import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSemanticLoopDetector,
  resetSemanticLoopDetector,
} from '../safety/semantic-loop-detector';

describe('Loop Detection Trust Integration', () => {
  beforeEach(() => {
    resetSemanticLoopDetector();
  });

  it('should penalize trust when a reasoning loop is detected in the execution loop', async () => {
    const sessionId = 'test-session-' + Date.now();
    const loopContent = 'I am doing the same thing again. I am doing the same thing again.';

    const loopDetector = getSemanticLoopDetector();

    loopDetector.check(sessionId, loopContent);
    loopDetector.check(sessionId, loopContent);
    loopDetector.check(sessionId, loopContent);

    const loopResult = loopDetector.check(sessionId, loopContent);
    expect(loopResult.consecutiveCount).toBeGreaterThanOrEqual(3);
  });
});
