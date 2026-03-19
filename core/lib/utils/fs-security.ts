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
 * Validates a file operation against protection rules.
 *
 * @param path - The file path to validate.
 * @param manuallyApproved - Whether the operation has been manually approved by the user.
 * @param operation - The type of operation being performed (e.g., 'writes', 'deletes'). Defaults to 'writes'.
 * @returns An error message if protected and not approved, otherwise null.
 */
export function checkFileSecurity(
  path: string,
  manuallyApproved: boolean | undefined,
  operation: string = 'writes'
): string | null {
  if (isProtectedPath(path) && !manuallyApproved) {
    return `PERMISSION_DENIED: ${operation} to '${path}' are strictly prohibited for agent safety. If this change is absolutely necessary for system evolution, you MUST describe the reason to the human user and request approval via 'seekClarification' with the status 'MANUAL_APPROVAL_REQUIRED'. Once approved, you can retry with 'manuallyApproved: true'.`;
  }
  return null;
}
