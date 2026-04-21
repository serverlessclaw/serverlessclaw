'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Paperclip, Edit2, Check, X, Brain, Keyboard, Plus, Bot } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import CyberConfirm from '@/components/CyberConfirm';
import Button from '@/components/ui/Button';
import { useChatConnection } from './useChatConnection';
import { ChatSidebar } from './ChatSidebar';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput } from './ChatInput';
import { QueuedMessagesList } from './QueuedMessages';
import { useChatMessages } from './useChatMessages';
import { useKeyboardShortcuts, type ShortcutDefinition } from '@/hooks/useKeyboardShortcuts';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import { AgentSelector } from './AgentSelector';
import { AgentType } from '@claw/core/lib/types/index';
import { logger } from '@claw/core/lib/logger';
import CyberTooltip from '@/components/CyberTooltip';
import type { ChatMessage } from './types';

/**
 * Visual constants and style configurations for the Chat component.
 */
const CHAT_STYLES = {
  GRADIENTS: {
    MAIN_BG:
      'bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-green/5 via-[#0a0a0a] to-[#0a0a0a]',
    DRAG_OVER: 'bg-cyber-green/10',
  },
  SHADOWS: {
    DROP_ZONE: 'shadow-[0_0_50px_rgba(0,255,163,0.2)]',
  },
  ANIMATIONS: {
    PULSE: 'animate-pulse',
    BOUNCE: 'animate-bounce',
  },
} as const;

/**
 * Main interface for the chat dashboard.
 * Manages chat messages, sessions, file uploads, and session settings.
 */
