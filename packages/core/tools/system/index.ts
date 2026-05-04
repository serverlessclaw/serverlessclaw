import { ITool } from '../../lib/types/tool';

/**
 * System Domain Tool Registry
 * Aggregates specialized system tools.
 */
export const systemTools: Record<string, ITool> = {};

/**
 * Lazily loads all system tools.
 */
export async function getSystemTools(): Promise<Record<string, ITool>> {
  if (Object.keys(systemTools).length > 0) return systemTools;

  const [
    { proposeAutonomyUpdate, scanMetabolism },
    git,
    health,
    validation,
    promotion,
    hotConfig,
    reputation,
    ui,
    workflow,
  ] = await Promise.all([
    import('./governance'),
    import('./git'),
    import('./health'),
    import('./validation'),
    import('./promotion'),
    import('./hot-config'),
    import('./reputation'),
    import('./ui'),
    import('./workflow'),
  ]);

  Object.assign(systemTools, {
    proposeAutonomyUpdate,
    scanMetabolism,
    ...git,
    ...health,
    ...validation,
    ...promotion,
    ...hotConfig,
    ...reputation,
    ...ui,
    ...workflow,
  });

  return systemTools;
}

// Re-exporting schemas for UI and metadata needs
export { systemSchema } from './schema';
