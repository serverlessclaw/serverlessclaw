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

  describe('AgentRunnerSubscriber', () => {
    it('uses prefix matching for dynamic tasks', () => {
      const agentRunnerMatch = agentsSource.match(
        /bus\.subscribe\('AgentRunnerSubscriber'[\s\S]*?prefix:\s*'dynamic_'/m
      );
      expect(agentRunnerMatch).toBeTruthy();
    });
  });

  describe('Enterprise Scale Filtering [Phase 15]', () => {
    it('applies workspaceId existence filter to high-power multiplexer', () => {
      const match = agentsSource.match(
        /bus\.subscribe\('HighPowerSubscriber'[\s\S]*?\.\.\.tenantFilter/m
      );
      expect(match).toBeTruthy();
    });

    it('applies workspaceId existence filter to standard multiplexer', () => {
      const match = agentsSource.match(
        /bus\.subscribe\('StandardSubscriber'[\s\S]*?\.\.\.tenantFilter/m
      );
      expect(match).toBeTruthy();
    });

    it('applies workspaceId existence filter to light multiplexer', () => {
      const match = agentsSource.match(
        /bus\.subscribe\('LightSubscriber'[\s\S]*?\.\.\.tenantFilter/m
      );
      expect(match).toBeTruthy();
    });

    it('applies workspaceId existence filter to system event handler', () => {
      const match = agentsSource.match(
        /bus\.subscribe\('EventHandlerSubscriber'[\s\S]*?\.\.\.tenantFilter/m
      );
      expect(match).toBeTruthy();
    });
  });
});
