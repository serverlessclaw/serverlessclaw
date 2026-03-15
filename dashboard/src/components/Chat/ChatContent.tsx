'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Paperclip } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import CyberConfirm from '@/components/CyberConfirm';
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
  const [isShaking, setIsShaking] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeSessionRef = useRef<string>('');
  const hasProcessedPrompt = useRef<boolean>(false);

  const searchParams = useSearchParams();
  const router = useRouter();

  const { isRealtimeActive, sessions, fetchSessions, skipNextHistoryFetch } = useChatConnection(
    activeSessionId, 
    setMessages, 
    setIsLoading
  );

  const currentSession = sessions.find(s => s.sessionId === activeSessionId);

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
  }, [activeSessionId]);

  const fetchHistory = async (sessionId: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/chat?sessionId=${sessionId}`);
      const data = await response.json();
      if (data.history) {
        setMessages(data.history.map((m: HistoryMessage) => ({
          role: m.role === 'assistant' || m.role === 'system' ? 'assistant' : 'user',
          content: m.content,
          agentName: m.agentName || (m.role === 'assistant' || m.role === 'system' ? 'SuperClaw' : undefined),
          attachments: m.attachments,
        })).filter((m: ChatMessage) => m.content || (m.attachments && m.attachments.length > 0)));
      }
    } catch (error) {
      console.error('Failed to fetch history:', error);
    } finally {
      setIsLoading(false);
    }
  };

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
    if (isLoading) return;

    const userMsg = text.trim();
    const currentAttachments = [...attachments];
    
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

    let currentSessionId = activeSessionRef.current;
    if (!currentSessionId) {
       currentSessionId = `session_${Date.now()}`;
       skipNextHistoryFetch.current = true;
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

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: userMsg, sessionId: currentSessionId, attachments: apiAttachments }),
      });

      const data = await response.json();
      if (currentSessionId === activeSessionRef.current) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply, agentName: data.agentName }]);
      }
      fetchSessions();
    } catch (error) {
      console.error('Chat error:', error);
      const errorMsg = AGENT_ERRORS.CONNECTION_FAILURE;
      if (currentSessionId === activeSessionRef.current) {
        setMessages(prev => [...prev, { role: 'assistant', content: errorMsg, agentName: 'SystemGuard' }]);
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
      setIsLoading(false);
    }
  };

  const createNewChat = () => {
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
      />

      <main 
        className={`flex-1 flex flex-col min-w-0 bg-[#0a0a0a] transition-colors relative ${isDragging ? 'bg-cyber-green/5' : ''}`}
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
        
        <header className="px-6 py-4 border-b border-white/5 flex justify-between items-center shrink-0 min-h-[70px]">
          <div className="flex-1 min-w-0 mr-4">
            <Typography variant="h2" weight="bold" color="white" glow className="truncate uppercase">
              {currentSession?.title || 'Direct Chat'}
            </Typography>
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
