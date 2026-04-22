'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Paperclip } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import CyberConfirm from '@/components/CyberConfirm';
import { useChatConnection } from './useChatConnection';
import { ChatSidebar } from './ChatSidebar';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput } from './ChatInput';
import { QueuedMessagesList } from './QueuedMessages';
import { useChatMessages } from './useChatMessages';
import { useKeyboardShortcuts, type ShortcutDefinition } from '@/hooks/useKeyboardShortcuts';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import { useUICommand } from '@/components/Providers/UICommandProvider';
import { AgentSelector } from './AgentSelector';
import { AgentType } from '@claw/core/lib/types/index';
import { logger } from '@claw/core/lib/logger';
import type { ChatMessage } from './types';
import { ChatHeader } from './ChatHeader';
import { ShortcutsHelp } from './ShortcutsHelp';
import { ContextPanel } from './ContextPanel';
import type { ConversationMeta } from '@claw/core/lib/types/memory';

/**
 * Visual constants and style configurations for the Chat component.
 */
const CHAT_STYLES = {
  GRADIENTS: {
    MAIN_BG:
      'bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-green/5 via-background to-background',
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
  const { setActiveModal, activeModal } = useUICommand();
  // --- UI and Session State ---
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [mounted, setMounted] = useState(false);
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

  // --- Context Panel (Intelligence) ---
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(false);

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
  const setMessagesRef = useRef<React.Dispatch<React.SetStateAction<ChatMessage[]>>>(
    () => undefined
  );
  const activeSessionRef = useRef<string>('');
  const createNewChatRef = useRef<() => void>(() => {});
  const currentSessionRef = useRef<ConversationMeta | null | undefined>(null);

  const shortcuts: ShortcutDefinition[] = [
    {
      keys: 'meta+k',
      handler: () => searchInputRef.current?.focus(),
      description: t('SHORTCUTS_FOCUS_SEARCH'),
    },
    {
      keys: 'ctrl+k',
      handler: () => searchInputRef.current?.focus(),
      description: t('SHORTCUTS_FOCUS_SEARCH'),
    },
    {
      keys: 'meta+alt+n',
      handler: () => createNewChatRef.current(),
      description: t('SHORTCUTS_NEW_CHAT'),
    },
    {
      keys: 'ctrl+alt+n',
      handler: () => createNewChatRef.current(),
      description: t('SHORTCUTS_NEW_CHAT'),
    },
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
      handler: () => setActiveModal(activeModal === 'shortcuts' ? null : 'shortcuts'),
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
    setMounted(true);
  }, []);

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
    if (sessionFromUrl && sessionFromUrl !== activeSessionId) {
      setActiveSessionId(sessionFromUrl);
    }

    const prompt = searchParams.get('prompt');
    if (prompt && !hasProcessedPrompt.current) {
      hasProcessedPrompt.current = true;
      setTimeout(
        () =>
          sendMessage(prompt, {
            agentId: currentAgentId,
            collaborationId: collaborationId || undefined,
            profile: showThinking ? 'thinking' : 'fast',
          }),
        500
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (mounted && activeSessionId) {
      const currentParams = new URLSearchParams(window.location.search);
      if (currentParams.get('session') !== activeSessionId) {
        router.push(`?session=${activeSessionId}`, { scroll: false });
      }
    }
  }, [activeSessionId, router, mounted]);

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
        profile: showThinking ? 'thinking' : 'fast',
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
    if (mounted) {
      router.push('/', { scroll: false });
    }
  };

  const handleInviteAgent = async (agentId: string) => {
    setIsInviteSelectorOpen(false);

    if (activeCollaborators.includes(agentId)) return;

    if (!collaborationId) {
      setIsTransiting(true);
      try {
        const res = await fetch('/api/collaboration/transit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: activeSessionId,
            invitedAgentIds: [agentId],
            name: editedTitle,
          }),
        });
        const data = await res.json();
        if (data.collaborationId) {
          setCollaborationId(data.collaborationId);
          setActiveCollaborators((prev) => [...prev, agentId, AgentType.FACILITATOR]);

          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: `Collaboration mode activated. **${agentId}** and **Facilitator** have joined the session.`,
              agentName: 'System',
              messageId: `transit-${Date.now()}`,
            },
          ]);
        }
      } catch (e) {
        logger.error('Transit failed:', e);
      } finally {
        setIsTransiting(false);
      }
    } else {
      setActiveCollaborators((prev) => [...prev, agentId]);
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
          if (mounted) {
            router.push('/', { scroll: false });
          }
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
        if (mounted) {
          router.push('/', { scroll: false });
        }
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
              className={`flex flex-col items-center gap-4 bg-background/80 p-12 rounded-2xl border border-cyber-green/30 ${CHAT_STYLES.SHADOWS.DROP_ZONE}`}
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

        <ChatHeader
          activeSessionId={activeSessionId}
          currentSession={currentSession}
          isEditingTitle={isEditingTitle}
          setIsEditingTitle={setIsEditingTitle}
          editedTitle={editedTitle}
          setEditedTitle={setEditedTitle}
          saveTitle={saveTitle}
          activeCollaborators={activeCollaborators}
          currentAgentId={currentAgentId}
          collaborationId={collaborationId}
          setIsInviteSelectorOpen={setIsInviteSelectorOpen}
          showThinking={showThinking}
          setShowThinking={setShowThinking}
          isRealtimeActive={isRealtimeActive}
          isContextPanelOpen={isContextPanelOpen}
          setIsContextPanelOpen={setIsContextPanelOpen}
          t={t}
        />

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
              profile: showThinking ? 'thinking' : 'fast',
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
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/40 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-2 border-cyber-blue/20 border-t-cyber-blue rounded-full animate-spin" />
              <Typography
                variant="mono"
                color="primary"
                className="text-xs uppercase tracking-[0.2em] animate-pulse text-cyber-blue"
              >
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

      <ContextPanel
        isOpen={isContextPanelOpen}
        onClose={() => setIsContextPanelOpen(false)}
        sessionId={activeSessionId}
      />

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
    </div>
  );
}
