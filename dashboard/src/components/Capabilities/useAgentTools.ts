/**
 * Shared hook for agent tool assignment logic
 * Consolidates duplicate pattern-detect issues across capabilities components
 */
import { useState, useTransition } from 'react';
import { updateAgentTools } from '../../app/capabilities/actions';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

import { AgentConfig, ConfirmModalState } from './types';

export function useAgentTools(agents: AgentConfig[]) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticAgents, setOptimisticAgents] = useState(agents);

  const handleToggleToolAssignment = async (
    agentId: string, 
    toolName: string, 
    isAttached: boolean
  ) => {
    const formData = new FormData();
    formData.append('agentId', agentId);
    
    const agent = optimisticAgents.find(a => a.id === agentId);
    if (!agent) return;

    const newTools = isAttached 
      ? agent.tools.filter(t => t !== toolName)
      : [...agent.tools, toolName];
    
    newTools.forEach(t => formData.append('tools', t));

    // Optimistic update
    setOptimisticAgents(prev => prev.map(a => 
      a.id === agentId ? { ...a, tools: newTools } : a
    ));

    startTransition(async () => {
      try {
        const result = await updateAgentTools(formData);
        if (result?.error) throw new Error(result.error);
        toast.success(isAttached ? `Revoked ${toolName} from ${agentId}` : `Assigned ${toolName} to ${agentId}`);
        router.refresh();
      } catch (_error) {
        toast.error('Sync failed. Reverting changes.');
        setOptimisticAgents(agents);
      }
    });
  };

  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    variant: 'warning'
  });

  const handleDetachTool = (agentId: string, toolName: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Neural Decoupling',
      message: `Are you sure you want to remove '${toolName}' from this agent? This will immediately revoke its access to this capability.`,
      variant: 'warning',
      onConfirm: () => handleToggleToolAssignment(agentId, toolName, true)
    });
  };

  return {
    optimisticAgents,
    setOptimisticAgents,
    isPending,
    handleToggleToolAssignment,
    handleDetachTool,
    confirmModal,
    setConfirmModal
  };
}