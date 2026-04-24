/**
 * Global Vitest setup for @serverlessclaw/core
 */

import '@testing-library/jest-dom';

(global as unknown as { __CLAW_TEST__: boolean }).__CLAW_TEST__ = true;
(global as unknown as { CLAW_TEST: boolean }).CLAW_TEST = true;
(global as unknown as { IS_CLAW_TEST: boolean }).IS_CLAW_TEST = true;
process.env.CLAW_TEST = 'true';
process.env.VITEST = 'true';
process.env.CORE_TEST = 'true';

// Shared mocks or global settings can be added here
