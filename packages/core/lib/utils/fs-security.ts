import { PROTECTED_PATHS, PATH_KEYS, PROTECTED_FILES } from '../constants';

/**
 * Checks if a resource path matches any system-level protection rules.
 */
export function isProtectedPath(filePath: string): boolean {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, '/');

  // 1. Check primary centralized patterns
  if (PROTECTED_PATHS.some((pattern) => matchesGlob(normalized, pattern))) return true;

  // 2. Fallback to legacy PROTECTED_FILES for backward compatibility and test mocks
  try {
    const legacy = (PROTECTED_FILES as readonly string[]) ?? [];
    if (
      legacy.some((pattern: string) => {
        if (typeof pattern !== 'string') return false;
        // Handle legacy prefix matching (e.g. "src/secret/" should match "src/secret/file.ts")
        if (pattern.endsWith('/')) return normalized.startsWith(pattern);
        return matchesGlob(normalized, pattern);
      })
    ) {
      return true;
    }
  } catch {
    /* ignore */
  }

  return false;
}

/**
 * Simple glob pattern matching.
 */
export function matchesGlob(path: string, pattern: string): boolean {
  if (pattern.endsWith('/')) return path.startsWith(pattern);

  const regexSource = pattern
    .replace(/[.+^${}()|[\]\\]/g, (m) => (['*', '?'].includes(m) ? m : `\\${m}`))
    .replace(/\*\*\//g, '___DIR___')
    .replace(/\*\*/g, '___ANY___')
    .replace(/\*/g, '___NONSLASH___')
    .replace(/\?/g, '.')
    .replace(/___DIR___/g, '(?:.*/)?')
    .replace(/___ANY___/g, '.*')
    .replace(/___NONSLASH___/g, '[^/]*');

  return new RegExp(`^${regexSource}$`).test(path);
}

/**
 * Unified resource discovery function.
 */
export function scanForResources(
  args: Record<string, unknown>,
  extraPathKeys: string[] = []
): { path: string; key: string }[] {
  const foundResources: { path: string; key: string }[] = [];
  const seenPaths = new Set<string>();
  const pathKeys = [...new Set([...PATH_KEYS, ...extraPathKeys])];

  for (const key of pathKeys) {
    const val = args[key];
    if (
      typeof val === 'string' &&
      (val.includes('/') || val.includes('\\') || val.includes('.') || val.includes(':'))
    ) {
      foundResources.push({ path: val, key });
      seenPaths.add(val);
    }
  }

  const scanRecursive = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value === 'string') {
        if (
          !seenPaths.has(value) &&
          (value.includes('/') ||
            value.includes('\\') ||
            value.includes('.') ||
            value.includes(':'))
        ) {
          foundResources.push({ path: value, key });
          seenPaths.add(value);
        }
      } else if (typeof value === 'object') {
        scanRecursive(value);
      }
    }
  };
  scanRecursive(args);
  return foundResources;
}

/**
 * Validates a file path against protection rules.
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

/**
 * Unified scan and validate function to prevent developers from forgetting validation after scanning.
 */
export function scanAndValidateResources(
  args: Record<string, unknown>,
  operation: string,
  extraPathKeys: string[] = []
): { resources: { path: string; key: string }[]; error: string | null } {
  const resources = scanForResources(args, extraPathKeys);
  const error = checkArgumentsForSecurity(args, operation, extraPathKeys);
  return { resources, error };
}

/**
 * Compatibility wrapper for checkArgumentsForSecurity.
 */
export function checkArgumentsForSecurity(
  args: Record<string, unknown>,
  operationName: string,
  extraPathKeys: string[] = []
): string | null {
  const resources = scanForResources(args, extraPathKeys);
  const isManuallyApproved = args.manuallyApproved === true;
  const pathKeys = [...PATH_KEYS, ...extraPathKeys];

  for (const { path, key } of resources) {
    const isExplicit = pathKeys.includes(key);
    const op = isExplicit ? operationName : `${operationName} [discovered path in arg: ${key}]`;
    const error = checkFileSecurity(path, isManuallyApproved, op);
    if (error) return error;
  }
  return null;
}
