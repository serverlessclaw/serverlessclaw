/**
 * Shared types for Capabilities components
 * Consolidates duplicate interface definitions across capabilities files
 */
import type { Tool } from '@/lib/types/ui';

export interface AgentConfig {
  id: string;
  name: string;
  tools: string[];
  usage?: Record<string, { count: number; lastUsed: number }>;
}

export interface ConfirmModalState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  variant: 'danger' | 'warning';
}

export interface CapabilitiesViewProps {
  allTools: Tool[];
  mcpServers: Record<string, unknown>;
  agents: AgentConfig[];
}
