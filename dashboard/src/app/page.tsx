'use client';

import React, { useState, useRef, useEffect, Suspense } from 'react';
import { Send, User, Bot, Loader2, MessageSquare, Terminal, Plus, Clock, ChevronRight, Zap, Edit2, Check, X, Trash2, AlertTriangle } from 'lucide-react';
import { THEME } from '@/lib/theme';
import mqtt from 'mqtt';
import { useSearchParams, useRouter } from 'next/navigation';
import CyberConfirm from '@/components/CyberConfirm';
import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
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
  const hasProcessedPrompt = useRef<boolean>(false);

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

    const prompt = searchParams.get('prompt');
    if (prompt && !hasProcessedPrompt.current) {
      hasProcessedPrompt.current = true;
      // Small delay to ensure state and handlers are ready
      setTimeout(() => {
        sendMessage(prompt);
      }, 500);
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
    sendMessage(input.trim());
    setInput('');
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg = text.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsLoading(true);

    // Ensure we have a session ID
    let currentSessionId = activeSessionRef.current;
    if (!currentSessionId) {
       currentSessionId = `session_${Date.now()}`;
       skipNextHistoryFetch.current = true;
       setActiveSessionId(currentSessionId);
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: userMsg, sessionId: currentSessionId }),
      });

      const data = await response.json();
      
      if (currentSessionId === activeSessionRef.current) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply, agentName: data.agentName }]);
      }
      
      fetchSessions();
    } catch (error) {
      console.error('Chat error:', error);
      if (currentSessionId === activeSessionRef.current) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'SYSTEM_ERROR: Connection interrupted. Check logs.' }]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Session Sidebar */}
      <aside className="w-80 border-r border-white/5 flex flex-col bg-black/20 shrink-0">
        <div className="p-6 shrink-0">
          <Button
            onClick={createNewChat}
            fullWidth
            icon={<Plus size={16} className="group-hover:rotate-90 transition-transform" />}
          >
            Start New Chat
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-6 space-y-2">
          <div className="mb-4 px-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock size={10} className="text-white/60" /> 
              <Typography variant="caption" weight="bold" color="muted">
                Recent Logs
              </Typography>
            </div>
            {sessions.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDeleteAllConfirm(true)}
                className="text-red-500/60 hover:text-red-500 p-0 h-auto gap-1"
                icon={<Trash2 size={10} />}
              >
                <Typography variant="mono" color="danger" className="text-[8px]">PURGE_ALL</Typography>
              </Button>
            )}
          </div>
          
          {sessions.length === 0 ? (
            <Card variant="solid" padding="sm" className="text-center italic text-white/20">
              <Typography variant="caption">No active logs found.</Typography>
            </Card>
          ) : (
            sessions.map((s) => (
              <Button
                key={s.sessionId}
                variant="ghost"
                fullWidth
                onClick={() => {
                  if (activeSessionId !== s.sessionId) {
                    setMessages([]);
                    setActiveSessionId(s.sessionId);
                  }
                }}
                className={`!p-4 !h-auto flex flex-col items-stretch rounded-sm border transition-all text-left space-y-2 group !justify-start !bg-transparent ${
                  activeSessionId === s.sessionId
                    ? `!border-${THEME.COLORS.PRIMARY}/30 shadow-[0_0_20px_rgba(0,255,163,0.02)] !text-inherit`
                    : '!border-white/5 hover:!border-white/10 !text-inherit'
                }`}
              >
                <div className="flex justify-between items-start gap-2 w-full">
                  <Typography 
                    variant="caption" 
                    weight="bold" 
                    className={`truncate ${activeSessionId === s.sessionId ? `text-${THEME.COLORS.PRIMARY}` : 'text-white/80'}`}
                  >
                    {s.title || 'Untitled Trace'}
                  </Typography>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => deleteSession(e, s.sessionId)}
                      className="p-1 text-red-500/40 hover:text-red-500 h-auto transition-colors"
                      icon={<Trash2 size={12} />}
                      title="Delete Conversation"
                    />
                    <ChevronRight size={12} className={activeSessionId === s.sessionId ? `text-${THEME.COLORS.PRIMARY}` : 'text-white/10'} />
                  </div>
                </div>
                <Typography variant="mono" color="muted" className="truncate italic block h-4 w-full">
                  {s.lastMessage || 'Waiting for signal...'}
                </Typography>
                <Typography variant="mono" color="muted" className="text-[8px] w-full">
                    {new Date(s.updatedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                </Typography>
              </Button>
            ))
          )}
        </div>

        <div className="p-6 border-t border-white/5 font-mono">
           <Typography variant="mono" color="muted">Application Interface: v2.6.4</Typography>
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
                          setEditedTitle(currentSession?.title || 'Untitled Trace');
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
                  <>
                    <Typography variant="h2" weight="bold" color="white" className="truncate">
                      {currentSession?.title || 'Untitled Trace'}
                    </Typography>
                    <Button 
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsEditingTitle(true)}
                      className="p-1 opacity-0 group-hover/title:opacity-50 hover:opacity-100 text-white h-auto"
                      icon={<Edit2 size={14} />}
                    />
                  </>
                )}
              </div>
            ) : (
              <div>
                <Typography variant="h2" weight="bold" color="white" className="flex items-center gap-2">
                  <MessageSquare size={20} className="text-cyber-green" /> Chat Direct
                </Typography>
                <Typography variant="caption" color="white" className="mt-1 block opacity-90">
                  Real-time interaction with Super Claw
                </Typography>
              </div>
            )}
          </div>
          <div className="flex gap-2 items-center">
              {isRealtimeActive && (
                <Badge variant="primary" glow>
                  <Zap size={10} className="inline mr-1" /> Live Link Active
                </Badge>
              )}
              <Badge variant="primary" className="italic">
                  {activeSessionId ? `Session ID: ${activeSessionId.substring(0, 12)}...` : 'Idle Waiting'}
              </Badge>
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
                  <Typography variant="h3" weight="normal" color="white" className="opacity-80">
                    System Ready // Waiting for Input
                  </Typography>
                  <Typography variant="mono" color="muted" className="mt-2 block">
                    Initialise interaction by sending a message
                  </Typography>
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
                    <Typography variant="caption" weight="bold" color="primary" className="flex items-center gap-1 pl-1">
                      <span className="w-1 h-1 rounded-full bg-cyber-green/60 inline-block" />
                      {m.agentName}
                    </Typography>
                  )}
                  <Card variant="glass" padding="md" className={`rounded-lg ${
                    m.role === 'user' ? 'bg-white/5 text-white/90 border border-white/10' : 'text-cyber-green/90 border-cyber-green/20 shadow-[0_0_20px_rgba(0,255,145,0.05)]'
                  }`}>
                    <Typography variant="body">{m.content}</Typography>
                  </Card>
                </div>
              </div>
            </div>
          ))}
          
          {isLoading && (
            <div className="flex gap-4 justify-start">
              <div className="w-8 h-8 rounded shrink-0 flex items-center justify-center border bg-cyber-green/10 border-cyber-green/30 text-cyber-green animate-pulse">
                  <Bot size={16} />
              </div>
              <Card variant="glass" padding="md" className="flex items-center gap-3">
                <Loader2 size={16} className="animate-spin text-cyber-green" />
                <Typography variant="caption" weight="bold" color="primary" className="animate-pulse">
                  Processing...
                </Typography>
              </Card>
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
              placeholder="Enter command or query for Super Claw..."
              className={`w-full bg-black border border-white/10 rounded-lg py-4 pl-6 pr-16 text-base outline-none focus:border-cyber-green/50 transition-all placeholder:text-white/50 ${
                isShaking ? 'animate-shake border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]' : ''
              }`}
              disabled={isLoading}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
              <Button 
                type="submit"
                variant="primary"
                size="sm"
                disabled={isLoading || !input.trim()}
                className="w-10 h-10 p-0 shadow-[0_0_15px_rgba(0,255,163,0.3)] !rounded-md"
                icon={<Send size={18} />}
              />
            </div>
          </form>
        </div>
      </main>

      <CyberConfirm 
        isOpen={showDeleteConfirm}
        title="Trace Erasure"
        message="You are about to purge this trace from the permanent record. This action is irreversible."
        variant="danger"
        confirmText="Confirm Purge"
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      <CyberConfirm 
        isOpen={showDeleteAllConfirm}
        title="Total Memory Wipe"
        message="You are about to permanently erase ALL conversation histories from the database. This action is irreversible and cannot be undone."
        variant="danger"
        confirmText="Confirm Total Purge"
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
