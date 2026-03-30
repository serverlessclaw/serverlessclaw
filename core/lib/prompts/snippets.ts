import { ConfigManager } from '../registry/config';
import { logger } from '../logger';

/**
 * Resolves prompt snippets in the form of {{snippet:name}} within a prompt string.
 * Snippets are fetched from the ConfigManager (DynamoDB) using the key 'prompt_snippet_<name>'.
 *
 * @param prompt The prompt string containing snippet placeholders.
 * @returns The prompt with all detected snippets resolved.
 */
export async function resolvePromptSnippets(prompt: string): Promise<string> {
  if (!prompt || !prompt.includes('{{snippet:')) {
    return prompt;
  }

  // Find all snippet placeholders: {{snippet:name}}
  const snippetRegex = /{{snippet:([\w-]+)}}/g;
  const matches = [...prompt.matchAll(snippetRegex)];

  if (matches.length === 0) {
    return prompt;
  }

  let resolvedPrompt = prompt;

  // Track resolved snippets to avoid redundant fetches in the same prompt
  const resolvedCache: Record<string, string> = {};

  for (const match of matches) {
    const fullTag = match[0];
    const snippetName = match[1];

    if (resolvedCache[snippetName] !== undefined) {
      resolvedPrompt = resolvedPrompt.split(fullTag).join(resolvedCache[snippetName]);
      continue;
    }

    try {
      const configKey = `prompt_snippet_${snippetName}`;
      const snippetContent = await ConfigManager.getRawConfig(configKey);

      if (snippetContent && typeof snippetContent === 'string') {
        resolvedCache[snippetName] = snippetContent;
        resolvedPrompt = resolvedPrompt.split(fullTag).join(snippetContent);
        logger.debug(`Resolved prompt snippet: ${snippetName}`);
      } else {
        logger.warn(`Prompt snippet not found or invalid: ${snippetName}`);
        // If snippet not found, we leave the tag as is or replace with empty string?
        // Usually, leaving it or replacing with a placeholder is better for debugging.
        // For now, let's just leave it or replace with empty to avoid LLM confusion.
        resolvedCache[snippetName] = '';
        resolvedPrompt = resolvedPrompt.split(fullTag).join('');
      }
    } catch (err) {
      logger.error(`Error resolving prompt snippet ${snippetName}:`, err);
      // Fallback: remove the tag to avoid sending it to LLM
      resolvedPrompt = resolvedPrompt.split(fullTag).join('');
    }
  }

  return resolvedPrompt;
}
