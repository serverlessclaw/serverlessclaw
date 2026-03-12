'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Bot, Loader2, MessageSquare, Terminal, Plus, Clock, ChevronRight, Zap } from 'lucide-react';
import { THEME } from '@/lib/theme';
import mqtt from 'mqtt';

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

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessions, setSessions] = useState<ConversationMeta[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [isRealtimeActive, setIsRealtimeActive] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch session list on mount
  useEffect(() => {
    fetchSessions();
  }, []);

  // Setup Realtime Push Notifications
  useEffect(() => {
    const userId = 'dashboard-user';
    const topic = `users/${userId}/signal`;
    let client: any;

    const connect = async () => {
      try {
        const res = await fetch('/api/config');
        const config = await res.json();
        
        if (!config.realtime?.url) return;

        console.log('[Realtime] Connecting with MQTT...');
        client = mqtt.connect(config.realtime.url, {
          protocol: 'wss',
          clientId: `dashboard-${Math.random().toString(16).slice(2, 10)}`,
          password: 'auth-token', // Token placeholder for authorizer
          clean: true,
          connectTimeout: 10000,
          reconnectPeriod: 5000,
        });
        
        client.on('connect', () => {
          console.log('[Realtime] Connected to push bus');
          client.subscribe(topic, (err: any) => {
            if (err) console.error('[Realtime] Subscription error:', err);
            else {
              console.log('[Realtime] Subscribed to:', topic);
              setIsRealtimeActive(true);
            }
          });
        });

        client.on('message', (t: string, payload: any) => {
          try {
            const message = JSON.parse(payload.toString());
            console.log('[Realtime] Received signal:', message);
            if (activeSessionId) {
              fetchHistorySilently(activeSessionId);
            }
          } catch (e) {
            console.error('[Realtime] Failed to parse message:', e);
          }
        });

        client.on('error', (err: any) => {
          console.error('[Realtime] MQTT Error:', err);
          setIsRealtimeActive(false);
        });

        client.on('close', () => {
          setIsRealtimeActive(false);
        });
      } catch (e) {
        console.error('[Realtime] Setup failed:', e);
      }
    };

    connect();

    return () => {
      if (client) {
        console.log('[Realtime] Disconnecting...');
        client.end();
      }
    };
  }, [activeSessionId]);

  // Fetch history when active session changes
  useEffect(() => {
    if (activeSessionId) {
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
          agentName: m.agentName,
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
          agentName: m.agentName,
        })).filter((m: any) => m.content));
      }
    } catch (e) {
      console.warn('Silent History fetch failed:', e);
    }
  };

  const createNewChat = () => {
    const newId = `session_${Date.now()}`;
    setActiveSessionId(newId);
    setMessages([]);
  };

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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
       setActiveSessionId(currentSessionId);
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: userMsg, sessionId: currentSessionId }),
      });

      const data = await response.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply, agentName: data.agentName }]);
      
      // Refresh session list to show updated last message/title
      fetchSessions();
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, { role: 'assistant', content: 'SYSTEM_ERROR: Neural path interrupted. Check logs.' }]);
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
            <span className="text-[10px] font-black uppercase tracking-[0.2em] italic">Initialize_New_Path</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-6 space-y-2">
          <div className="text-[9px] uppercase text-white/30 tracking-[0.3em] font-bold mb-4 px-2 flex items-center gap-2">
            <Clock size={10} /> RECENT_NEURAL_LOGS
          </div>
          
          {sessions.length === 0 ? (
            <div className="p-4 text-center border border-white/5 bg-white/[0.01] rounded italic text-[10px] text-white/20">
              No active session traces found.
            </div>
          ) : (
            sessions.map((s) => (
              <button
                key={s.sessionId}
                onClick={() => setActiveSessionId(s.sessionId)}
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
                  <ChevronRight size={12} className={activeSessionId === s.sessionId ? `text-${THEME.COLORS.PRIMARY}` : 'text-white/10'} />
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
          <div>
            <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <MessageSquare size={20} className="text-cyber-green" /> CHAT_DIRECT
            </h2>
            <p className="text-[10px] text-white/90 uppercase tracking-widest mt-1">Real-time interaction with CLAW_CORE</p>
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
              <div className="h-full flex flex-col items-center justify-center text-white/50">
                  <Terminal size={48} className="mb-4 opacity-10" />
                  <p className="text-sm font-light uppercase tracking-widest">SYSTEM_READY // WAITING_FOR_INPUT</p>
                  <p className="text-[10px] mt-2 opacity-50 uppercase tracking-tighter font-mono">Input signal to initialize neural translation</p>
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
              placeholder="Enter command or query for CLAW_CORE..."
              className="w-full bg-black border border-white/10 rounded-lg py-4 pl-6 pr-16 text-sm outline-none focus:border-cyber-green/50 transition-all placeholder:text-white/50"
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
          <p className="text-center text-[9px] text-white/50 mt-4 uppercase tracking-[0.2em] font-mono">
            Secure Neural Translink Active // Latency: 22ms // Node: Core_Manager
          </p>
        </div>
      </main>
    </div>
  );
}
