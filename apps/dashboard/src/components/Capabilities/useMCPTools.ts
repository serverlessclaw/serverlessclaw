'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { logger } from '@claw/core/lib/logger';

interface MCPTool {
  name: string;
  description: string;
  usage?: { count: number; lastUsed: number };
  isExternal: boolean;
}

interface UseMCPToolsResult {
  mcpTools: MCPTool[];
  isLoading: boolean;
  discoveredCount: number;
  totalCount: number;
  refresh: () => Promise<void>;
}

export function useMCPTools(initialTools: MCPTool[]): UseMCPToolsResult {
  const [mcpTools, setMcpTools] = useState<MCPTool[]>(initialTools);
  const [isLoading, setIsLoading] = useState(false);
  const [discoveredCount, setDiscoveredCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const hasAttemptedDiscovery = useRef(false);

  const discoverTools = useCallback(async () => {
    hasAttemptedDiscovery.current = true;
    // Only discover if we have placeholder tools (skipConnection mode)
    const placeholderTools = initialTools.filter((t) => t.isExternal && t.name.endsWith('_tools'));

    if (placeholderTools.length === 0) {
      // Already have real tools, no need to discover
      return;
    }

    setIsLoading(true);
    setTotalCount(placeholderTools.length);

    try {
      // Fetch real tools from API
      const response = await fetch('/api/tools?refresh=true');
      if (!response.ok) throw new Error('Failed to fetch tools');

      const data = await response.json();
      const realTools = data.tools.filter((t: MCPTool) => t.isExternal);

      // Count MCP servers (not tools)
      const mcpServerNames = placeholderTools.map((t) => t.name.replace('_tools', ''));

      // Simulate progressive discovery for UX - one server at a time
      for (let i = 0; i < mcpServerNames.length; i++) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        setDiscoveredCount(i + 1);
      }

      // Update with all real tools after discovery
      setMcpTools((prev) => {
        const localTools = prev.filter((t) => !t.isExternal);
        return [...localTools, ...realTools];
      });

      toast.success(`Discovered ${mcpServerNames.length} MCP servers`);
    } catch (error) {
      logger.error('Error discovering MCP tools:', error);
      toast.error('Failed to discover MCP tools');
    } finally {
      setIsLoading(false);
      setDiscoveredCount(0);
      setTotalCount(0);
    }
  }, [initialTools]);

  // Auto-discover on mount if we have placeholders
  useEffect(() => {
    const placeholderTools = initialTools.filter((t) => t.isExternal && t.name.endsWith('_tools'));

    if (placeholderTools.length > 0 && !hasAttemptedDiscovery.current) {
      // Delay slightly to let page render first
      const timer = setTimeout(() => {
        discoverTools();
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [initialTools, discoverTools]);

  return {
    mcpTools,
    isLoading,
    discoveredCount,
    totalCount,
    refresh: discoverTools,
  };
}
