'use client';

import React, { useEffect, useState } from 'react';
import {
  Bot,
  Code,
  Brain,
  Search,
  FlaskConical,
  Shield,
  MessageSquareShare,
  GitMerge,
  Microscope,
  Gavel,
  Zap,
  X,
} from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Button from '@/components/ui/Button';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import { logger } from '@claw/core/lib/logger';

// Mapping string icon names to Lucide components
const ICON_MAP: Record<string, React.ElementType> = {
  Bot,
  Code,
  Brain,
  Search,
  FlaskConical,
  Shield,
  MessageSquareShare,
  GitMerge,
  Microscope,
  Gavel,
  Zap,
};

interface AgentConfig {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category?: string;
  agentType?: string;
}

interface AgentSelectorProps {
  onSelect: (agentId: string) => void;
  onClose: () => void;
  title?: string;
  excludeIds?: string[];
}

// Use a stable reference for the default empty array to prevent infinite re-render loops
// when this component is used in a useEffect dependency array.
const EMPTY_ARRAY: string[] = [];

export function AgentSelector({
  onSelect,
  onClose,
  title,
  excludeIds = EMPTY_ARRAY,
}: AgentSelectorProps) {
  const { t } = useTranslations();
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchAgents() {
      try {
        const res = await fetch('/api/agents');
        const data = await res.json();
        const agentsData = (data as { agents: Record<string, AgentConfig> }).agents || {};
        const llmAgents = Object.values(agentsData)
          .filter((a) => a.agentType !== 'logic' && !excludeIds.includes(a.id))
          .sort((a, b) => a.name.localeCompare(b.name));

        setAgents(llmAgents);
      } catch (e) {
        logger.error('Failed to fetch agents:', e);
      } finally {
        setIsLoading(false);
      }
    }
    fetchAgents();
  }, [excludeIds]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/60 backdrop-blur-md animate-in fade-in duration-300">
      <div
        className="glass-card-elevated w-full max-w-2xl border border-border rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(0,255,163,0.1)] flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyber-green/10 rounded-lg">
              <Bot size={20} className="text-cyber-green" />
            </div>
            <Typography
              variant="h3"
              weight="bold"
              color="primary"
              glow
              uppercase
              className="tracking-widest"
            >
              {title || t('AGENT_SELECTOR_TITLE')}
            </Typography>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="p-1 text-muted-foreground/40 hover:text-foreground"
            icon={<X size={20} />}
          />
        </header>

        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-12 h-12 border-2 border-cyber-green/20 border-t-cyber-green rounded-full animate-spin" />
              <Typography
                variant="mono"
                color="muted"
                className="text-xs uppercase tracking-[0.2em]"
              >
                {t('INITIALIZING_REGISTRY')}
              </Typography>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {agents.map((agent) => {
                const Icon = ICON_MAP[agent.icon || 'Bot'] || Bot;
                return (
                  <button
                    key={agent.id}
                    onClick={() => onSelect(agent.id)}
                    className="group flex items-start gap-4 p-4 rounded-xl border border-border bg-input hover:bg-cyber-green/5 hover:border-cyber-green/30 transition-all text-left"
                  >
                    <div className="p-3 rounded-lg bg-card-elevated border border-border group-hover:border-cyber-green/30 group-hover:text-cyber-green transition-colors shrink-0">
                      <Icon size={24} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <Typography
                          variant="body"
                          weight="bold"
                          color="primary"
                          className="group-hover:text-cyber-green transition-colors"
                        >
                          {agent.name}
                        </Typography>
                        {agent.category && (
                          <span className="text-[8px] font-mono font-black border border-border px-1.5 py-0.5 rounded opacity-40 uppercase">
                            {agent.category}
                          </span>
                        )}
                      </div>
                      <Typography
                        variant="caption"
                        color="muted"
                        className="line-clamp-2 text-xs leading-relaxed opacity-70"
                      >
                        {agent.description}
                      </Typography>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <footer className="px-6 py-4 border-t border-border bg-input/50 overflow-hidden">
          <Typography
            variant="mono"
            className="text-[10px] text-muted-foreground/20 uppercase tracking-[0.3em] font-black text-center"
          >
            Node_Discovery_Active // Protocol_V4
          </Typography>
        </footer>
      </div>
    </div>
  );
}
