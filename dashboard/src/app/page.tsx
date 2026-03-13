'use client';

import React, { useState, useRef, useEffect, Suspense } from 'react';
import { Send, User, Bot, Loader2, MessageSquare, Terminal, Plus, Clock, ChevronRight, Zap, Edit2, Check, X, Trash2, AlertTriangle } from 'lucide-react';
import { THEME } from '@/lib/theme';
import mqtt from 'mqtt';
import { useSearchParams, useRouter } from 'next/navigation';
import CyberConfirm from '@/components/CyberConfirm';
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  agentName?: string;
}

interface ConversationMeta {
  sessionId: string;
  title: string;
  lastMessage: string;
  updatedAt: number;
}

function ChatContent() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessions, setSessions] = useState<ConversationMeta[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [isRealtimeActive, setIsRealtimeActive] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeSessionRef = useRef<string>('');
  const skipNextHistoryFetch = useRef<boolean>(false);

  const searchParams = useSearchParams();
  const router = useRouter();

  const currentSession = sessions.find(s => s.sessionId === activeSessionId);

  // Keep ref in sync
  useEffect(() => {
    activeSessionRef.current = activeSessionId;
  }, [activeSessionId]);

  // Sync activeSessionId with URL param
  useEffect(() => {
    const sessionFromUrl = searchParams.get('session');
    if (sessionFromUrl && sessionFromUrl !== activeSessionId) {
      setActiveSessionId(sessionFromUrl);
    } else if (!sessionFromUrl && activeSessionId) {
      // If URL is cleared externally, clear local state
      setActiveSessionId('');
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
    if (currentSession) {
      setEditedTitle(currentSession.title || 'Untitled_Trace');
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

  const deleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setSessionToDelete(sessionId);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!sessionToDelete) return;
    
    try {
      const response = await fetch(`/api/chat?sessionId=${sessionToDelete}`, {
        method: 'DELETE',
      });
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
    } finally {
      setShowDeleteConfirm(false);
      setSessionToDelete(null);
    }
  };

  const confirmDeleteAll = async () => {
    try {
      const response = await fetch('/api/chat?sessionId=all', {
        method: 'DELETE',
      });
      if (response.ok) {
        setActiveSessionId('');
        setMessages([]);
        router.push('/', { scroll: false });
        fetchSessions();
      }
    } catch (error) {
      console.error('Failed to delete all sessions:', error);
    } finally {
      setShowDeleteAllConfirm(false);
    }
  };

  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 400);
  };

  // Fetch session list on mount
  useEffect(() => {
    fetchSessions();
  }, []);

  const mqttClientRef = useRef<any>(null);

  // Setup Realtime Push Notifications (Connection)
  useEffect(() => {
    const userId = 'dashboard-user';
    
    const connect = async () => {
      try {
        const res = await fetch('/api/config');
        const config = await res.json();
        if (!config.realtime?.url) return;

        console.log('[Realtime] Connecting with MQTT...');
        const client = mqtt.connect(config.realtime.url, {
          protocol: 'wss',
          clientId: `dashboard-${Math.random().toString(16).slice(2, 10)}`,
          password: 'auth-token',
          clean: true,
          connectTimeout: 10000,
          reconnectPeriod: 5000,
        });
        
        client.on('connect', () => {
          console.log('[Realtime] Connected to push bus');
          setIsRealtimeActive(true);
          
          // Subscribe to generic user signals
          const userTopic = `users/${userId}/signal`;
          client.subscribe(userTopic);
        });

        client.on('message', (t: string, payload: any) => {
          try {
            const data = JSON.parse(payload.toString());
            console.log('[Realtime] Received signal on:', t, data);
            
            const currentActiveId = activeSessionRef.current;
            
            // If the signal matches our active session (or is generic), refresh
            if (!data.sessionId || data.sessionId === currentActiveId) {
              if (data.message && data.userId === userId) {
                setMessages(prev => {
                  const alreadyExists = prev.some(m => m.content === data.message && m.role === 'assistant');
                  if (alreadyExists) return prev;
                  return [...prev, {
                    role: 'assistant',
                    content: data.message,
                    agentName: data.agentName || 'SuperClaw'
                  }];
                });
              } else if (currentActiveId) {
                fetchHistorySilently(currentActiveId);
              }
            }
          } catch (e) {
            console.error('[Realtime] Failed to parse message:', e);
          }
        });

        client.on('error', (err: any) => {
          console.error('[Realtime] MQTT Error:', err);
          setIsRealtimeActive(false);
        });

        client.on('close', () => setIsRealtimeActive(false));
        
        mqttClientRef.current = client;
      } catch (e) {
        console.error('[Realtime] Setup failed:', e);
      }
    };

    connect();

    return () => {
      if (mqttClientRef.current) {
        console.log('[Realtime] Disconnecting...');
        mqttClientRef.current.end();
      }
    };
  }, []);

  // Manage dynamic session subscriptions
  useEffect(() => {
    const client = mqttClientRef.current;
    if (!client || !client.connected) return;

    const userId = 'dashboard-user';
    const topic = `users/${userId}/sessions/${activeSessionId}/signal`;

    if (activeSessionId) {
      console.log('[Realtime] Subscribing to session:', activeSessionId);
      client.subscribe(topic);
    }

    return () => {
      if (activeSessionId) {
        console.log('[Realtime] Unsubscribing from session:', activeSessionId);
        client.unsubscribe(topic);
      }
    };
  }, [activeSessionId, isRealtimeActive]);

  // Fetch history when active session changes
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

  const fetchSessions = async () => {
    try {
      const response = await fetch('/api/chat');
      const data = await response.json();
      if (data.sessions) {
        setSessions(data.sessions);
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    }
  };

  const fetchHistory = async (sessionId: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/chat?sessionId=${sessionId}`);
      const data = await response.json();
      if (data.history) {
        setMessages(data.history.map((m: any) => ({
          role: m.role === 'assistant' || m.role === 'system' ? 'assistant' : 'user',
          content: m.content,
          agentName: m.agentName || (m.role === 'assistant' || m.role === 'system' ? 'SuperClaw' : undefined),
        })).filter((m: any) => m.content)); // Filter out tool calls for simplicity in UI
      }
    } catch (error) {
      console.error('Failed to fetch history:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Passive Polling for background updates (Fallback)
  useEffect(() => {
    if (!activeSessionId) return;

    const interval = setInterval(() => {
      // If realtime is active, we poll MUCH slower as a fallback (heartbeat)
      // If realtime is NOT active, we poll at a reasonable rate
      const isIdle = !isLoading && !document.hidden;
      if (isIdle) {
        fetchHistorySilently(activeSessionId);
      }
    }, isRealtimeActive ? 60000 : 10000); // 1 min fallback vs 10s active poll

    return () => clearInterval(interval);
  }, [activeSessionId, isRealtimeActive, isLoading]);

  const fetchHistorySilently = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/chat?sessionId=${sessionId}`);
      const data = await response.json();
      if (data.history) {
        setMessages(data.history.map((m: any) => ({
          role: m.role === 'assistant' || m.role === 'system' ? 'assistant' : 'user',
          content: m.content,
          agentName: m.agentName || (m.role === 'assistant' || m.role === 'system' ? 'SuperClaw' : undefined),
        })).filter((m: any) => m.content));
      }
    } catch (e) {
      console.warn('Silent History fetch failed:', e);
    }
  };

  const createNewChat = () => {
    if (messages.length === 0 && !activeSessionId) {
      triggerShake();
      return;
    }
    setActiveSessionId('');
    setMessages([]);
    router.push('/', { scroll: false });
  };

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      const container = scrollRef.current;
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
      
      // Always scroll if we just started loading (user sent a message)
      // or if we were already near the bottom when new messages arrived
      if (isNearBottom || (isLoading && messages.length > 0 && messages[messages.length - 1].role === 'user')) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth'
        });
      }
    }
  }, [messages, isLoading]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsLoading(true);

    // Ensure we have a session ID
    let currentSessionId = activeSessionId;
    if (!currentSessionId) {
       currentSessionId = `session_${Date.now()}`;
       skipNextHistoryFetch.current = true;
       setActiveSessionId(currentSessionId);
       // We don't wait for router.push here as it's async, 
       // but we've updated the state which will trigger the URL sync effect
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: userMsg, sessionId: currentSessionId }),
      });

      const data = await response.json();
      
      // If the session ID hasn't changed while we were waiting (e.g. user switched chats)
      if (currentSessionId === activeSessionRef.current) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply, agentName: data.agentName }]);
      }
      
      // Refresh session list to show updated last message/title
      fetchSessions();
    } catch (error) {
      console.error('Chat error:', error);
      if (currentSessionId === activeSessionRef.current) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'SYSTEM_ERROR: Neural path interrupted. Check logs.' }]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#0a0a0a] overflow-hidden">
      {/* Session Sidebar */}
      <aside className="w-80 border-r border-white/5 flex flex-col bg-black/20 shrink-0">
        <div className="p-6 shrink-0">
          <button
            onClick={createNewChat}
            className={`w-full py-4 border border-${THEME.COLORS.PRIMARY}/30 bg-${THEME.COLORS.PRIMARY}/5 hover:bg-${THEME.COLORS.PRIMARY}/10 text-${THEME.COLORS.PRIMARY} rounded-sm flex items-center justify-center gap-2 transition-all group shadow-[0_0_15px_rgba(0,255,163,0.05)]`}
          >
            <Plus size={16} className="group-hover:rotate-90 transition-transform" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] italic">
              Start New Chat
            </span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-6 space-y-2">
          <div className="text-[9px] uppercase text-white/60 tracking-[0.3em] font-bold mb-4 px-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock size={10} /> RECENT_NEURAL_LOGS
            </div>
            {sessions.length > 0 && (
              <button 
                onClick={() => setShowDeleteAllConfirm(true)}
                className="text-red-500/60 hover:text-red-500 transition-colors flex items-center gap-1 group/purge"
                title="Purge All Conversations"
              >
                <Trash2 size={10} className="group-hover/purge:scale-110 transition-transform" />
                <span className="text-[8px] tracking-tighter">PURGE_ALL</span>
              </button>
            )}
          </div>
          
          {sessions.length === 0 ? (
            <div className="p-4 text-center border border-white/5 bg-white/[0.01] rounded italic text-[10px] text-white/20">
              No active session traces found.
            </div>
          ) : (
            sessions.map((s) => (
              <button
                key={s.sessionId}
                onClick={() => {
                  if (activeSessionId !== s.sessionId) {
                    setMessages([]);
                    setActiveSessionId(s.sessionId);
                  }
                }}
                className={`w-full p-4 rounded-sm border transition-all text-left space-y-2 group ${
                  activeSessionId === s.sessionId
                    ? `bg-${THEME.COLORS.PRIMARY}/5 border-${THEME.COLORS.PRIMARY}/30 shadow-[0_0_20px_rgba(0,255,163,0.02)]`
                    : 'bg-white/[0.02] border-white/5 hover:border-white/10'
                }`}
              >
                <div className="flex justify-between items-start gap-2">
                  <span className={`text-[10px] font-bold uppercase tracking-tight truncate ${
                    activeSessionId === s.sessionId ? `text-${THEME.COLORS.PRIMARY}` : 'text-white/80'
                  }`}>
                    {s.title || 'Untitled_Trace'}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => deleteSession(e, s.sessionId)}
                      className="opacity-0 group-hover:opacity-60 hover:!opacity-100 p-1 text-red-500 transition-all"
                      title="Delete Conversation"
                    >
                      <Trash2 size={12} />
                    </button>
                    <ChevronRight size={12} className={activeSessionId === s.sessionId ? `text-${THEME.COLORS.PRIMARY}` : 'text-white/10'} />
                  </div>
                </div>
                <div className="text-[9px] text-white/40 font-mono truncate h-4 italic">
                  {s.lastMessage || 'Waiting_for_signal...'}
                </div>
                <div className="text-[8px] text-white/20 font-mono uppercase tracking-tighter">
                    {new Date(s.updatedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="p-6 border-t border-white/5 text-[9px] text-white/20 uppercase tracking-widest font-mono">
           Core_Interface_Node: v2.6.4
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#0a0a0a]">
        <header className="p-6 border-b border-white/5 flex justify-between items-center shrink-0">
          <div className="flex-1 min-w-0 mr-4">
            {activeSessionId && sessions.find(s => s.sessionId === activeSessionId) ? (
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
                          setEditedTitle(currentSession?.title || 'Untitled_Trace');
                        }
                      }}
                      className="bg-white/5 border border-cyber-green/30 rounded px-2 py-1 text-lg font-bold text-white outline-none w-full"
                    />
                    <button onClick={saveTitle} className="p-1 hover:text-cyber-green transition-colors">
                      <Check size={18} />
                    </button>
                    <button onClick={() => setIsEditingTitle(false)} className="p-1 hover:text-red-500 transition-colors">
                      <X size={18} />
                    </button>
                  </div>
                ) : (
                  <>
                    <h2 className="text-xl font-bold tracking-tight text-white/90 truncate">
                      {currentSession?.title || 'Untitled_Trace'}
                    </h2>
                    <button 
                      onClick={() => setIsEditingTitle(true)}
                      className="p-1 opacity-0 group-hover/title:opacity-50 hover:opacity-100 transition-all text-white"
                    >
                      <Edit2 size={14} />
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div>
                <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
                  <MessageSquare size={20} className="text-cyber-green" /> CHAT_DIRECT
                </h2>
                <p className="text-[10px] text-white/90 uppercase tracking-widest mt-1">Real-time interaction with SUPER_CLAW</p>
              </div>
            )}
          </div>
          <div className="flex gap-2 items-center">
              {isRealtimeActive && (
                <div className="flex items-center gap-1.5 px-2 py-1 bg-cyber-green/5 border border-cyber-green/20 rounded-full animate-pulse">
                  <Zap size={10} className="text-cyber-green" />
                  <span className="text-[8px] font-black text-cyber-green uppercase tracking-tighter">Live_Link_Active</span>
                </div>
              )}
              <div className="text-[10px] px-2 py-1 bg-cyber-green/10 text-cyber-green border border-cyber-green/20 rounded font-bold uppercase tracking-tighter italic">
                  {activeSessionId ? `SESSION_ID: ${activeSessionId.substring(0, 12)}...` : 'IDLE_WAITING'}
              </div>
          </div>
        </header>

        {/* Message Area */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-6 space-y-6 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/[0.02] via-transparent to-transparent custom-scrollbar"
        >
          {messages.length === 0 && !isLoading && (
              <div className="h-full flex flex-col items-center justify-center text-white/80">
                  <Terminal size={48} className="mb-4 opacity-10" />
                  <p className="text-sm font-light uppercase tracking-widest">SYSTEM_READY // WAITING_FOR_INPUT</p>
                  <p className="text-[10px] mt-2 opacity-80 uppercase tracking-tighter font-mono">Input signal to initialize neural translation</p>
              </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex gap-4 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex gap-4 max-w-[80%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-8 h-8 rounded shrink-0 flex items-center justify-center border ${
                  m.role === 'user' ? 'bg-white/5 border-white/10 text-white/100' : 'bg-cyber-green/10 border-cyber-green/30 text-cyber-green'
                }`}>
                  {m.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                </div>
                <div className="flex flex-col gap-1">
                  {m.role === 'assistant' && m.agentName && (
                    <span className="text-[9px] font-bold uppercase tracking-widest text-cyber-green/60 flex items-center gap-1 pl-1">
                      <span className="w-1 h-1 rounded-full bg-cyber-green/60 inline-block" />
                      {m.agentName}
                    </span>
                  )}
                  <div className={`p-4 rounded-lg text-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user' ? 'bg-white/5 text-white/90 border border-white/10' : 'glass-card text-cyber-green/90 border-cyber-green/20 shadow-[0_0_20px_rgba(0,255,145,0.05)]'
                  }`}>
                    {m.content}
                  </div>
                </div>
              </div>
            </div>
          ))}
          
          {isLoading && (
            <div className="flex gap-4 justify-start">
              <div className="w-8 h-8 rounded shrink-0 flex items-center justify-center border bg-cyber-green/10 border-cyber-green/30 text-cyber-green animate-pulse">
                  <Bot size={16} />
              </div>
              <div className="p-4 rounded-lg glass-card flex items-center gap-3">
                <Loader2 size={16} className="animate-spin text-cyber-green" />
                <span className="text-xs text-cyber-green/60 font-bold animate-pulse uppercase tracking-widest">Processing neural path...</span>
              </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-6 border-t border-white/5 bg-black/40 shrink-0">
          <form onSubmit={handleSend} className="max-w-4xl mx-auto relative group">
            <input 
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter command or query for SUPER_CLAW..."
              className={`w-full bg-black border border-white/10 rounded-lg py-4 pl-6 pr-16 text-sm outline-none focus:border-cyber-green/50 transition-all placeholder:text-white/50 ${
                isShaking ? 'animate-shake border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]' : ''
              }`}
              disabled={isLoading}
            />
            <button 
              type="submit"
              disabled={isLoading || !input.trim()}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-cyber-green text-black rounded flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-30 disabled:hover:scale-100 disabled:grayscale cursor-pointer shadow-[0_0_15px_rgba(0,255,163,0.3)]"
            >
              <Send size={18} />
            </button>
          </form>
          <p className="text-center text-[9px] text-white/80 mt-4 uppercase tracking-[0.2em] font-mono">
            Secure Neural Translink Active // Latency: 22ms // Node: Core_Manager
          </p>
        </div>
      </main>

      <CyberConfirm 
        isOpen={showDeleteConfirm}
        title="Trace Erasure"
        message="You are about to purge this neural path from the permanent record. This action is irreversible and will fragment the historical context."
        variant="danger"
        confirmText="CONFIRM_PURGE"
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      <CyberConfirm 
        isOpen={showDeleteAllConfirm}
        title="Total Memory Wipe"
        message="You are about to permanently erase ALL conversation histories from the database. This action is irreversible and cannot be undone."
        variant="danger"
        confirmText="CONFIRM_TOTAL_PURGE"
        onConfirm={confirmDeleteAll}
        onCancel={() => setShowDeleteAllConfirm(false)}
      />
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="h-screen w-full bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="animate-spin text-cyber-green" size={32} />
      </div>
    }>
      <ChatContent />
    </Suspense>
  );
}
