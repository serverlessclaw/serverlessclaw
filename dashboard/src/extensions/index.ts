/**
 * ServerlessClaw Dashboard Extensions
 * This file is the bridge between the framework and VoltX.
 */

// @ts-ignore
import { init as initVoltX } from '@voltx/ui';

export function init(registry: any) {
  // Initialize VoltX energy extensions
  initVoltX(registry);
}
