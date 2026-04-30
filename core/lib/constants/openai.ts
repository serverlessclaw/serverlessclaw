/**
 * OpenAI-specific configuration and role mapping.
 */
export const OPENAI = {
  ROLES: {
    USER: 'user' as const,
    ASSISTANT: 'assistant' as const,
    DEVELOPER: 'developer' as const,
  },
  ITEM_TYPES: {
    MESSAGE: 'message',
    FUNCTION_CALL: 'function_call',
    FUNCTION_CALL_OUTPUT: 'function_call_output',
  },
  CONTENT_TYPES: {
    INPUT_TEXT: 'input_text',
    INPUT_FILE: 'input_file',
    IMAGE_URL: 'image_url',
  },
  EVENT_TYPES: {
    TEXT_DELTA: 'text.delta',
    OUTPUT_TEXT_DELTA: 'output_text.delta',
    RESPONSE_TEXT_DELTA: 'response.text.delta',
    RESPONSE_OUTPUT_TEXT_DELTA: 'response.output_text.delta',
    REASONING_DELTA: 'reasoning.delta',
    OUTPUT_THOUGHT_DELTA: 'output_thought.delta',
    THOUGHT_DELTA: 'thought.delta',
    RESPONSE_REASONING_DELTA: 'response.reasoning.delta',
    RESPONSE_OUTPUT_THOUGHT_DELTA: 'response.output_thought.delta',
    RESPONSE_THOUGHT_DELTA: 'response.thought.delta',
    OUTPUT_ITEM_DONE: 'output_item.done',
    RESPONSE_OUTPUT_ITEM_DONE: 'response.output_item.done',
    MESSAGE_DELTA: 'message.delta',
    RESPONSE_MESSAGE_DELTA: 'response.message.delta',
    REASONING_SUMMARY_DELTA: 'reasoning_summary_text.delta',
    RESPONSE_REASONING_SUMMARY_DELTA: 'response.reasoning_summary_text.delta',
    USAGE: 'usage',
    RESPONSE_USAGE: 'response.usage',
  },
  STREAM_PROPS: {
    REASONING_CONTENT: 'reasoning_content',
    REASONING: 'reasoning',
    CONTENT: 'content',
    SUMMARY: 'summary',
    FUNCTION_CALL: 'function_call',
  },
  DEFAULT_FILE_NAME: 'document.pdf',
  DEFAULT_MIME_TYPE: 'application/octet-stream',
  FUNCTION_TYPE: 'function',
  MCP_TYPE: 'mcp',
} as const;
