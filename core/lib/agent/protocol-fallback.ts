/**
 * Protocol Fallback Chain
 * Provides automatic fallback from JSON to Text mode when agent communication fails
 */

import {
  Message,
  IProvider,
  ReasoningProfile,
  ResponseFormat,
  ITool,
  MessageChunk,
} from '../types/index';
import { logger } from '../logger';
import { normalizeProfile } from '../providers/utils';
import { DEFAULT_SIGNAL_SCHEMA } from './schema';

export interface FallbackResult {
  response: Message;
  usedFallback: boolean;
  originalMode: 'json' | 'text';
  fallbackMode?: 'json' | 'text';
  parseError?: string;
}

export interface FallbackOptions {
  communicationMode: 'json' | 'text';
  responseFormat?: ResponseFormat;
  activeModel: string;
  activeProvider: string;
  activeProfile: ReasoningProfile;
  maxRetries?: number;
}

/**
 * Validates if a string is valid JSON matching the expected schema
 */
function isValidJsonResponse(content: string, expectedSchema?: ResponseFormat): boolean {
  if (!content || content.trim() === '') return false;

  try {
    const parsed = JSON.parse(content);

    // Basic validation - ensure it's an object
    if (typeof parsed !== 'object' || parsed === null) return false;

    // If schema is provided, validate required fields
    const schema = expectedSchema?.json_schema?.schema;
    if (schema?.required && Array.isArray(schema.required)) {
      const requiredFields = schema.required;
      for (const field of requiredFields) {
        if (!(field in parsed)) {
          logger.warn(`JSON response missing required field: ${field}`);
          return false;
        }
      }
    }

    return true;
  } catch {
    // Not valid JSON - return false to trigger text fallback
    return false;
  }
}

/**
 * Attempts to extract human-readable message from malformed JSON
 */
function extractMessageFromMalformedJson(content: string): string | null {
  // Try to find message-like fields in partial JSON
  const patterns = [
    /"message"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/,
    /"plan"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/,
    /"responseText"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/,
    /"reasoning"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      // Unescape basic JSON escapes
      return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }

  return null;
}

/**
 * Wraps provider.call with protocol fallback support
 * If JSON mode fails to parse, automatically retries in Text mode
 *
 * @param provider - The LLM provider to call.
 * @param messages - The conversation messages to send.
 * @param tools - The tools available for the agent to use.
 * @param options - Fallback configuration options including retry count and format.
 */
