import { PROTECTED_FILES } from '../constants';

/**
 * Checks if a file path is protected based on the system's PROTECTED_FILES list.
 *
 * @param filePath - The path to the file to check.
 * @returns True if the file path is protected, otherwise false.
 * @since 2026-03-19
 */
export function isProtectedPath(filePath: string): boolean {
  if (!filePath) return false;

  const normalized = filePath.replace(/\\/g, '/');

  // Base list of critical files that are ALWAYS protected, even if constants fail to load
  const CRITICAL = [
    'sst.config.ts',
    'core/lib/constants.ts',
    '.env',
    'package.json',
    'package-lock.json',
  ];

  if (CRITICAL.includes(normalized) || normalized.startsWith('infra/')) {
    return true;
  }

  try {
    const protectedFiles = PROTECTED_FILES ?? [];
    return protectedFiles.some((p: string) => {
      if (p.endsWith('/')) {
        return normalized.startsWith(p);
      }
      return normalized === p;
    });
  } catch {
    // Fallback already handled by CRITICAL check
    return false;
  }
}

/**
 * Scans a set of tool arguments for common path keys and validates them for security.
 * Returns the first error found, or null if all paths are safe.
 *
 * @param args - The arguments object to scan.
 * @param operationName - Context for error messages.
 * @param extraPathKeys - Additional keys provided by tool metadata that contain file paths.
 */
export function checkArgumentsForSecurity(
  args: Record<string, unknown>,
  operationName: string,
  extraPathKeys: string[] = []
): string | null {
  const pathKeys = [
    'path',
    'path_to_file',
    'file_path',
    'filePath',
    'source',
    'destination',
    'dir',
    'dir_path',
    'dirPath',
    'filename',
    'file',
  ];

  const allKeys = [...new Set([...pathKeys, ...extraPathKeys])];

  for (const key of allKeys) {
    const filePath = args[key];
    if (filePath && typeof filePath === 'string') {
      const securityError = checkFileSecurity(
        filePath,
        args.manuallyApproved as boolean | undefined,
        `${operationName} [arg: ${key}]`
      );
      if (securityError) return securityError;
    }
  }

  return null;
}

/**
 * Validates a file path against protection rules.
 *
 * @param filePath - The path to the file to check.
 * @param manuallyApproved - Whether the user has explicitly approved this operation.
 * @param operation - The type of operation (e.g., 'writes', 'deletes').
 * @returns An error message string if blocked, otherwise null.
 */
export function checkFileSecurity(
  filePath: string,
  manuallyApproved: boolean = false,
  operation: string = 'writes'
): string | null {
  if (isProtectedPath(filePath) && !manuallyApproved) {
    return `PERMISSION_DENIED: Direct ${operation} to '${filePath}' is blocked. This is a protected system file. To override, you must obtain explicit human approval and then retry with the 'manuallyApproved: true' parameter.`;
  }
  return null;
}
