'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

interface MCPTool {
  name: string;
  description: string;
  usage: { count: number; lastUsed: number };
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

  const discoverTools = useCallback(async () => {
    // Only discover if we have placeholder tools (skipConnection mode)
    const placeholderTools = initialTools.filter(t => 
      t.isExternal && t.name.endsWith('_tools')
    );
    
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
      
      // Simulate progressive discovery for UX
      for (let i = 0; i < realTools.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 200));
        setDiscoveredCount(i + 1);
        setMcpTools(prev => {
          const localTools = prev.filter(t => !t.isExternal);
          const discoveredSoFar = realTools.slice(0, i + 1);
          return [...localTools, ...discoveredSoFar];
        });
      }

      toast.success(`Discovered ${realTools.length} MCP tools`);
    } catch (error) {
      console.error('Error discovering MCP tools:', error);
      toast.error('Failed to discover MCP tools');
    } finally {
      setIsLoading(false);
      setDiscoveredCount(0);
      setTotalCount(0);
    }
  }, [initialTools]);

  // Auto-discover on mount if we have placeholders
  useEffect(() => {
    const placeholderTools = initialTools.filter(t => 
      t.isExternal && t.name.endsWith('_tools')
    );
    
    if (placeholderTools.length > 0) {
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
    refresh: discoverTools
  };
}