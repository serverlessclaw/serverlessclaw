/**
 * Shared lightweight helpers for dashboard to avoid duplicating server-side
 * logic across pages and API routes. Keep these utils importable from
 * both server and client/server components as needed.
 */
import { tools } from './tool-definitions';

export async function getToolUsage(): Promise<Record<string, { count: number; lastUsed: number }>> {
  try {
    const { AgentRegistry } = await import('@claw/core/lib/registry');
    return (await AgentRegistry.getRawConfig('tool_usage')) as Record<string, { count: number; lastUsed: number }> || {};
  } catch (e) {
    console.error('Error fetching tool usage:', e);
    return {};
  }
}

export async function getAllTools(usage: Record<string, { count: number; lastUsed: number }>, forceRefresh = false) {
  try {
    const { MCPBridge } = await import('@claw/core/lib/mcp');

    // 1. Local tools
    const localTools = Object.values(tools).map(t => ({
      name: t.name,
      description: t.description,
      usage: usage[t.name] || { count: 0, lastUsed: 0 },
      isExternal: false
    }));

    // 2. MCP tools (use cache by default for dashboard speed)
    let externalToolsDefinitions: any[] = [];
    if (forceRefresh) {
      externalToolsDefinitions = await MCPBridge.getExternalTools();
    } else {
      externalToolsDefinitions = await MCPBridge.getCachedTools();
      // If cache is empty, fallback to one-time discovery
      if (externalToolsDefinitions.length === 0) {
        externalToolsDefinitions = await MCPBridge.getExternalTools();
      }
    }

    const mcpTools = externalToolsDefinitions.map((t: any) => ({
      name: t.name,
      description: t.description,
      usage: usage[t.name] || { count: 0, lastUsed: 0 },
      isExternal: true
    }));

    return [...localTools, ...mcpTools];
  } catch (e) {
    console.error('Error fetching all tools:', e);
    return Object.values(tools).map(t => ({
      name: t.name,
      description: t.description,
      usage: usage[t.name] || { count: 0, lastUsed: 0 },
      isExternal: false
    }));
  }
}
