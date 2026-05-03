/**
 * Semantic Theme Constants for Serverless Claw
 */

export const THEME = {
  CLASSES: {
    // Buttons
    BUTTON_PRIMARY:
      'bg-[var(--brand-primary)] text-black hover:shadow-[0_0_20px_color-mix(in_srgb,var(--brand-primary)_40%,transparent)]',
    BUTTON_DANGER:
      'bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 dark:bg-red-500/20 dark:hover:bg-red-500/30',

    // Status
    STATUS_ACTIVE: 'text-[var(--brand-primary)]',
    STATUS_ERROR: 'text-red-500',
    STATUS_WARNING: 'text-orange-400',

    // Borders & Glass
    BORDER_DEFAULT: 'border-[var(--surface-border)]',
    BORDER_PRIMARY: 'border-[var(--brand-primary)]/20',
    BORDER_INTEL: 'border-[var(--brand-secondary)]/20',
    BORDER_DANGER: 'border-red-500/20',

    // Headers
    HEADER_INTEL: 'text-[var(--brand-secondary)]',
    HEADER_PRIMARY: 'text-[var(--brand-primary)]',
    HEADER_REFLECT: 'text-purple-400',
  },
} as const;