export default function ChatContent() {
  const { t } = useTranslations();
  // --- UI and Session State ---
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [isShaking, setIsShaking] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // --- Title Management State ---
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');

  // --- Deletion State ---
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);

  // --- Thinking Toggle ---
  const [showThinking, setShowThinking] = useState(true);

  // --- Multi-Agent / Collaboration State ---
  const [currentAgentId, setCurrentAgentId] = useState<string>(AgentType.SUPERCLAW);
  const [isAgentSelectorOpen, setIsAgentSelectorOpen] = useState(false);
  const [isInviteSelectorOpen, setIsInviteSelectorOpen] = useState(false);
  const [activeCollaborators, setActiveCollaborators] = useState<string[]>([AgentType.SUPERCLAW]);
  const [collaborationId, setCollaborationId] = useState<string | null>(null);
  const [isTransiting, setIsTransiting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const setMessagesRef = useRef<React.Dispatch<React.SetStateAction<ChatMessage[]>>>(() => undefined);
  const activeSessionRef = useRef<string>('');
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const createNewChatRef = useRef<() => void>(() => {});
  const currentSessionRef = useRef<typeof currentSession>(null);

  const shortcuts: ShortcutDefinition[] = [
    { keys: 'meta+k', handler: () => searchInputRef.current?.focus(), description: t('SHORTCUTS_FOCUS_SEARCH') },
    { keys: 'ctrl+k', handler: () => searchInputRef.current?.focus(), description: t('SHORTCUTS_FOCUS_SEARCH') },
    { keys: 'meta+alt+n', handler: () => createNewChatRef.current(), description: t('SHORTCUTS_NEW_CHAT') },
    { keys: 'ctrl+alt+n', handler: () => createNewChatRef.current(), description: t('SHORTCUTS_NEW_CHAT') },
    {
      keys: 'meta+/',
      handler: () => chatInputRef.current?.focus(),
      description: t('SHORTCUTS_FOCUS_CHAT_INPUT'),
    },
    {
      keys: 'ctrl+/',
      handler: () => chatInputRef.current?.focus(),
      description: t('SHORTCUTS_FOCUS_CHAT_INPUT'),
    },
    {
      keys: 'meta+e',
      handler: () => {
        if (activeSessionId && currentSessionRef.current) setIsEditingTitle(true);
      },
      description: t('SHORTCUTS_EDIT_SESSION_TITLE'),
    },
    {
      keys: 'ctrl+e',
      handler: () => {
        if (activeSessionId && currentSessionRef.current) setIsEditingTitle(true);
      },
      description: t('SHORTCUTS_EDIT_SESSION_TITLE'),
    },
    {
      keys: 'meta+t',
      handler: () => setShowThinking((prev) => !prev),
      description: t('SHORTCUTS_TOGGLE_THINKING_VISIBILITY'),
    },
    {
      keys: 'ctrl+t',
      handler: () => setShowThinking((prev) => !prev),
      description: t('SHORTCUTS_TOGGLE_THINKING_VISIBILITY'),
    },
    {
      keys: '?',
      handler: () => setShowShortcutsHelp((prev) => !prev),
      description: t('SHORTCUTS_SHOW_KEYBOARD_HELP'),
      preventDefault: false,
    },
  ];

  useKeyboardShortcuts(shortcuts, !!activeSessionId);
  const hasProcessedPrompt = useRef<boolean>(false);
  const isPostInFlight = useRef<boolean>(false);

  // --- Hooks ---
  const searchParams = useSearchParams();
  const router = useRouter();

  const chatConnection = useChatConnection(
    activeSessionId,
    setMessagesRef,
    setIsLoading,
    isPostInFlight
  );

  const {
    isRealtimeActive,
    sessions,
    pendingMessages,
    setPendingMessages,
    fetchSessions,
    skipNextHistoryFetch,
    seenMessageIds,
  } = chatConnection;

  const {
    messages,
    setMessages,
    attachments,
    setAttachments,
    sendMessage,
    handleFiles,
    handleToolApproval,
    handleToolRejection,
    handleToolClarification,
    handleTaskCancellation,
  } = useChatMessages(
    activeSessionId,
    setActiveSessionId,
    setIsLoading,
    isPostInFlight,
    seenMessageIds,
    fetchSessions,
    skipNextHistoryFetch,
    activeSessionRef
  );

  useEffect(() => {
    setMessagesRef.current = setMessages;
  }, [setMessages]);

  const currentSession = sessions.find((s) => s.sessionId === activeSessionId);

  // --- Title and Session Sync ---
  useEffect(() => {
    if (currentSession) {
      setEditedTitle(currentSession.title ?? t('CHAT_UNTITLED_TRACE'));
    }
  }, [currentSession, t]);

  useEffect(() => {
    activeSessionRef.current = activeSessionId;
    currentSessionRef.current = currentSession;
  }, [activeSessionId, currentSession]);

  // URL State Management
  useEffect(() => {
    const sessionFromUrl = searchParams.get('session');
    // Only update activeSessionId if URL has a different session parameter
    // Don't clear activeSessionId just because URL doesn't have it
    // (user-created sessions won't be in URL until manually navigated)
    if (sessionFromUrl && sessionFromUrl !== activeSessionId) {
      setActiveSessionId(sessionFromUrl);
    }

    const prompt = searchParams.get('prompt');
    if (prompt && !hasProcessedPrompt.current) {
      hasProcessedPrompt.current = true;
      setTimeout(() => sendMessage(prompt, { 
        agentId: currentAgentId, 
        collaborationId: collaborationId || undefined, 
        profile: showThinking ? 'thinking' : 'fast' 
      }), 500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (activeSessionId) {
      const currentParams = new URLSearchParams(window.location.search);
      if (currentParams.get('session') !== activeSessionId) {
        router.push(`?session=${activeSessionId}`, { scroll: false });
      }
    }
  }, [activeSessionId, router]);

  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
    }
  }, [activeSessionId, setMessages]);


  // --- Session Operations ---

  const saveTitle = async () => {
    if (!activeSessionId || !editedTitle.trim()) return;
    try {
      await fetch('/api/chat', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSessionId, title: editedTitle.trim() }),
      });
      setIsEditingTitle(false);
      fetchSessions();
    } catch (error) {
      logger.error('Failed to save title:', error);
    }
  };

  const togglePin = async (sessionId: string, isPinned: boolean) => {
    try {
      await fetch('/api/chat', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, isPinned }),
      });
      fetchSessions();
    } catch (error) {
      logger.error('Failed to toggle pin:', error);
    }
  };

  // --- Drag and Drop Logic ---

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  };

  const handleOptionClick = async (value: string, comment?: string) => {
    if (value.startsWith('APPROVE_TOOL_CALL:')) {
      await handleToolApproval(value.split(':')[1], comment);
    } else if (value.startsWith('REJECT_TOOL_CALL:')) {
      await handleToolRejection(value.split(':')[1], comment);
    } else if (value.startsWith('CLARIFY_TOOL_CALL:')) {
      await handleToolClarification(value.split(':')[1], comment);
    } else if (value.startsWith('CANCEL_TASK:')) {
      await handleTaskCancellation(value.split(':')[1], comment);
    } else {
      const fullMessage = comment ? `${value}\n\nComment: ${comment}` : value;
      sendMessage(fullMessage, { 
        agentId: currentAgentId, 
        collaborationId: collaborationId || undefined, 
        profile: showThinking ? 'thinking' : 'fast' 
      });
    }
  };

  // --- Session Management Handlers ---

  const createNewChat = (agentId?: string) => {
    if (agentId) {
      setCurrentAgentId(agentId);
      setActiveCollaborators([agentId]);
      setCollaborationId(null);
      setIsAgentSelectorOpen(false);
    } else {
      setIsAgentSelectorOpen(true);
      return;
    }

    if (!activeSessionId && agentId === currentAgentId) {
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 500);
      return;
    }

    seenMessageIds.current.clear();
    setActiveSessionId('');
    setMessages([]);
    setAttachments([]);
    router.push('/', { scroll: false });
  };

  const handleInviteAgent = async (agentId: string) => {
    setIsInviteSelectorOpen(false);
    
    if (activeCollaborators.includes(agentId)) return;

    // Transition to collaboration if this is the second agent
    if (!collaborationId) {
      setIsTransiting(true);
      try {
        const res = await fetch('/api/collaboration/transit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: activeSessionId,
            invitedAgentIds: [agentId],
            name: editedTitle
          })
        });
        const data = await res.json();
        if (data.collaborationId) {
          setCollaborationId(data.collaborationId);
          setActiveCollaborators(prev => [...prev, agentId, AgentType.FACILITATOR]);
          
          // Send a system-like message to notify about the transition
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `Collaboration mode activated. **${agentId}** and **Facilitator** have joined the session.`,
            agentName: 'System',
            messageId: `transit-${Date.now()}`
          }]);
        }
      } catch (e) {
        logger.error('Transit failed:', e);
      } finally {
        setIsTransiting(false);
      }
    } else {
      // Logic for adding agent to existing collaboration could go here
      setActiveCollaborators(prev => [...prev, agentId]);
    }
  };

  createNewChatRef.current = createNewChat;

  const deleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setSessionToDelete(sessionId);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!sessionToDelete) return;
    try {
      const response = await fetch(`/api/chat?sessionId=${sessionToDelete}`, { method: 'DELETE' });
      if (response.ok) {
        if (activeSessionId === sessionToDelete) {
          setActiveSessionId('');
          setMessages([]);
          router.push('/', { scroll: false });
        }
        fetchSessions();
      }
    } catch (error) {
      logger.error('Failed to delete session:', error);
    }
    setShowDeleteConfirm(false);
  };

  const confirmDeleteAll = async () => {
    try {
      const response = await fetch('/api/chat?sessionId=all', { method: 'DELETE' });
      if (response.ok) {
        setActiveSessionId('');
        setMessages([]);
        router.push('/', { scroll: false });
        fetchSessions();
      }
    } catch (error) {
      logger.error('Failed to delete all history:', error);
    }
    setShowDeleteAllConfirm(false);
  };

  // --- Queued Message Handlers ---

  const handleEditQueuedMessage = async (messageId: string, newContent: string) => {
    if (!activeSessionId) return;
    await fetch('/api/pending-messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: activeSessionId, messageId, content: newContent }),
    });
    setPendingMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, content: newContent } : m))
    );
  };

  const handleRemoveQueuedMessage = async (messageId: string) => {
    if (!activeSessionId) return;
    await fetch('/api/pending-messages', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: activeSessionId, messageId }),
    });
    setPendingMessages((prev) => prev.filter((m) => m.id !== messageId));
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <ChatSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSessionSelect={(id) => {
          if (activeSessionId !== id) {
            setMessages([]);
            setActiveSessionId(id);
          }
        }}
        onNewChat={createNewChat}
        onDeleteSession={deleteSession}
        onDeleteAll={() => setShowDeleteAllConfirm(true)}
        onTogglePin={togglePin}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchInputRef={searchInputRef}
      />

      <main
        className={`flex-1 flex flex-col min-w-0 ${CHAT_STYLES.GRADIENTS.MAIN_BG} transition-colors relative ${isDragging ? CHAT_STYLES.GRADIENTS.DRAG_OVER : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-cyber-green/10 border-2 border-dashed border-cyber-green pointer-events-none">
            <div
              className={`flex flex-col items-center gap-4 bg-black/80 p-12 rounded-2xl border border-cyber-green/30 ${CHAT_STYLES.SHADOWS.DROP_ZONE}`}
            >
              <Paperclip
                size={64}
                className={`text-cyber-green ${CHAT_STYLES.ANIMATIONS.BOUNCE}`}
              />
              <Typography variant="h2" weight="bold" color="primary" glow>
                {t('CHAT_DROP_FILES')}
              </Typography>
            </div>
          </div>
        )}

        <header className="px-6 py-4 border-b border-white/5 flex flex-row items-center justify-between shrink-0 min-h-[70px] gap-6">
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
                      className="bg-white/5 border border-cyber-green/30 rounded px-2 py-1 text-lg font-bold text-white outline-none w-full"
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
                      color="white"
                      glow
                      className="truncate uppercase text-xl"
                    >
                      {currentSession?.title || t('CHAT_UNTITLED_TRACE')}
                    </Typography>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsEditingTitle(true)}
                      className="p-1 opacity-0 group-hover/title:opacity-50 hover:opacity-100 text-white h-auto"
                      icon={<Edit2 size={14} />}
                    />
                  </div>
                )}
              </div>
            ) : (
              <Typography
                variant="h2"
                weight="bold"
                color="white"
                glow
                className="truncate uppercase text-xl"
              >
                {t('CHAT_DIRECT')}
              </Typography>
            )}
          </div>

          <div className="flex items-center gap-5">
            {/* Collaborators Section */}
            <div className="flex items-center gap-4">
              <div className="flex -space-x-3">
                {activeCollaborators.map((id) => (
                  <CyberTooltip key={id} content={id} position="bottom" showIcon={false} width="w-auto">
                    <div 
                      className={`relative flex items-center justify-center h-8 w-8 rounded-full ring-2 ring-[#0a0a0a] bg-black/40 border transition-all hover:scale-110 hover:z-10 group/avatar ${id === currentAgentId ? 'border-cyber-green/30 shadow-[0_0_15px_rgba(0,255,163,0.1)]' : 'border-white/10'}`}
                    >
                      <div className="flex items-center justify-center w-full h-full">
                        <Bot 
                          size={16} 
                          className={id === currentAgentId ? "text-cyber-green drop-shadow-[0_0_8px_rgba(0,255,163,0.5)]" : "text-cyber-blue"} 
                        />
                      </div>
                    </div>
                  </CyberTooltip>
                ))}
              </div>

              <CyberTooltip content={t('INVITE_AGENT')} position="bottom" showIcon={false} width="w-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsInviteSelectorOpen(true)}
                  className="px-3 h-8 rounded-full border border-dashed border-white/20 text-white/40 hover:text-cyber-green hover:border-cyber-green/40 hover:bg-cyber-green/5 transition-all flex items-center gap-2 group/invite"
                >
                  <Plus size={12} className="group-hover/invite:rotate-90 transition-transform" />
                  <span className="text-[10px] font-mono uppercase tracking-wider">
                    {t('INVITE')}
                  </span>
                </Button>
              </CyberTooltip>

              {collaborationId && (
                <CyberTooltip content={t('COLLABORATION_MODE_DESC')} position="bottom" showIcon={false}>
                  <div className="flex items-center gap-2 bg-cyber-blue/10 px-2 py-1 rounded border border-cyber-blue/30 ml-1 cursor-help">
                    <div className="w-1 h-1 rounded-full bg-cyber-blue animate-pulse" />
                    <Typography variant="mono" className="text-[8px] text-cyber-blue font-bold uppercase tracking-wider">
                      {t('COLLABORATION_MODE')}
                    </Typography>
                  </div>
                </CyberTooltip>
              )}
            </div>

            <div className="h-6 w-px bg-white/10 mx-1" />

            <div className="flex items-center gap-3">
              <CyberTooltip content={showThinking ? t('CHAT_HIDE_THINKING') : t('CHAT_SHOW_THINKING')} position="bottom" showIcon={false} width="w-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowThinking(!showThinking)}
                  className={`px-2 py-1 h-8 flex items-center gap-2 rounded-md transition-all ${showThinking ? 'bg-cyber-green/5 text-cyber-green border border-cyber-green/20' : 'text-white/40 hover:text-white/70'}`}
                  icon={<Brain size={18} />}
                >
                  <span className="text-[10px] font-mono uppercase tracking-wider hidden xl:inline">
                    {t('CHAT_THINKING')}
                  </span>
                </Button>
              </CyberTooltip>

              <CyberTooltip content={t('CHAT_KEYBOARD_SHORTCUTS')} position="bottom" showIcon={false} width="w-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowShortcutsHelp(true)}
                  className="p-1.5 h-8 w-8 rounded-md text-white/40 hover:text-cyber-green hover:bg-white/5 transition-all flex items-center justify-center"
                  icon={<Keyboard size={18} />}
                />
              </CyberTooltip>

              {isRealtimeActive && (
                <CyberTooltip content={t('CHAT_LIVE_STATUS')} position="bottom" showIcon={false} width="w-auto">
                  <div className="flex items-center gap-2 bg-cyber-green/10 px-3 py-1 rounded border border-cyber-green/30 h-8">
                    <div
                      className={`w-1.5 h-1.5 rounded-full bg-cyber-green ${CHAT_STYLES.ANIMATIONS.PULSE}`}
                    />
                    <Typography variant="mono" weight="bold" className="text-cyber-green text-[10px] uppercase">
                      {t('CHAT_LIVE')}
                    </Typography>
                  </div>
                </CyberTooltip>
              )}
            </div>
          </div>
        </header>

        <ChatMessageList
          messages={messages}
          isLoading={isLoading}
          scrollRef={scrollRef}
          onOptionClick={handleOptionClick}
          showThinking={showThinking}
        />

        <ChatInput
          input={input}
          setInput={setInput}
          isLoading={isLoading}
          onSend={(e) => {
            e.preventDefault();
            sendMessage(input, { 
              agentId: currentAgentId, 
              collaborationId: collaborationId || undefined, 
              profile: showThinking ? 'thinking' : 'fast' 
            });
            setInput('');
          }}
          attachments={attachments}
          onRemoveAttachment={(i) => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
          fileInputRef={fileInputRef}
          onFileSelect={(e) => {
            if (e.target.files) handleFiles(Array.from(e.target.files));
          }}
          isShaking={isShaking}
          chatInputRef={chatInputRef}
          // Pass current agent info to input if needed
        />

        {isAgentSelectorOpen && (
          <AgentSelector 
            onSelect={createNewChat}
            onClose={() => setIsAgentSelectorOpen(false)}
            title={t('CHAT_SIDEBAR_NEW_CHAT')}
          />
        )}

        {isInviteSelectorOpen && (
          <AgentSelector 
            onSelect={handleInviteAgent}
            onClose={() => setIsInviteSelectorOpen(false)}
            title={t('INVITE_AGENT')}
            excludeIds={activeCollaborators}
          />
        )}

        {isTransiting && (
           <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
             <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-2 border-cyber-blue/20 border-t-cyber-blue rounded-full animate-spin" />
                <Typography variant="mono" color="white" className="text-xs uppercase tracking-[0.2em] animate-pulse text-cyber-blue">
                  Initiating_Collaboration_Protocol...
                </Typography>
             </div>
           </div>
        )}

        {pendingMessages.length > 0 && (
          <div className="px-6 pb-4">
            <QueuedMessagesList
              messages={pendingMessages}
              onEdit={handleEditQueuedMessage}
              onRemove={handleRemoveQueuedMessage}
            />
          </div>
        )}
      </main>

      <CyberConfirm
        isOpen={showDeleteConfirm}
        title={t('CHAT_DELETE_CONVERSATION')}
        message={t('CHAT_DELETE_CONFIRM')}
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        variant="warning"
      />
      <CyberConfirm
        isOpen={showDeleteAllConfirm}
        title={t('CHAT_PURGE_ALL_HISTORY')}
        message={t('CHAT_PURGE_WARNING')}
        onConfirm={confirmDeleteAll}
        onCancel={() => setShowDeleteAllConfirm(false)}
        variant="danger"
      />

      {showShortcutsHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowShortcutsHelp(false)}
        >
          <div
            className="glass-card border border-white/10 bg-black/90 rounded-2xl p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Keyboard size={18} className="text-cyber-green" />
                <Typography variant="h3" weight="bold" color="white" glow className="uppercase">
                  {t('CHAT_KEYBOARD_SHORTCUTS_TITLE')}
                </Typography>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowShortcutsHelp(false)}
                className="p-1 text-white/40 hover:text-white"
                icon={<X size={16} />}
              />
            </div>
            <div className="space-y-2 text-[11px] font-mono">
              {[
                { keys: 'Cmd/Ctrl + K', desc: t('SHORTCUTS_FOCUS_SEARCH') },
                { keys: 'Cmd/Ctrl + Alt + N', desc: t('SHORTCUTS_NEW_CHAT') },
                { keys: 'Cmd/Ctrl + /', desc: t('SHORTCUTS_FOCUS_CHAT_INPUT') },
                { keys: 'Cmd/Ctrl + E', desc: t('SHORTCUTS_EDIT_SESSION_TITLE') },
                { keys: 'Cmd/Ctrl + T', desc: t('SHORTCUTS_TOGGLE_THINKING') },
                { keys: 'Cmd/Ctrl + Enter', desc: t('SHORTCUTS_SEND_MESSAGE') },
                { keys: 'Shift + Enter', desc: t('SHORTCUTS_NEW_LINE') },
                { keys: 'Escape', desc: t('SHORTCUTS_CLOSE_MODALS') },
                { keys: '?', desc: t('SHORTCUTS_SHOW_HELP') },
              ].map(({ keys, desc }) => (
                <div
                  key={keys}
                  className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0"
                >
                  <span className="text-white/60">{desc}</span>
                  <kbd className="bg-white/10 border border-white/10 rounded px-2 py-0.5 text-[10px] text-cyber-green">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
