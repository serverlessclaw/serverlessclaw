/**
 * Shared lightweight helpers for dashboard to avoid duplicating server-side
 * logic across pages and API routes. Keep these utils importable from
 * both server and client/server components as needed.
 */
import { tools } from './tool-definitions';

/** Options for fetching all tools. */
interface GetAllToolsOptions {
  /** If true, bypasses cache and fetches fresh tool definitions from MCP servers. */
  forceRefresh?: boolean;
}

/**
 * Retrieves the usage statistics for all tools.
 * @returns A record mapping tool names to their usage count and last-used timestamp.
 */
export async function getToolUsage(): Promise<Record<string, { count: number; lastUsed: number }>> {
  try {
    const { AgentRegistry } = await import('@claw/core/lib/registry');
    return (
      ((await AgentRegistry.getRawConfig('tool_usage')) as Record<
        string,
        { count: number; lastUsed: number }
      >) ?? {}
    );
  } catch (e) {
    console.error('Error fetching tool usage:', e);
    return {};
  }
}

/**
 * Retrieves all available tools (local and MCP) with their usage statistics.
 * @param usage - Current usage statistics for tools.
 * @param options - Configuration options for the fetch.
 * @returns A merged list of local and external tools with usage data.
 */
export async function getAllTools(
  usage: Record<string, { count: number; lastUsed: number }>,
  options: GetAllToolsOptions = {}
) {
  const { forceRefresh = false } = options;

  try {
    const { MCPBridge } = await import('@claw/core/lib/mcp');

    // 1. Local tools
    const localTools = Object.values(tools).map((t) => ({
      name: t.name,
      description: t.description,
      usage: usage[t.name] ?? { count: 0, lastUsed: 0 },
      isExternal: false,
    }));

    // 2. MCP tools (use cache by default for dashboard speed)
    let externalToolsDefinitions: { name: string; description: string }[] = [];
    if (forceRefresh) {
      externalToolsDefinitions = (await MCPBridge.getExternalTools()) as {
        name: string;
        description: string;
      }[];
    } else {
      externalToolsDefinitions = (await MCPBridge.getCachedTools()) as {
        name: string;
        description: string;
      }[];
      // If cache is empty, use skipConnection mode to avoid timeout and ENOSPC
      // This shows server names without actually connecting to them (no npx execution)
      if (externalToolsDefinitions.length === 0) {
        externalToolsDefinitions = (await MCPBridge.getExternalTools(undefined, true)) as {
          name: string;
          description: string;
        }[];
      }
    }

    const mcpTools = externalToolsDefinitions.map((t: { name: string; description: string }) => ({
      name: t.name,
      description: t.description,
      usage: usage[t.name] ?? { count: 0, lastUsed: 0 },
      isExternal: true,
    }));

    return [...localTools, ...mcpTools];
  } catch (e) {
    console.error('Error fetching all tools:', e);
    return Object.values(tools).map((t) => ({
      name: t.name,
      description: t.description,
      usage: usage[t.name] ?? { count: 0, lastUsed: 0 },
      isExternal: false,
    }));
  }
}
