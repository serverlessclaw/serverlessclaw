import { IToolDefinition } from './types/tool';
import { logger } from './logger';
import { TOOLS } from '../tools/index';

/**
 * Validates a tool definition against strict LLM provider requirements.
 * Rules:
 * 1. Must have a parameters object of type 'object'.
 * 2. If properties exist, 'required' must be present.
 * 3. 'required' must contain ALL keys present in 'properties'.
 * 4. 'additionalProperties' should be false for strict schema compliance.
 *
 * @param tool - The tool definition to validate.
 * @returns An array of validation error messages.
 */
export function validateToolSchema(tool: IToolDefinition): string[] {
  const errors: string[] = [];
  const { parameters } = tool;

  if (!parameters || parameters.type !== 'object') {
    errors.push(`Tool '${tool.name}' parameters must be of type 'object'.`);
    return errors;
  }

  const properties = parameters.properties ?? {};
  const propertyKeys = Object.keys(properties);
  const required = parameters.required ?? [];

  // Note: We don't require all properties to be in 'required' array
  // Optional properties (not in 'required') are valid JSON Schema

  // Check if all required are in properties
  for (const key of required) {
    if (!properties[key]) {
      errors.push(`Tool '${tool.name}' required property '${key}' is missing from 'properties'.`);
    }
  }

  // Check additionalProperties
  if (parameters.additionalProperties !== false && propertyKeys.length > 0) {
    errors.push(
      `Tool '${tool.name}' should have 'additionalProperties: false' for strict compliance.`
    );
  }

  return errors;
}

/**
 * Validates all system tools.
 *
 * @returns True if all tools are valid, false otherwise.
 */
export function validateAllTools(): boolean {
  let allValid = true;
  for (const [id, tool] of Object.entries(TOOLS)) {
    const errors = validateToolSchema(tool);
    if (errors.length > 0) {
      allValid = false;
      logger.error(`Validation failed for tool '${id}':`, errors);
    }
  }
  return allValid;
}
