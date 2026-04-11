/**
 * JSON Schema definition for tool parameters.
 */
export interface JsonSchema {
  /** The data type (e.g., 'string', 'object', 'array'). */
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
  /** Human-readable description of the property. */
  description?: string;
  /** Nested properties for object types. */
  properties?: Record<string, JsonSchema>;
  /** List of required property names. */
  required?: string[];
  /** Schema for array items. */
  items?: JsonSchema;
  /** Allowed values for the property. */
  enum?: Array<string | number | boolean | null>;
  /** Whether additional properties are allowed. */
  additionalProperties?: boolean | JsonSchema;
  /** Regex pattern for string validation. */
  pattern?: string;
  /** Minimum value for numbers. */
  minimum?: number;
  /** Maximum value for numbers. */
  maximum?: number;
  /** Minimum length for strings. */
  minLength?: number;
  /** Maximum length for strings. */
  maxLength?: number;
  /** Minimum number of items in an array. */
  minItems?: number;
  /** Maximum number of items in an array. */
  maxItems?: number;
  /** Valid if matches any of the sub-schemas. */
  anyOf?: JsonSchema[];
  /** Valid if matches exactly one of the sub-schemas. */
  oneOf?: JsonSchema[];
  /** Valid if matches all of the sub-schemas. */
  allOf?: JsonSchema[];
  /** Default value for the property. */
  default?: any;
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
  /** Zod schema for runtime validation and defaulting of arguments. */
  argSchema?: import('zod').ZodSchema; // optional: for runtime validation
  /** The type of tool. */
  type: ToolType;
  /** Resource connections this tool utilizes (used for topology discovery). */
  connectionProfile: string[];
  /** ID for OpenAI Managed Connectors (e.g., connector_googledrive). */
  connector_id?: string;
  /** Authentication context for managed connectors. */
  auth?: {
    type: 'oauth' | 'api_key' | string;
    resource_id?: string;
  };
  /** Whether this tool requires manual human approval before execution. */
  requiresApproval: boolean;
  /** Required RBAC permissions to execute this tool. */
  requiredPermissions: string[];
  /** Whether this tool should always be executed sequentially within a multi-tool turn. Defaults to false. */
  sequential?: boolean;
  /** Optional: specific argument keys that contain file paths (for security monitoring). */
  pathKeys?: string[];
}

/**
 * Structured output from a tool execution.
 */
export interface ToolResult {
  /** Textual output (required). */
  text: string;
  /** List of base64 encoded images (for plots, screenshots). Defaults to []. */
  images: string[];
  /** File references or metadata. Defaults to {}. */
  metadata: Record<string, unknown>;
  /**
   * Dynamic UI blocks returned by the tool. Defaults to [].
   */
  ui_blocks: Array<{
    id: string;
    componentType: string;
    props: Record<string, unknown>;
    actions?: Array<{
      id: string;
      label: string;
      type: 'primary' | 'secondary' | 'danger';
      payload?: Record<string, unknown>;
    }>;
  }>;
}

/**
 * Creates a new ToolResult with default values for optional fields.
 */
export function createToolResult(
  text: string,
  options: {
    images?: string[];
    metadata?: Record<string, unknown>;
    ui_blocks?: Array<{
      id: string;
      componentType: string;
      props: Record<string, unknown>;
      actions?: Array<{
        id: string;
        label: string;
        type: 'primary' | 'secondary' | 'danger';
        payload?: Record<string, unknown>;
      }>;
    }>;
  } = {}
): ToolResult {
  return {
    text,
    images: options.images ?? [],
    metadata: options.metadata ?? {},
    ui_blocks: options.ui_blocks ?? [],
  };
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
