'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Bot, Loader2, MessageSquare, Terminal } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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

    try {
      // We will use a Server Action or a local API route to communicate with the Agent
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: userMsg }),
      });

      const data = await response.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, { role: 'assistant', content: 'SYSTEM_ERROR: Neural path interrupted. Check logs.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex-1 flex flex-col h-screen bg-[#0a0a0a]">
      <header className="p-6 border-b border-white/5 flex justify-between items-center shrink-0">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <MessageSquare size={20} className="text-cyber-green" /> CHAT_DIRECT
          </h2>
          <p className="text-[10px] text-white/30 uppercase tracking-widest mt-1">Real-time interaction with CLAW_CORE</p>
        </div>
        <div className="flex gap-2">
            <div className="text-[10px] px-2 py-1 bg-cyber-green/10 text-cyber-green border border-cyber-green/20 rounded font-bold">
                ENCRYPTED_SESSION
            </div>
        </div>
      </header>

      {/* Message Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/[0.02] via-transparent to-transparent"
      >
        {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-white/20">
                <Terminal size={48} className="mb-4 opacity-10" />
                <p className="text-sm font-light">SYSTEM_READY // WAITING_FOR_INPUT</p>
                <p className="text-[10px] mt-2 opacity-50">Authorized personnel only.</p>
            </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex gap-4 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex gap-4 max-w-[80%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`w-8 h-8 rounded shrink-0 flex items-center justify-center border ${
                m.role === 'user' ? 'bg-white/5 border-white/10 text-white/40' : 'bg-cyber-green/10 border-cyber-green/30 text-cyber-green'
              }`}>
                {m.role === 'user' ? <User size={16} /> : <Bot size={16} />}
              </div>
              <div className={`p-4 rounded-lg text-sm leading-relaxed ${
                m.role === 'user' ? 'bg-white/5 text-white/90 border border-white/10' : 'glass-card text-cyber-green/90 border-cyber-green/20 shadow-[0_0_20px_rgba(0,255,145,0.05)]'
              }`}>
                {m.content}
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
            className="w-full bg-black border border-white/10 rounded-lg py-4 pl-6 pr-16 text-sm outline-none focus:border-cyber-green/50 transition-all placeholder:text-white/20"
            disabled={isLoading}
          />
          <button 
            type="submit"
            disabled={isLoading || !input.trim()}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-cyber-green text-black rounded flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-30 disabled:hover:scale-100 disabled:grayscale cursor-pointer"
          >
            <Send size={18} />
          </button>
        </form>
        <p className="text-center text-[9px] text-white/20 mt-4 uppercase tracking-[0.2em]">
          Secured Neural Interface v2.6 // Session ID: {Math.random().toString(36).substring(7).toUpperCase()}
        </p>
      </div>
    </main>
  );
}
