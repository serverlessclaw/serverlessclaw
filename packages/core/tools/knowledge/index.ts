import { ITool } from '../../lib/types/tool';

/**
 * Knowledge Domain Tool Registry
 */
export const knowledgeTools: Record<string, ITool> = {};

/**
 * Lazily loads all knowledge tools.
 */
export async function getKnowledgeTools(): Promise<Record<string, ITool>> {
  if (Object.keys(knowledgeTools).length > 0) return knowledgeTools;

  const [agent, storage, mcp, metadata, config, research] = await Promise.all([
    import('./agent'),
    import('./storage'),
    import('./mcp'),
    import('./metadata'),
    import('./config'),
    import('./research'),
  ]);

  Object.assign(knowledgeTools, {
    ...agent,
    ...storage,
    ...mcp,
    ...metadata,
    ...config,
    ...research,
  });

  return knowledgeTools;
}

export { knowledgeSchema } from './schema';
