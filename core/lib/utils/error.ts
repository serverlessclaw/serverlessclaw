/**
 * Shared Error Handling Utilities
 *
 * Centralized error handling functions to reduce code duplication across
 * the codebase. This module provides consistent error message formatting.
 */

/**
 * Formats an error into a user-friendly string message.
 * Handles both Error objects and other types (e.g., strings, numbers).
 *
 * @param error - The error to format (can be any type)
 * @returns A string representation of the error message
 *
 * @example
 * ```typescript
 * try {
 *   await someOperation();
 * } catch (error) {
 *   console.log(formatErrorMessage(error));
 * }
 * ```
 */
export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Creates a prefixed error message for consistent error formatting in tools.
 *
 * @param prefix - The prefix to add to the error message (e.g., "Failed to upload")
 * @param error - The error to format
 * @returns A formatted error message with prefix
 *
 * @example
 * ```typescript
 * try {
 *   await uploadFile();
 * } catch (error) {
 *   return formatPrefixedError('Failed to upload staged changes', error);
 * }
 * ```
 */
export function formatPrefixedError(prefix: string, error: unknown): string {
  return `${prefix}: ${formatErrorMessage(error)}`;
}
