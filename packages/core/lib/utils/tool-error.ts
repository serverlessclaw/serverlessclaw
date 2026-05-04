import { formatErrorMessage } from './error';

/**
 * Type for a tool execution function that may throw errors
 */
type ToolExecutor = () => Promise<string>;

/**
 * Wraps a tool executor with consistent error handling.
 * This deduplicates the common pattern of try/catch with formatted error messages.
 *
 * @param operationName - The name of the operation for error messages
 * @param executor - The async function to execute
 * @returns The result string or an error message
 *
 * @example
 * ```typescript
 * return await withToolError('deploy', async () => {
 *   // do deployment
 *   return 'Deployment successful';
 * });
 * ```
 */
export async function withToolError(
  operationName: string,
  executor: ToolExecutor
): Promise<string> {
  try {
    return await executor();
  } catch (error) {
    return `${operationName} failed: ${formatErrorMessage(error)}`;
  }
}

/**
 * Creates a success message with the operation name prefixed.
 *
 * @param operationName - The name of the operation
 * @param message - The success message
 * @returns Formatted success message
 */
export function successMessage(operationName: string, message: string): string {
  return `${operationName} successful: ${message}`;
}

/**
 * Creates a failure message with the operation name prefixed.
 *
 * @param operationName - The name of the operation
 * @param error - The error that occurred
 * @returns Formatted failure message
 */
export function failureMessage(operationName: string, error: unknown): string {
  return `${operationName} failed: ${formatErrorMessage(error)}`;
}
