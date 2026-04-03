'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Paperclip, Edit2, Check, X, Brain } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import CyberConfirm from '@/components/CyberConfirm';
import Button from '@/components/ui/Button';
import { AGENT_ERRORS } from '@/lib/constants';
import { THEME } from '@/lib/theme';
import { useChatConnection } from './useChatConnection';
import { ChatSidebar } from './ChatSidebar';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput } from './ChatInput';
import { QueuedMessagesList } from './QueuedMessages';
import { useChatMessages } from './useChatMessages';
import { ChatMessage, AttachmentPreview, HistoryMessage, ToolCall } from './types';
import type { PendingMessage } from '@claw/core/lib/types/session';

/**
 * Visual constants and style configurations for the Chat component.
 */
const CHAT_STYLES = {
  GRADIENTS: {
    MAIN_BG: 'bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-green/5 via-[#0a0a0a] to-[#0a0a0a]',
    DRAG_OVER: 'bg-cyber-green/10',
  },
  SHADOWS: {
    DROP_ZONE: 'shadow-[0_0_50px_rgba(0,255,163,0.2)]',
  },
  ANIMATIONS: {
    PULSE: 'animate-pulse',
    BOUNCE: 'animate-bounce',
  }
} as const;

/**
 * Interface for the Chat API response.
 */
interface ChatApiResponse {
  reply?: string;
  thought?: string;
  messageId?: string;
  agentName?: string;
  tool_calls?: ToolCall[];
  error?: string;
  details?: string;
}

/**
 * Main interface for the chat dashboard.
 * Manages chat messages, sessions, file uploads, and session settings.
 */
