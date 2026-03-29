import { knowledgeSchema as schema } from './schema';
import { SYSTEM_CONFIG_METADATA } from '../../lib/metadata';
import { ClawTracer } from '../../lib/tracer';

/**
 * Retrieves technical documentation, implications, and risks for all system configuration keys.
 */
export const getSystemConfigMetadata = {
  ...schema.getSystemConfigMetadata,
  execute: async (): Promise<string> => {
    return JSON.stringify(SYSTEM_CONFIG_METADATA, null, 2);
  },
};

/**
 * Retrieves the full execution trace for a given trace ID.
 */
export const inspectTrace = {
  ...schema.inspectTrace,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { traceId } = args as { traceId: string };
    try {
      const nodes = await ClawTracer.getTrace(traceId);
      if (nodes.length === 0) return `No trace nodes found for ID: ${traceId}`;

      return (
        `Found ${nodes.length} nodes for trace ${traceId}:\n` +
        nodes
          .map(
            (n) =>
              `--- NODE: ${n.nodeId} (Parent: ${n.parentId ?? 'None'}, Status: ${n.status}) ---\n` +
              n.steps
                .map(
                  (s: { type: string; content: unknown }) =>
                    `[${s.type.toUpperCase()}] ${String(s.content)}`
                )
                .join('\n')
          )
          .join('\n\n')
      );
    } catch (error) {
      return `Failed to inspect trace: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