export async function callWithFallback(
  provider: IProvider,
  messages: Message[],
  tools: ITool[],
  options: FallbackOptions
): Promise<FallbackResult> {
  const {
    communicationMode,
    responseFormat,
    activeModel,
    activeProvider,
    activeProfile,
    maxRetries = 1,
  } = options;

  const capabilities = await provider.getCapabilities(activeModel);
  const normalizedProfile = normalizeProfile(activeProfile, capabilities, activeModel ?? 'default');

  // If not in JSON mode, no fallback needed
  if (communicationMode !== 'json') {
    const response = await provider.call(
      messages,
      tools,
      normalizedProfile,
      activeModel,
      activeProvider,
      responseFormat
    );

    return {
      response,
      usedFallback: false,
      originalMode: 'text',
    };
  }

  // JSON mode - try with schema
  const jsonSchema = responseFormat || DEFAULT_SIGNAL_SCHEMA;

  try {
    const response = await provider.call(
      messages,
      tools,
      normalizedProfile,
      activeModel,
      activeProvider,
      capabilities.supportsStructuredOutput ? jsonSchema : undefined
    );

    const content = response.content ?? '';

    // Validate JSON response
    if (isValidJsonResponse(content, jsonSchema)) {
      return {
        response,
        usedFallback: false,
        originalMode: 'json',
      };
    }

    // JSON parse failed - attempt fallback
    logger.warn(
      `JSON response validation failed for agent. Content preview: ${content.substring(0, 100)}...`
    );

    // Try to extract useful content from malformed JSON
    const extractedMessage = extractMessageFromMalformedJson(content);

    if (extractedMessage) {
      logger.info('Extracted message from malformed JSON response');
      return {
        response: {
          ...response,
          content: extractedMessage,
        },
        usedFallback: true,
        originalMode: 'json',
        fallbackMode: 'text',
        parseError: 'Malformed JSON - extracted message field',
      };
    }

    // If extraction fails and we have retries, try in text mode
    if (maxRetries > 0) {
      logger.info('Retrying in text mode due to JSON parse failure');

      const textResponse = await provider.call(
        messages,
        tools,
        normalizedProfile,
        activeModel,
        activeProvider,
        undefined // No response format for text mode
      );

      return {
        response: textResponse,
        usedFallback: true,
        originalMode: 'json',
        fallbackMode: 'text',
        parseError: 'JSON parse failed - retried in text mode',
      };
    }

    // No retries left - return original response with warning
    return {
      response,
      usedFallback: false,
      originalMode: 'json',
      parseError: 'JSON parse failed - no fallback attempted',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Provider call failed: ${errorMessage}`);

    // On provider error, retry in text mode if retries available
    if (maxRetries > 0) {
      logger.info('Retrying in text mode due to provider error');

      try {
        const textResponse = await provider.call(
          messages,
          tools,
          normalizedProfile,
          activeModel,
          activeProvider,
          undefined
        );

        return {
          response: textResponse,
          usedFallback: true,
          originalMode: 'json',
          fallbackMode: 'text',
          parseError: `Provider error: ${errorMessage}`,
        };
      } catch {
        // Both attempts failed - throw original error
        throw error;
      }
    }

    throw error;
  }
}

/**
 * Stream wrapper with protocol fallback support
 */
export async function* streamWithFallback(
  provider: IProvider,
  messages: Message[],
  tools: ITool[],
  options: FallbackOptions
): AsyncIterable<MessageChunk & { usedFallback?: boolean }> {
  const { communicationMode, responseFormat, activeModel, activeProvider, activeProfile } = options;

  const capabilities = await provider.getCapabilities(activeModel);
  const normalizedProfile = normalizeProfile(activeProfile, capabilities, activeModel ?? 'default');

  // For streaming, we don't retry - just stream with the requested mode
  // Fallback detection happens at the chunk level
  const stream = provider.stream(
    messages,
    tools,
    normalizedProfile,
    activeModel,
    activeProvider,
    communicationMode === 'json' && capabilities.supportsStructuredOutput
      ? responseFormat || DEFAULT_SIGNAL_SCHEMA
      : undefined
  );

  let fullContent = '';
  let hasValidJson = communicationMode !== 'json'; // Assume valid if not JSON mode
  let fallbackTriggered = false;

  for await (const chunk of stream) {
    if (chunk.content) {
      fullContent += chunk.content;

      // In JSON mode, validate as we receive content
      if (communicationMode === 'json' && !hasValidJson && !fallbackTriggered) {
        // Try to detect if this looks like valid JSON
        if (fullContent.trim().startsWith('{')) {
          // Still accumulating JSON - check if we can parse partial
          try {
            // Try to close the JSON and parse
            const testContent = fullContent + '}';
            JSON.parse(testContent);
            hasValidJson = true;
          } catch {
            // Not valid JSON yet - continue accumulating
          }
        } else if (fullContent.trim().length > 10 && !fullContent.trim().startsWith('{')) {
          // Doesn't look like JSON at all - trigger fallback
          fallbackTriggered = true;
          logger.warn('Stream content does not appear to be JSON - fallback triggered');
          yield { content: '', usedFallback: true };
        }
      }
    }

    yield chunk;
  }

  // After stream completes, log if fallback was needed
  if (communicationMode === 'json' && !hasValidJson) {
    logger.warn('JSON stream completed without valid JSON structure');
  }
}
