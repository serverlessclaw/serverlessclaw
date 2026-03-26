/**
 * JSON Schema definition for tool parameters.
 */
export interface JsonSchema {
  /** The data type (e.g., 'string', 'object', 'array'). */
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  /** Human-readable description of the property. */
  description?: string;
  /** Nested properties for object types. */
  properties?: Record<string, JsonSchema>;
  /** List of required property names. */
  required?: string[];
  /** Schema for array items. */
  items?: JsonSchema;
  /** Allowed values for the property. */
  enum?: string[];
  /** Whether additional properties are allowed. */
  additionalProperties?: boolean;
}

/**
 * Types of tools available in the system.
 */
export enum ToolType {
  /** Standard function-based tool. */
  FUNCTION = 'function',
  /** OpenAI Code Interpreter tool. */
  CODE_INTERPRETER = 'code_interpreter',
  /** OpenAI File Search tool. */
  FILE_SEARCH = 'file_search',
  /** MCP (Model Context Protocol) tool. */
  MCP = 'mcp',
  /** Computer use tool for GUI automation. */
  COMPUTER_USE = 'computer_use',
  /** Google Search Retrieval tool. */
  GOOGLE_SEARCH_RETRIEVAL = 'google_search_retrieval',
}

/**
 * Metadata definition for a tool, used to inform the LLM about its usage.
 */
export interface IToolDefinition {
  /** The unique name of the tool. */
  name: string;
  /** Clear description of what the tool does and when to use it. */
  description: string;
  /** Schema defining the arguments expected by the tool. */
  parameters: JsonSchema;
  /** Optional Zod schema for runtime validation and defaulting of arguments. */
  argSchema?: import('zod').ZodSchema;
  /** The type of tool. */
  type?: ToolType;
  /** Optional resource connections this tool utilizes (used for topology discovery). */
  connectionProfile?: string[];
  /** Optional ID for OpenAI Managed Connectors (e.g., connector_googledrive). */
  connector_id?: string;
  /** Optional authentication context for managed connectors. */
  auth?: {
    type: 'oauth' | 'api_key' | string;
    resource_id?: string;
  };
  /** Whether this tool requires manual human approval before execution. */
  requiresApproval?: boolean;
}

/**
 * Structured output from a tool execution.
 */
export interface ToolResult {
  /** Textual output (required). */
  text: string;
  /** Optional base64 encoded images (for plots, screenshots). */
  images?: string[];
  /** Optional file references or metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Full tool implementation including its metadata and execution logic.
 */
export interface ITool extends IToolDefinition {
  /**
   * Executes the tool with the provided arguments.
   *
   * @param args - Key-value pairs of arguments as defined in the parameters schema.
   * @returns A promise resolving to the tool result.
   */
  execute(args: Record<string, unknown>): Promise<string | ToolResult>;
}
