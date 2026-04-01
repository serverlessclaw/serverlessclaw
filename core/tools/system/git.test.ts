import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-codebuild', () => {
  class MockStartBuildCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class MockCodeBuildClient {
    send = mockSend;
  }
  return {
    CodeBuildClient: MockCodeBuildClient,
    StartBuildCommand: MockStartBuildCommand,
  };
});

vi.mock('sst', () => ({
  Resource: {
    DeployProject: { name: 'test-deploy-project' },
    Deployer: { name: 'test-deployer' },
  },
}));

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../lib/utils/error', () => ({
  formatErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

vi.mock('../../lib/constants', () => ({
  SYSTEM: { DEFAULT_RECURSION_LIMIT: 15 },
  DYNAMO_KEYS: { RECURSION_LIMIT: 'recursion_limit' },
  CONFIG_KEYS: { ACTIVE_PROVIDER: 'active_provider', ACTIVE_MODEL: 'active_model' },
}));

vi.mock('../../lib/types/index', () => ({
  EventType: { CONTINUATION_TASK: 'continuation_task' },
}));

vi.mock('../../lib/types/constants', () => ({
  TraceType: { COLLABORATION_STARTED: 'collaboration_started' },
}));

import { triggerTrunkSync } from './git';

describe('triggerTrunkSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct tool definition', () => {
    expect(triggerTrunkSync.name).toBe('triggerTrunkSync');
    expect(triggerTrunkSync.description).toBeDefined();
    expect(triggerTrunkSync.parameters).toBeDefined();
  });

  it('requires commitMessage parameter', () => {
    expect(triggerTrunkSync.parameters.required).toContain('commitMessage');
  });

  it('triggers trunk sync successfully', async () => {
    mockSend.mockResolvedValue({ build: { id: 'build-123' } });

    const result = await triggerTrunkSync.execute({ commitMessage: 'Sync with main' });

    expect(result).toContain('Trunk Sync triggered successfully');
    expect(result).toContain('build-123');
    expect(result).toContain('Sync with main');
  });

  it('passes correct environment variables to CodeBuild', async () => {
    mockSend.mockResolvedValue({ build: { id: 'build-456' } });

    await triggerTrunkSync.execute({ commitMessage: 'test commit' });

    expect(mockSend).toHaveBeenCalled();
  });

  it('returns failure when deploy project is not linked', async () => {
    const sst = await import('sst');
    const r = sst.Resource as unknown as Record<string, unknown>;
    const origDeployProject = r.DeployProject;
    const origDeployer = r.Deployer;
    (r as any).DeployProject = undefined;
    (r as any).Deployer = undefined;

    const result = await triggerTrunkSync.execute({ commitMessage: 'test' });

    expect(result).toContain('FAILED');
    expect(result).toContain('Deploy project not linked');

    (r as any).DeployProject = origDeployProject;
    (r as any).Deployer = origDeployer;
  });

  it('uses Deployer.name as fallback when DeployProject is missing', async () => {
    mockSend.mockResolvedValue({ build: { id: 'build-789' } });
    const sst = await import('sst');
    const r = sst.Resource as unknown as Record<string, unknown>;
    const orig = r.DeployProject;
    (r as any).DeployProject = undefined;

    const result = await triggerTrunkSync.execute({ commitMessage: 'fallback test' });

    expect(result).toContain('build-789');

    (r as any).DeployProject = orig;
  });

  it('handles CodeBuild send failure gracefully', async () => {
    mockSend.mockRejectedValue(new Error('CodeBuild is unavailable'));

    const result = await triggerTrunkSync.execute({ commitMessage: 'fail test' });

    expect(result).toContain('Failed to trigger Trunk Sync');
    expect(result).toContain('CodeBuild is unavailable');
  });

  it('handles non-Error exceptions', async () => {
    mockSend.mockRejectedValue('network timeout');

    const result = await triggerTrunkSync.execute({ commitMessage: 'non-error' });

    expect(result).toContain('Failed to trigger Trunk Sync');
  });

  it('includes commit message in success response', async () => {
    mockSend.mockResolvedValue({ build: { id: 'b-1' } });

    const result = await triggerTrunkSync.execute({
      commitMessage: 'feat: add new feature',
    });

    expect(result).toContain('Reasoning: feat: add new feature');
  });

  it('spreads schema properties into the tool definition', () => {
    expect(triggerTrunkSync).toHaveProperty('name');
    expect(triggerTrunkSync).toHaveProperty('description');
    expect(triggerTrunkSync).toHaveProperty('parameters');
    expect(triggerTrunkSync).toHaveProperty('execute');
  });
});
