/**
 * Global Vitest setup for @serverlessclaw/core
 */

(global as any).__CLAW_TEST__ = true;
(global as any).CLAW_TEST = true;
process.env.CLAW_TEST = 'true';
process.env.VITEST = 'true';

// Shared mocks or global settings can be added here
