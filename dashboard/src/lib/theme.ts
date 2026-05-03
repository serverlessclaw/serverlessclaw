/**
 * Semantic Theme Constants for ClawCenter
 * Inherited from @claw/ui framework.
 */
export * from '@claw/ui/src/theme';

import { THEME as BASE_THEME } from '@claw/ui/src/theme';

export const THEME = {
  ...BASE_THEME,
  COLORS: {
    PRIMARY: 'brand-primary',
    INTEL: 'brand-secondary',
    REFLECT: 'purple-400',
    DANGER: 'red-500',
    WARNING: 'orange-400',
    AUDIT: 'yellow-400',
  },
} as const;
