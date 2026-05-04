/**
 * ServerlessClaw Dashboard Extensions
 * This file is the bridge between the framework and domain-specific extensions.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function init(registry: any) {
  try {
    // Dynamically attempt to load VoltX UI if present
    // @ts-expect-error - External package
    const { init: initVoltX } = await import('@voltx/ui');
    if (typeof initVoltX === 'function') {
      initVoltX(registry);
    }
  } catch {
    // VoltX not present or failed to load, skip gracefully
  }
}
