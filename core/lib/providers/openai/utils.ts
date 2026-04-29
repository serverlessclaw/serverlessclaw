import { Message, ITool, ReasoningProfile, MessageRole } from '../../types/index';
import { OPENAI } from '../../constants';
import { OpenAIResponse, ContentItem, ToolConfig } from './types';

/**
 * Determines if a model/profile combination should request a reasoning summary.
 */
export function shouldRequestReasoningSummary(
  model: string,
  requestedProfile: ReasoningProfile
): boolean {
  const isGpt5Family = model.includes('gpt-5');
  const isThinkingMode =
    requestedProfile === ReasoningProfile.THINKING || requestedProfile === ReasoningProfile.DEEP;
  return isGpt5Family && isThinkingMode;
}

/**
 * Detects if an error indicates that reasoning.summary is unsupported.
 */
export function isReasoningSummaryUnsupportedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes('reasoning.summary') ||
    (message.includes('summary') && message.includes('reasoning')) ||
    message.includes('unknown parameter') ||
    message.includes('unsupported')
  );
}

/**
 * Extracts plain text from an OpenAI summary array.
 */
export function extractSummaryText(summary?: Array<{ text?: string }>): string {
  if (!Array.isArray(summary)) return '';
  return summary
    .map((s) => s?.text ?? '')
    .filter((text) => text.trim().length > 0)
    .join('\n\n')
    .trim();
}

/**
 * Extracts reasoning summary from structured output.
 */
export function extractReasoningSummary(output?: OpenAIResponse['output']): string | undefined {
  if (!Array.isArray(output)) return undefined;

  const collected: string[] = [];
  for (const item of output) {
    if (item.type !== 'reasoning') continue;
    const text = extractSummaryText(item.summary);
    if (text.length > 0) {
      collected.push(text);
    }
  }

  return collected.length > 0 ? collected.join('\n\n') : undefined;
}

/**
 * Splits a thought block into smaller chunks for streaming.
 */
export function splitThoughtIntoChunks(text: string, targetChunkSize = 80): string[] {
  if (!text) return [];
  if (text.length <= targetChunkSize) return [text];

  const tokens = text.split(/(\s+)/);
  const chunks: string[] = [];
  let current = '';

  for (const token of tokens) {
    if (current.length > 0 && (current + token).length > targetChunkSize) {
      chunks.push(current);
      current = token;
    } else {
      current += token;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * Maps internal Message[] to OpenAI Responses API input format.
 */
export function mapMessagesToResponsesInput(messages: Message[]): Array<Record<string, unknown>> {
  return messages.flatMap((m) => {
    if (m.role === MessageRole.TOOL) {
      return [
        {
          type: OPENAI.ITEM_TYPES.FUNCTION_CALL_OUTPUT,
          call_id: m.tool_call_id ?? '',
          output: m.content ?? '',
        },
      ];
    }

    const items: Array<Record<string, unknown>> = [];

    if (m.content || (m.attachments && m.attachments.length > 0)) {
      let role: 'user' | 'assistant' | 'system' | 'developer' = OPENAI.ROLES.USER;
      if (m.role === MessageRole.SYSTEM) role = OPENAI.ROLES.DEVELOPER;
      else if (m.role === MessageRole.ASSISTANT) role = OPENAI.ROLES.ASSISTANT;
      else if (m.role === MessageRole.DEVELOPER) role = OPENAI.ROLES.DEVELOPER;

      const content: ContentItem[] = [];
      if (m.content) content.push({ type: OPENAI.CONTENT_TYPES.INPUT_TEXT, text: m.content });

      if (m.attachments) {
        m.attachments.forEach((att) => {
          if (att.type === 'image') {
            content.push({
              type: OPENAI.CONTENT_TYPES.IMAGE_URL,
              image_url: {
                url: att.url ?? `data:${att.mimeType ?? 'image/png'};base64,${att.base64}`,
              },
            });
          } else if (att.type === 'file') {
            content.push({
              type: OPENAI.CONTENT_TYPES.INPUT_FILE,
              filename: att.name ?? OPENAI.DEFAULT_FILE_NAME,
              file_data: `data:${att.mimeType ?? OPENAI.DEFAULT_MIME_TYPE};base64,${att.base64}`,
            });
          }
        });
      }

      items.push({
        type: OPENAI.ITEM_TYPES.MESSAGE,
        role,
        content:
          content.length === 1 && content[0].type === OPENAI.CONTENT_TYPES.INPUT_TEXT
            ? m.content
            : content,
      });
    }

    if (m.tool_calls && m.tool_calls.length > 0) {
      for (const tc of m.tool_calls) {
        items.push({
          type: OPENAI.ITEM_TYPES.FUNCTION_CALL,
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
    }

    return items;
  });
}

/**
 * Maps internal ITool[] to OpenAI API tool format.
 */
export function mapToolsToOpenAI(tools: ITool[]): ToolConfig[] {
  return tools.map((t) => {
    if (t.connector_id) {
      return {
        type: OPENAI.MCP_TYPE,
        server_label: t.name,
        connector_id: t.connector_id,
      };
    }
    if (t.type && t.type !== OPENAI.FUNCTION_TYPE) {
      return { type: t.type };
    }
    return {
      type: OPENAI.FUNCTION_TYPE,
      name: t.name,
      description: t.description,
      parameters: t.parameters as unknown as Record<string, unknown>,
      strict: false,
    };
  });
}
