import { ITool } from '../../lib/types/tool';

/**
 * Infra Domain Tool Registry
 */
export const infraTools: Record<string, ITool> = {};

/**
 * Lazily loads all infra tools.
 */
export async function getInfraTools(): Promise<Record<string, ITool>> {
  if (Object.keys(infraTools).length > 0) return infraTools;

  const [deployment, rollback, scheduler, topology, orchestration] = await Promise.all([
    import('./deployment'),
    import('./rollback'),
    import('./scheduler'),
    import('./topology'),
    import('./orchestration'),
  ]);

  Object.assign(infraTools, {
    ...deployment,
    ...rollback,
    ...scheduler,
    ...topology,
    ...orchestration,
  });

  return infraTools;
}

export { infraSchema } from './schema';
