export interface JsonSchema {
  type: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
}

export interface IToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ITool extends IToolDefinition {
  execute(args: Record<string, unknown>): Promise<string>;
}
