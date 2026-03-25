'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Paperclip, Edit2, Check, X } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import CyberConfirm from '@/components/CyberConfirm';
import Button from '@/components/ui/Button';
import { AGENT_ERRORS } from '@/lib/constants';
import { useChatConnection } from './useChatConnection';
import { ChatSidebar } from './ChatSidebar';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput } from './ChatInput';
import { ChatMessage, AttachmentPreview, HistoryMessage } from './types';

export default function ChatContent() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isShaking, setIsShaking] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeSessionRef = useRef<string>('');
  const hasProcessedPrompt = useRef<boolean>(false);
  const isPostInFlight = useRef<boolean>(false);

  const searchParams = useSearchParams();
  const router = useRouter();

  const { isRealtimeActive, sessions, fetchSessions, skipNextHistoryFetch, seenMessageIds } = useChatConnection(
    activeSessionId,
    setMessages,
    setIsLoading,
    isPostInFlight
  );

  const currentSession = sessions.find(s => s.sessionId === activeSessionId);

  useEffect(() => {
    if (currentSession) {
      setEditedTitle(currentSession.title ?? 'Untitled Trace');
    }
  }, [currentSession]);

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

  useEffect(() => {
    activeSessionRef.current = activeSessionId;
  }, [activeSessionId]);

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

  const fetchHistory = async (sessionId: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/chat?sessionId=${sessionId}`);
      const data = await response.json();
      if (data.history) {
        seenMessageIds.current.clear();
        setMessages(prev => {
          const history = data.history.map((m: HistoryMessage) => ({
            role: m.role === 'assistant' || m.role === 'system' ? 'assistant' : 'user',
            content: m.content,
            thought: m.thought,
            agentName: m.agentName ?? (m.role === 'assistant' || m.role === 'system' ? 'SuperClaw' : undefined),
            attachments: m.attachments,
            options: m.options,
            tool_calls: m.tool_calls,
            messageId: m.messageId || m.traceId,
          }));

          // Preserve local-only messages (like SystemGuard errors) that aren't in history yet
          const historyIds = new Set(history.map((m: ChatMessage) => m.messageId).filter(Boolean));
          const localOnly = prev.filter((m: ChatMessage) => 
            m.role === 'assistant' && m.messageId && !historyIds.has(m.messageId)
          );

          // Track IDs from history too
          history.forEach(m => {
            if (m.messageId) seenMessageIds.current.add(m.messageId);
          });

          return [...history, ...localOnly];
        });
      }
    } catch (error) {
      console.error('Failed to fetch history:', error);
    } finally {
      setIsLoading(false);
    }
  };

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

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  };

  const handleFiles = async (files: File[]) => {
    const newAttachments = await Promise.all(files.map(async (file) => {
      const type = (file.type.startsWith('image/') ? 'image' : 'file') as 'image' | 'file';
      let preview = '';
      if (type === 'image') {
        preview = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      }
      return { file, preview, type };
    }));
    setAttachments(prev => [...prev, ...newAttachments]);
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() && attachments.length === 0) return;
    if (isLoading || isPostInFlight.current) return;

    const userMsg = text.trim();
    const currentAttachments = [...attachments];
    const tempId = crypto.randomUUID();
    
    setMessages(prev => [...prev, { 
      role: 'user', 
      content: userMsg,
      attachments: currentAttachments.map(a => ({
        type: a.type,
        name: a.file.name,
        mimeType: a.file.type,
        url: a.preview
      }))
    }]);
    
    setIsLoading(true);
    setAttachments([]);
    isPostInFlight.current = true;

    let currentSessionId = activeSessionRef.current;
    if (!currentSessionId) {
       currentSessionId = `session_${Date.now()}`;
       skipNextHistoryFetch.current = true;
       activeSessionRef.current = currentSessionId;
       setActiveSessionId(currentSessionId);
    }

    try {
      const apiAttachments = await Promise.all(currentAttachments.map(async (a) => {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(a.file);
        });
        return { type: a.type, name: a.file.name, mimeType: a.file.type, base64 };
      }));

      const response = await fetch('/api/chat?stream=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: userMsg, sessionId: currentSessionId, attachments: apiAttachments, traceId: tempId }),
      });

      const data = await response.json();

      // Handle error responses from the API
      if (!response.ok || data.error) {
        const errorContent = data.details || data.error || AGENT_ERRORS.PROCESS_FAILURE;
        console.error('Chat API error:', data);
        if (currentSessionId === activeSessionRef.current) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: errorContent,
            agentName: 'SystemGuard',
            isError: true
          }]);
        }
        fetchSessions();
        return;
      }

      // Append the assistant response (stream now returns full response like non-streaming)
      if (currentSessionId === activeSessionRef.current) {
        seenMessageIds.current.add(data.messageId || tempId);
        setMessages(prev => {
          const targetId = data.messageId || tempId;
          const exists = prev.some(m => m.messageId === targetId && m.role === 'assistant');
          if (exists) {
            return prev.map(m => m.messageId === targetId && m.role === 'assistant' ? {
              ...m,
              content: data.reply || m.content,
              thought: data.thought || m.thought,
              tool_calls: data.tool_calls || m.tool_calls,
              agentName: data.agentName || m.agentName
            } : m);
          }
          return [...prev, {
            role: 'assistant',
            content: data.reply || (data.tool_calls ? 'Executing tools...' : ''),
            thought: data.thought,
            messageId: targetId,
            agentName: data.agentName || 'SuperClaw',
            tool_calls: data.tool_calls,
          }];
        });
      }
      fetchSessions();
    } catch (error) {
      console.error('Chat error:', error);
      const errorMsg = AGENT_ERRORS.CONNECTION_FAILURE;
      if (currentSessionId === activeSessionRef.current) {
        const errorId = `error_${Date.now()}`;
        seenMessageIds.current.add(errorId);
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: errorMsg, 
          agentName: 'SystemGuard',
          messageId: errorId,
          isError: true
        }]);
      }
      try {
        await fetch('/api/memory/gap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            details: `Dashboard session ${currentSessionId} failed during chat processing. Error: ${error instanceof Error ? error.message : String(error)}`,
            metadata: { category: 'strategic_gap', urgency: 7, impact: 5 }
          })
        });
      } catch (e) {
        console.error('Failed to report strategic gap:', e);
      }
    } finally {
      isPostInFlight.current = false;
      setIsLoading(false);
    }
  };

  const handleOptionClick = async (value: string) => {
    if (value.startsWith('APPROVE_TOOL_CALL:')) {
      const callId = value.split(':')[1];
      const currentSessionId = activeSessionRef.current;
      
      setIsLoading(true);
      isPostInFlight.current = true;
      
      try {
        const response = await fetch('/api/chat?stream=true', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            text: 'I approve the tool execution.', 
            sessionId: currentSessionId, 
            approvedToolCalls: [callId] 
          }),
        });
        
        if (!response.ok) {
          const data = await response.json();
          setMessages(prev => [...prev, { 
            role: 'assistant', 
            content: `Error during approval: ${data.error || 'Unknown error'}`, 
            agentName: 'SystemGuard',
            isError: true 
          }]);
        }
        fetchSessions();
      } catch (error) {
        console.error('Approval error:', error);
      } finally {
        isPostInFlight.current = false;
        setIsLoading(false);
      }
    } else {
      // Handle other options as standard messages
      sendMessage(value);
    }
  };

  const createNewChat = () => {
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
    } catch (error) { console.error('Failed to delete session:', error); }
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
    } catch (error) { console.error('Failed to delete all:', error); }
    setShowDeleteAllConfirm(false);
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
        className={`flex-1 flex flex-col min-w-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-green/5 via-[#0a0a0a] to-[#0a0a0a] transition-colors relative ${isDragging ? 'bg-cyber-green/10' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-cyber-green/10 border-2 border-dashed border-cyber-green pointer-events-none">
            <div className="flex flex-col items-center gap-4 bg-black/80 p-12 rounded-2xl border border-cyber-green/30 shadow-[0_0_50px_rgba(0,255,163,0.2)]">
              <Paperclip size={64} className="text-cyber-green animate-bounce" />
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
          {isRealtimeActive && (
            <div className="flex items-center gap-2 bg-cyber-green/10 px-3 py-1 rounded border border-cyber-green/30">
               <div className="w-1.5 h-1.5 rounded-full bg-cyber-green animate-pulse" />
               <Typography variant="mono" weight="bold" className="text-cyber-green text-[10px]">LIVE</Typography>
            </div>
          )}
        </header>
        <ChatMessageList 
          messages={messages} 
          isLoading={isLoading} 
          scrollRef={scrollRef}
          onOptionClick={handleOptionClick}
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
        />
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
