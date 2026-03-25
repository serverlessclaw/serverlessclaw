import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const agentsSource = readFileSync(resolve(__dirname, 'agents.ts'), 'utf-8');

describe('EventBridge routing contracts', () => {
  describe('RealtimeBridgeSubscriber', () => {
    it('excludes EventType.CHUNK from the subscriber pattern to avoid double publishing', () => {
      // Extract the RealtimeBridgeSubscriber block
      const bridgeMatch = agentsSource.match(
        /bus\.subscribe\('RealtimeBridgeSubscriber'[\s\S]*?pattern:\s*\{[\s\S]*?detailType:\s*\[([\s\S]*?)\]/m
      );
      expect(bridgeMatch).toBeTruthy();
      const detailTypes = bridgeMatch![1];
      expect(detailTypes).not.toContain('EventType.CHUNK');
    });

    it('includes OUTBOUND_MESSAGE for dashboard notifications', () => {
      const bridgeMatch = agentsSource.match(
        /bus\.subscribe\('RealtimeBridgeSubscriber'[\s\S]*?pattern:\s*\{[\s\S]*?detailType:\s*\[([\s\S]*?)\]/m
      );
      expect(bridgeMatch).toBeTruthy();
      expect(bridgeMatch![1]).toContain('EventType.OUTBOUND_MESSAGE');
    });
  });

  describe('WorkerAgentSubscriber', () => {
    it('excludes EventType.CHUNK from the anything-but list', () => {
      const workerMatch = agentsSource.match(
        /bus\.subscribe\('WorkerAgentSubscriber'[\s\S]*?'anything-but':\s*\[([\s\S]*?)\]/m
      );
      expect(workerMatch).toBeTruthy();
      const exclusions = workerMatch![1];
      expect(exclusions).toContain('EventType.CHUNK');
    });

    it('excludes all known event types from the anything-but list', () => {
      const workerMatch = agentsSource.match(
        /bus\.subscribe\('WorkerAgentSubscriber'[\s\S]*?'anything-but':\s*\[([\s\S]*?)\]/m
      );
      expect(workerMatch).toBeTruthy();
      const exclusions = workerMatch![1];

      // These must be excluded so they route to dedicated handlers instead
      const requiredExclusions = [
        'EventType.CHUNK',
        'EventType.OUTBOUND_MESSAGE',
        'EventType.TASK_COMPLETED',
        'EventType.TASK_FAILED',
        'EventType.CODER_TASK',
      ];
      for (const evt of requiredExclusions) {
        expect(exclusions).toContain(evt);
      }
    });
  });
});