export default function ChatContent() {
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

  // --- Queued Messages State ---
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);

  // --- Refs ---
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeSessionRef = useRef<string>('');
  const hasProcessedPrompt = useRef<boolean>(false);
  const isPostInFlight = useRef<boolean>(false);

  // --- Hooks ---
  const searchParams = useSearchParams();
  const router = useRouter();

  const { 
    isRealtimeActive, 
    sessions, 
    fetchSessions, 
    skipNextHistoryFetch, 
    seenMessageIds 
  } = useChatConnection(
    activeSessionId,
    () => {}, // setMessages will be from useChatMessages
    setIsLoading,
    isPostInFlight
  );

  const {
    messages,
    setMessages,
    attachments,
    setAttachments,
    fetchHistory,
    sendMessage,
    updateAssistantResponse,
    handleConnectionError,
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

  const currentSession = sessions.find(s => s.sessionId === activeSessionId);

  // --- Title and Session Sync ---
  useEffect(() => {
    if (currentSession) {
      setEditedTitle(currentSession.title ?? 'Untitled Trace');
    }
  }, [currentSession]);

  useEffect(() => {
    activeSessionRef.current = activeSessionId;
  }, [activeSessionId]);

  // URL State Management
  useEffect(() => {
    const sessionFromUrl = searchParams.get('session');
    if (sessionFromUrl && sessionFromUrl !== activeSessionId) {
      setActiveSessionId(sessionFromUrl);
    } else if (!sessionFromUrl && activeSessionId) {
      setActiveSessionId('');
    }

    const prompt = searchParams.get('prompt');
    if (prompt && !hasProcessedPrompt.current) {
      hasProcessedPrompt.current = true;
      setTimeout(() => sendMessage(prompt), 500);
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
    if (activeSessionId) {
      if (skipNextHistoryFetch.current) {
        skipNextHistoryFetch.current = false;
        return;
      }
      fetchHistory(activeSessionId);
    } else {
      setMessages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  // --- Fetch Pending Messages ---
  useEffect(() => {
    if (!activeSessionId || isLoading) {
      setPendingMessages([]);
      return;
    }
    const fetchPending = async () => {
      try {
        const res = await fetch(`/api/pending-messages?sessionId=${activeSessionId}`);
        if (res.ok) {
          const data = await res.json();
          setPendingMessages(data.pendingMessages ?? []);
        }
      } catch {
        // Silently ignore fetch errors for pending messages
      }
    };
    fetchPending();
    const interval = setInterval(fetchPending, 10000);
    return () => clearInterval(interval);
  }, [activeSessionId, isLoading]);

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
      console.error('Failed to save title:', error);
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
      console.error('Failed to toggle pin:', error);
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
      sendMessage(fullMessage);
    }
  };

  // --- Session Management Handlers ---

  const createNewChat = () => {
    if (!activeSessionId) {
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
      console.error('Failed to delete session:', error); 
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
      console.error('Failed to delete all history:', error); 
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
    setPendingMessages(prev =>
      prev.map(m => (m.id === messageId ? { ...m, content: newContent } : m))
    );
  };

  const handleRemoveQueuedMessage = async (messageId: string) => {
    if (!activeSessionId) return;
    await fetch('/api/pending-messages', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: activeSessionId, messageId }),
    });
    setPendingMessages(prev => prev.filter(m => m.id !== messageId));
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <ChatSidebar 
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSessionSelect={(id) => { if (activeSessionId !== id) { setMessages([]); setActiveSessionId(id); } }}
        onNewChat={createNewChat}
        onDeleteSession={deleteSession}
        onDeleteAll={() => setShowDeleteAllConfirm(true)}
        onTogglePin={togglePin}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
      />

      <main 
        className={`flex-1 flex flex-col min-w-0 ${CHAT_STYLES.GRADIENTS.MAIN_BG} transition-colors relative ${isDragging ? CHAT_STYLES.GRADIENTS.DRAG_OVER : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-cyber-green/10 border-2 border-dashed border-cyber-green pointer-events-none">
            <div className={`flex flex-col items-center gap-4 bg-black/80 p-12 rounded-2xl border border-cyber-green/30 ${CHAT_STYLES.SHADOWS.DROP_ZONE}`}>
              <Paperclip size={64} className={`text-cyber-green ${CHAT_STYLES.ANIMATIONS.BOUNCE}`} />
              <Typography variant="h2" weight="bold" color="primary" glow>DROP FILES TO UPLOAD</Typography>
            </div>
          </div>
        )}
        
        <header className="px-6 pb-6 pt-10 border-b border-white/5 flex flex-col lg:flex-row lg:justify-between lg:items-end shrink-0 min-h-[70px] gap-6">
          <div className="flex-1 min-w-0 mr-4">
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
                           setEditedTitle(currentSession?.title ?? 'Untitled Trace');
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
                    <Typography variant="h2" weight="bold" color="white" glow className="truncate uppercase">
                       {currentSession?.title || 'Untitled Trace'}
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
              <Typography variant="h2" weight="bold" color="white" glow className="truncate uppercase">
                Direct Chat
              </Typography>
            )}
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowThinking(!showThinking)}
              className={`p-1 flex items-center gap-2 transition-colors ${showThinking ? 'text-cyber-green' : 'text-white/40 hover:text-white/70'}`}
              title={showThinking ? "Hide thinking blocks" : "Show thinking blocks"}
              icon={<Brain size={18} />}
            >
              <span className="text-[10px] font-mono uppercase tracking-wider hidden sm:inline">Thinking</span>
            </Button>

            {isRealtimeActive && (
              <div className="flex items-center gap-2 bg-cyber-green/10 px-3 py-1 rounded border border-cyber-green/30">
                 <div className={`w-1.5 h-1.5 rounded-full bg-cyber-green ${CHAT_STYLES.ANIMATIONS.PULSE}`} />
                 <Typography variant="mono" weight="bold" className="text-cyber-green text-[10px]">LIVE</Typography>
              </div>
            )}
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
          onSend={(e) => { e.preventDefault(); sendMessage(input); setInput(''); }}
          attachments={attachments}
          onRemoveAttachment={(i) => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
          fileInputRef={fileInputRef}
          onFileSelect={(e) => { if (e.target.files) handleFiles(Array.from(e.target.files)); }}
          isShaking={isShaking}
        />

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
        title="Delete Conversation"
        message="Are you sure you want to purge this record from memory?"
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        variant="warning"
      />
      <CyberConfirm 
        isOpen={showDeleteAllConfirm}
        title="PURGE ALL HISTORY"
        message="WARNING: This action is irreversible. All active session history will be destroyed. Continue?"
        onConfirm={confirmDeleteAll}
        onCancel={() => setShowDeleteAllConfirm(false)}
        variant="danger"
      />
    </div>
  );
}
