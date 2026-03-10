import { describe, it, expect, vi } from 'vitest';
import { tools, getToolDefinitions } from '../tools/index';

// Mock DynamoDB for tool execution tests
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({
      send: vi.fn().mockResolvedValue({}),
    }),
  },
  GetCommand: vi.fn(),
  PutCommand: vi.fn(),
  UpdateCommand: vi.fn(),
}));

vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'MockConfigTable' },
    MemoryTable: { name: 'MockMemoryTable' },
    AgentBus: { name: 'MockBus' },
    Deployer: { name: 'MockDeployer' },
    StagingBucket: { name: 'MockBucket' },
  },
}));

describe('Tools', () => {
  describe('switch_model', () => {
    it('should return success message when switching model', async () => {
      const result = await tools.switch_model.execute({
        provider: 'bedrock',
        model: 'anthropic.claude-3-sonnet',
      });
      expect(result).toContain('Successfully switched to bedrock');
      expect(result).toContain('anthropic.claude-3-sonnet');
    });
  });

  describe('calculator', () => {
    it('should evaluate 2 + 2 correctly', async () => {
      const result = await tools.calculator.execute({ expression: '2 + 2' });
      expect(result).toBe('Result: 4');
    });

    it('should evaluate complex expressions', async () => {
      const result = await tools.calculator.execute({ expression: '(10 + 5) * 2 / 3' });
      expect(result).toBe('Result: 10');
    });

    it('should return error for invalid expressions', async () => {
      const result = await tools.calculator.execute({ expression: 'invalid + expression' });
      expect(result).toContain('Error:');
    });
  });

  describe('get_weather', () => {
    it('should return mock weather data', async () => {
      const result = await tools.get_weather.execute({ location: 'Sydney, AU' });
      expect(result).toBe('The weather in Sydney, AU is sunny and 72°F.');
    });
  });

  describe('getToolDefinitions', () => {
    it('should return formatted tool definitions', () => {
      const definitions = getToolDefinitions();
      expect(definitions).toHaveLength(13);

      const names = definitions.map((d) => d.function.name);
      expect(names).toContain('calculator');
      expect(names).toContain('get_weather');
      expect(names).toContain('dispatch_task');
      expect(names).toContain('file_write');
      expect(names).toContain('trigger_deployment');
      expect(names).toContain('validate_code');
      expect(names).toContain('check_health');
      expect(names).toContain('trigger_rollback');
      expect(names).toContain('stage_changes');
      expect(names).toContain('switch_model');
      expect(names).toContain('run_tests');
      expect(names).toContain('manage_agent_tools');
    });
  });
});
