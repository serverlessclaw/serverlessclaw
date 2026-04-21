/**
 * Semantic Theme Constants for ClawCenter
 * Use these to ensure visual consistency across the dashboard.
 */

export const THEME = {
  COLORS: {
    PRIMARY: 'cyber-green',
    INTEL: 'cyber-blue',
    REFLECT: 'purple-400',
    DANGER: 'red-500',
    WARNING: 'orange-400',
    AUDIT: 'yellow-400',
  },

  // Tailwind class mappings for common UI elements
  CLASSES: {
    // Buttons
    BUTTON_PRIMARY: 'bg-[var(--cyber-green)] text-black hover:shadow-[0_0_20px_color-mix(in_srgb,var(--cyber-green)_40%,transparent)]',
    BUTTON_DANGER: 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 dark:bg-red-500/20 dark:hover:bg-red-500/30',

    // Status
    STATUS_ACTIVE: 'text-[var(--cyber-green)]',
    STATUS_ERROR: 'text-red-500',
    STATUS_WARNING: 'text-orange-400',

    // Borders & Glass
    BORDER_DEFAULT: 'border-[var(--card-border)]',
    BORDER_PRIMARY: 'border-[var(--cyber-green)]/20',
    BORDER_INTEL: 'border-[var(--cyber-blue)]/20',
    BORDER_DANGER: 'border-red-500/20',

    // Headers
    HEADER_INTEL: 'text-[var(--cyber-blue)]',
    HEADER_PRIMARY: 'text-[var(--cyber-green)]',
    HEADER_REFLECT: 'text-purple-400',
  },
} as const;
