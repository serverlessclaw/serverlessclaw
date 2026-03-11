/**
 * Semantic Theme Constants for ClawCenter
 * Use these to ensure visual consistency across the dashboard.
 */

export const THEME = {
  COLORS: {
    PRIMARY: 'cyber-green', // #00ffa3 - Actions, Success, Active
    INTEL: 'cyber-blue',    // #00e0ff - Intelligence, Config, Info
    REFLECT: 'purple-400',  // #c084fc - Memory, Reflection, Background
    DANGER: 'red-500',      // #ef4444 - Blocks, Errors, Delete
    WARNING: 'orange-400',  // #fb923c - HITL, Pending, Caution
    AUDIT: 'yellow-400',    // #facc15 - QA, Neutral Metrics, Verification
  },
  
  // Tailwind class mappings for common UI elements
  CLASSES: {
    // Buttons
    BUTTON_PRIMARY: 'bg-cyber-green text-black hover:shadow-[0_0_20px_rgba(0,255,163,0.4)]',
    BUTTON_DANGER: 'bg-red-950/40 hover:bg-red-900/60 text-red-200 border-red-800/50',
    
    // Status
    STATUS_ACTIVE: 'text-cyber-green',
    STATUS_ERROR: 'text-red-500',
    STATUS_WARNING: 'text-orange-400',
    
    // Borders & Glass
    BORDER_DEFAULT: 'border-white/10',
    BORDER_PRIMARY: 'border-cyber-green/30',
    BORDER_INTEL: 'border-cyber-blue/30',
    BORDER_DANGER: 'border-red-500/30',
    
    // Headers
    HEADER_INTEL: 'text-cyber-blue',
    HEADER_PRIMARY: 'text-cyber-green',
    HEADER_REFLECT: 'text-purple-400',
  }
} as const;
