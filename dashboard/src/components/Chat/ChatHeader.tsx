'use client';

import React from 'react';
import { Edit2, Check, X, Brain, Keyboard, Plus, Bot, Database } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Button from '@/components/ui/Button';
import CyberTooltip from '@/components/CyberTooltip';
import type { ConversationMeta } from '@claw/core/lib/types/memory';

import { TranslationKey } from '@/components/Providers/TranslationsProvider';

interface ChatHeaderProps {
  activeSessionId: string;
  currentSession: ConversationMeta | undefined;
  isEditingTitle: boolean;
  setIsEditingTitle: (val: boolean) => void;
  editedTitle: string;
  setEditedTitle: (val: string) => void;
  saveTitle: () => void;
  activeCollaborators: string[];
  currentAgentId: string;
  collaborationId: string | null;
  setIsInviteSelectorOpen: (val: boolean) => void;
  showThinking: boolean;
  setShowThinking: (val: boolean) => void;
  isRealtimeActive: boolean;
  isContextPanelOpen: boolean;
  setIsContextPanelOpen: (val: boolean) => void;
  t: (key: TranslationKey) => string;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  activeSessionId,
  currentSession,
  isEditingTitle,
  setIsEditingTitle,
  editedTitle,
  setEditedTitle,
  saveTitle,
  activeCollaborators,
  currentAgentId,
  collaborationId,
  setIsInviteSelectorOpen,
  showThinking,
  setShowThinking,
  isRealtimeActive,
  isContextPanelOpen,
  setIsContextPanelOpen,
  t,
}) => {
  return (
    <header className="px-6 py-4 border-b border-border flex flex-row items-center justify-between shrink-0 min-h-[70px] gap-6">
      <div className="flex-1 min-w-0">
        {activeSessionId && currentSession ? (
          <div className="flex items-center gap-3 group/title">
            {isEditingTitle ? (
              <div className="flex items-center gap-2 flex-1 max-w-xl">
                <input
                  autoFocus
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveTitle();
                    if (e.key === 'Escape') {
                      setIsEditingTitle(false);
                      setEditedTitle(currentSession?.title ?? t('CHAT_UNTITLED_TRACE'));
                    }
                  }}
                  className="bg-input border border-cyber-green/30 rounded px-2 py-1 text-lg font-bold text-foreground outline-none w-full"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={saveTitle}
                  className="p-1 hover:text-cyber-green h-auto"
                  icon={<Check size={18} />}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditingTitle(false)}
                  className="p-1 hover:text-red-500 h-auto"
                  icon={<X size={18} />}
                />
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Typography
                  variant="h2"
                  weight="bold"
                  color="primary"
                  glow
                  className="truncate uppercase text-xl"
                >
                  {currentSession?.title || t('CHAT_UNTITLED_TRACE')}
                </Typography>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditingTitle(true)}
                  className="p-1 opacity-0 group-hover/title:opacity-50 hover:opacity-100 text-muted-foreground h-auto"
                  icon={<Edit2 size={14} />}
                />
              </div>
            )}
          </div>
        ) : (
          <Typography
            variant="h2"
            weight="bold"
            color="primary"
            glow
            className="truncate uppercase text-xl"
          >
            {t('CHAT_DIRECT')}
          </Typography>
        )}
      </div>

      <div className="flex items-center gap-5">
        <div className="flex items-center gap-4">
          <div className="flex -space-x-3">
            {activeCollaborators.map((id) => (
              <CyberTooltip key={id} content={id} position="bottom" showIcon={false} width="w-auto">
                <div
                  className={`relative flex items-center justify-center h-8 w-8 rounded-full ring-2 ring-background bg-card border transition-all hover:scale-110 hover:z-10 group/avatar ${id === currentAgentId ? 'border-cyber-green/30 shadow-[0_0_15px_rgba(0,255,163,0.1)]' : 'border-border'}`}
                >
                  <div className="flex items-center justify-center w-full h-full">
                    <Bot
                      size={16}
                      className={
                        id === currentAgentId
                          ? 'text-cyber-green drop-shadow-[0_0_8px_rgba(0,255,163,0.5)]'
                          : 'text-cyber-blue'
                      }
                    />
                  </div>
                </div>
              </CyberTooltip>
            ))}
          </div>

          <CyberTooltip
            content={t('INVITE_AGENT')}
            position="bottom"
            showIcon={false}
            width="w-auto"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsInviteSelectorOpen(true)}
              className="px-3 h-8 rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground hover:text-cyber-green hover:border-cyber-green/40 hover:bg-cyber-green/5 transition-all flex items-center gap-2 group/invite"
            >
              <Plus size={12} className="group-hover/invite:rotate-90 transition-transform" />
              <span className="text-[10px] font-mono uppercase tracking-wider">{t('INVITE')}</span>
            </Button>
          </CyberTooltip>

          {collaborationId && (
            <CyberTooltip content={t('COLLABORATION_MODE_DESC')} position="bottom" showIcon={false}>
              <div className="flex items-center gap-2 bg-cyber-blue/10 px-2 py-1 rounded border border-cyber-blue/30 ml-1 cursor-help">
                <div className="w-1 h-1 rounded-full bg-cyber-blue animate-pulse" />
                <Typography
                  variant="mono"
                  className="text-[8px] text-cyber-blue font-bold uppercase tracking-wider"
                >
                  {t('COLLABORATION_MODE')}
                </Typography>
              </div>
            </CyberTooltip>
          )}
        </div>

        <div className="h-6 w-px bg-border mx-1" />

        <div className="flex items-center gap-3">
          <CyberTooltip
            content={showThinking ? t('CHAT_HIDE_THINKING') : t('CHAT_SHOW_THINKING')}
            position="bottom"
            showIcon={false}
            width="w-auto"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowThinking(!showThinking)}
              className={`px-2 py-1 h-8 flex items-center gap-2 rounded-md transition-all ${showThinking ? 'bg-cyber-green/5 text-cyber-green border border-cyber-green/20' : 'text-muted-foreground hover:text-foreground'}`}
              icon={<Brain size={18} />}
            >
              <span className="text-[10px] font-mono uppercase tracking-wider hidden xl:inline">
                {t('CHAT_THINKING')}
              </span>
            </Button>
          </CyberTooltip>

          <CyberTooltip
            content="Toggle Session Intelligence"
            position="bottom"
            showIcon={false}
            width="w-auto"
          >
            <Button
              variant="ghost"
              size="sm"
              aria-label="Toggle Session Intelligence"
              onClick={() => setIsContextPanelOpen(!isContextPanelOpen)}
              className={`p-1.5 h-8 w-8 rounded-md transition-all ${isContextPanelOpen ? 'bg-cyber-blue/10 text-cyber-blue border border-cyber-blue/20 shadow-[0_0_10px_rgba(0,255,255,0.1)]' : 'text-muted-foreground/50 hover:text-cyber-green hover:bg-foreground/5'}`}
              icon={<Database size={18} />}
            />
          </CyberTooltip>

          {isRealtimeActive && (
            <CyberTooltip
              content={t('CHAT_LIVE_STATUS')}
              position="bottom"
              showIcon={false}
              width="w-auto"
            >
              <div className="flex items-center gap-2 bg-cyber-green/10 px-3 py-1 rounded border border-cyber-green/30 h-8">
                <div className={`w-1.5 h-1.5 rounded-full bg-cyber-green animate-pulse`} />
                <Typography
                  variant="mono"
                  weight="bold"
                  className="text-cyber-green text-[10px] uppercase"
                >
                  {t('CHAT_LIVE')}
                </Typography>
              </div>
            </CyberTooltip>
          )}
        </div>
      </div>
    </header>
  );
};
