'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Command,
  Users,
  Activity,
  Settings,
  MessageSquare,
  Shield,
  Brain,
  Zap,
  X,
} from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import { ROUTES } from '@/lib/constants';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

interface Action {
  id: string;
  label: string;
  shortcut?: string;
  icon: React.ElementType;
  route: string;
  category: string;
}

/**
 * Command Palette (Cmd+K)
 * Provides global search and navigation within the Neural Hub.
 */
const CommandPalette: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();
  const { t } = useTranslations();
  const inputRef = useRef<HTMLInputElement>(null);

  const actions: Action[] = [
    {
      id: 'chat',
      label: t('CHAT_DIRECT'),
      icon: MessageSquare,
      route: ROUTES.CHAT,
      category: 'OPERATIONS',
    },
    {
      id: 'trace',
      label: t('TRACE_INTEL'),
      icon: Activity,
      route: ROUTES.TRACE,
      category: 'OPERATIONS',
    },
    {
      id: 'agents',
      label: t('AGENTS'),
      icon: Users,
      route: ROUTES.AGENTS,
      category: 'INTELLIGENCE',
    },
    {
      id: 'memory',
      label: t('MEMORY_RESERVE'),
      icon: Brain,
      route: ROUTES.MEMORY,
      category: 'INTELLIGENCE',
    },
    {
      id: 'observability',
      label: t('OBSERVABILITY'),
      icon: Zap,
      route: ROUTES.OBSERVABILITY,
      category: 'OBSERVABILITY',
    },
    {
      id: 'security',
      label: t('SECURITY_MANIFEST'),
      icon: Shield,
      route: ROUTES.SECURITY,
      category: 'GOVERNANCE',
    },
    {
      id: 'settings',
      label: t('CONFIG'),
      icon: Settings,
      route: ROUTES.SETTINGS,
      category: 'GOVERNANCE',
    },
  ];

  const filteredActions = actions.filter(
    (action) =>
      action.label.toLowerCase().includes(query.toLowerCase()) ||
      action.category.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setTimeout(() => setQuery(''), 0);
      setTimeout(() => setSelectedIndex(0), 0);
    }
  }, [isOpen]);

  const handleSelect = (action: Action) => {
    router.push(action.route);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredActions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredActions.length) % filteredActions.length);
    } else if (e.key === 'Enter') {
      if (filteredActions[selectedIndex]) {
        handleSelect(filteredActions[selectedIndex]);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="fixed inset-0" onClick={() => setIsOpen(false)} />

      <Card
        variant="glass"
        padding="none"
        className="w-full max-w-2xl overflow-hidden shadow-2xl border-cyber-green/30 relative animate-in zoom-in-95 duration-200"
      >
        <div className="flex items-center px-4 py-3 border-b border-border/50 bg-background/50">
          <Search size={18} className="text-cyber-green mr-3" />
          <input
            ref={inputRef}
            type="text"
            placeholder={t('AGENTS_SEARCH_PLACEHOLDER') || 'Search the Neural Hub...'}
            className="flex-1 bg-transparent border-none outline-none text-foreground font-mono text-sm placeholder:text-muted/50"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-card/50">
            <Command size={10} className="text-muted" />
            <Typography variant="mono" className="text-[10px] text-muted">
              K
            </Typography>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="ml-3 p-1 rounded hover:bg-foreground/5 text-muted hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-2 custom-scrollbar">
          {filteredActions.length > 0 ? (
            <div className="px-2 space-y-1">
              {filteredActions.map((action, index) => {
                const Icon = action.icon;
                const isSelected = index === selectedIndex;

                return (
                  <button
                    key={action.id}
                    onClick={() => handleSelect(action)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded transition-all duration-150 group ${
                      isSelected
                        ? 'bg-cyber-green/10 text-cyber-green translate-x-1'
                        : 'text-foreground/70 hover:bg-foreground/5'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-1.5 rounded ${isSelected ? 'bg-cyber-green/20' : 'bg-foreground/5'}`}
                      >
                        <Icon size={16} />
                      </div>
                      <div className="text-left">
                        <Typography
                          variant="mono"
                          weight="bold"
                          className="text-xs uppercase tracking-wider block"
                        >
                          {action.label}
                        </Typography>
                        <Typography variant="caption" className="text-[9px] opacity-40 uppercase">
                          {action.category}
                        </Typography>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold opacity-60">
                        <span>OPEN</span>
                        <Zap size={10} className="animate-pulse" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="py-12 flex flex-col items-center justify-center text-muted opacity-40">
              <Search size={32} className="mb-4" />
              <Typography variant="mono" className="text-xs uppercase tracking-[0.2em]">
                No Results Detected
              </Typography>
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border/30 bg-background/30 flex items-center justify-between">
          <div className="flex gap-4">
            <div className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded border border-border bg-card text-[9px] font-mono text-muted">
                ↑↓
              </kbd>
              <Typography
                variant="caption"
                className="text-[9px] uppercase tracking-tighter text-muted"
              >
                Navigate
              </Typography>
            </div>
            <div className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded border border-border bg-card text-[9px] font-mono text-muted">
                ↵
              </kbd>
              <Typography
                variant="caption"
                className="text-[9px] uppercase tracking-tighter text-muted"
              >
                Select
              </Typography>
            </div>
          </div>
          <Typography
            variant="mono"
            className="text-[8px] text-muted-more uppercase tracking-widest"
          >
            Neural_Hub v0.1.0
          </Typography>
        </div>
      </Card>
    </div>
  );
};

export default CommandPalette;
