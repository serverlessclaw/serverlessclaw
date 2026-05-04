import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolvePromptSnippets } from './snippets';
import { ConfigManager } from '../registry/config';

// Mock ConfigManager
vi.mock('../registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn(),
  },
}));

describe('resolvePromptSnippets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return original prompt if no snippets are present', async () => {
    const prompt = 'Hello world';
    const result = await resolvePromptSnippets(prompt);
    expect(result).toBe(prompt);
  });

  it('should resolve a single snippet', async () => {
    vi.mocked(ConfigManager.getRawConfig).mockResolvedValueOnce('resolved content');
    const prompt = 'Snippet: {{snippet:test}}';
    const result = await resolvePromptSnippets(prompt);
    expect(result).toBe('Snippet: resolved content');
    expect(ConfigManager.getRawConfig).toHaveBeenCalledWith('prompt_snippet_test');
  });

  it('should resolve multiple snippets', async () => {
    vi.mocked(ConfigManager.getRawConfig)
      .mockResolvedValueOnce('first content')
      .mockResolvedValueOnce('second content');

    const prompt = '1: {{snippet:one}}, 2: {{snippet:two}}';
    const result = await resolvePromptSnippets(prompt);
    expect(result).toBe('1: first content, 2: second content');
  });

  it('should use cache for repeated snippets in the same prompt', async () => {
    vi.mocked(ConfigManager.getRawConfig).mockResolvedValueOnce('repeated');

    const prompt = 'A: {{snippet:rep}}, B: {{snippet:rep}}';
    const result = await resolvePromptSnippets(prompt);
    expect(result).toBe('A: repeated, B: repeated');
    expect(ConfigManager.getRawConfig).toHaveBeenCalledTimes(1);
  });

  it('should remove snippet tag if content is not found', async () => {
    vi.mocked(ConfigManager.getRawConfig).mockResolvedValueOnce(null);
    const prompt = 'Missing: {{snippet:unknown}}';
    const result = await resolvePromptSnippets(prompt);
    expect(result).toBe('Missing: ');
  });

  it('should handle errors by removing the tag', async () => {
    vi.mocked(ConfigManager.getRawConfig).mockRejectedValueOnce(new Error('DDB failure'));
    const prompt = 'Error: {{snippet:fail}}';
    const result = await resolvePromptSnippets(prompt);
    expect(result).toBe('Error: ');
  });
});
