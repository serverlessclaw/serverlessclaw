'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Bot, RefreshCw, Send, AlertCircle } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import { ChatMessageList } from '../Chat/ChatMessageList';
import { ChatInput } from '../Chat/ChatInput';
import { useChatMessages } from '../Chat/useChatMessages';
import { useChatConnection } from '../Chat/useChatConnection';
import { TraceSource } from '@claw/core/lib/types/agent';
import Button from '@/components/ui/Button';

export default function PlaygroundChat({ 
  agentId, 
  overrideConfig,
  onTraceUpdate,
  replayTraceId
}: { 
  agentId: string;
  overrideConfig: { systemPrompt: string };
  onTraceUpdate?: (traceId: string) => void;
  replayTraceId?: string;
}) {
  const [activeSessionId, setActiveSessionId] = useState<string>(`playground_${Date.now()}`);
  const [isLoading, setIsLoading] = useState(false);
  const [input, setInput] = useState('');
  const isPostInFlight = useRef(false);
  const seenMessageIds = useRef<Set<string>>(new Set());
  const activeSessionRef = useRef(activeSessionId);
  const skipNextHistoryFetch = useRef(false);

  const {
    messages,
    setMessages,
    attachments,
    setAttachments,
    sendMessage,
    handleFiles,
    removeAttachment
  } = useChatMessages(
    activeSessionId,
    setActiveSessionId,
    setIsLoading,
    isPostInFlight,
    seenMessageIds,
    () => {}, // fetchSessions dummy
    skipNextHistoryFetch,
    activeSessionRef,
    false // disabled
  );

  useEffect(() => {
    activeSessionRef.current = activeSessionId;
  }, [activeSessionId]);

  const setMessagesRef = useRef(setMessages);
  useEffect(() => {
    setMessagesRef.current = setMessages;
  }, [setMessages]);

  const { isRealtimeActive: isConnected } = useChatConnection(
    activeSessionId,
    setMessagesRef,
    setIsLoading,
    isPostInFlight
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (replayTraceId && agentId) {
      async function fetchReplayData() {
        try {
          const res = await fetch(`/api/trace/${replayTraceId}`);
          const data = await res.json();
          if (data.trace?.initialContext?.userText) {
            const query = data.trace.initialContext.userText;
            setMessages([{
              role: 'assistant',
              content: `Replay Protocol Initialized for Trace: **${replayTraceId}**. \n\nTarget Query: "${query}"`,
              agentName: 'System',
              messageId: `replay-intro-${replayTraceId}`
            }]);
            
            // Wait for messages to settle then trigger replay
            setTimeout(() => {
                sendMessage(query, {
                  agentId,
                  isIsolated: true,
                  source: TraceSource.PLAYGROUND,
                  overrideConfig
                });
            }, 1000);
          }
        } catch (err) {
          console.error('Failed to fetch replay trace:', err);
        }
      }
      fetchReplayData();
    }
    // Only run once on mount when replayTraceId is present
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayTraceId, agentId]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!agentId) return;
    
    const textToSend = input;
    setInput('');
    
    await sendMessage(textToSend, {
      agentId,
      isIsolated: true,
      source: TraceSource.PLAYGROUND,
      overrideConfig
    });

    // Extract traceId from the last message added by sendMessage
    // sendMessage adds a thinking placeholder with messageId format: `${tempId}-${agentId}`
  };

  // Sync latest traceId to parent for the visualizer
  useEffect(() => {
    const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');
    if (lastAssistantMessage?.messageId && onTraceUpdate) {
        const traceId = lastAssistantMessage.messageId.split('-')[0];
        if (traceId && traceId.length > 20) { // Simple UUID check
            onTraceUpdate(traceId);
        }
    }
  }, [messages, onTraceUpdate]);

  if (!agentId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-more/40">
        <Bot size={64} className="mb-4 opacity-10" />
        <Typography variant="h3" weight="bold">Select a Persona to Begin</Typography>
        <Typography variant="caption" color="muted-more" className="mt-2 uppercase tracking-widest">Cognitive sandbox initialized</Typography>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <header className="p-4 border-b border-border flex items-center justify-between bg-card/40 backdrop-blur-md">
         <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyber-green/10 border border-cyber-green/20 flex items-center justify-center">
              <Bot size={16} className="text-cyber-green" />
            </div>
            <div>
              <Typography variant="mono" weight="bold" className="text-xs text-foreground uppercase tracking-tighter">Testing::{agentId}</Typography>
              <div className="flex items-center gap-1.5">
                 <div className="w-1 h-1 rounded-full bg-cyber-green animate-pulse" />
                 <Typography variant="mono" className="text-[8px] text-cyber-green/60 uppercase">Sandbox_Active</Typography>
              </div>
            </div>
         </div>
         <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => {
              setMessages([]);
              setActiveSessionId(`playground_${Date.now()}`);
            }}
            className="text-muted-more hover:text-foreground"
            icon={<RefreshCw size={14} />}
         >
           Reset
         </Button>
      </header>

      <div className="flex-1 overflow-hidden">
        <ChatMessageList 
          messages={messages} 
          isLoading={isLoading} 
          showThinking={true}
          scrollRef={scrollRef}
        />
      </div>

      <div className="p-4 bg-gradient-to-t from-background to-transparent">
        <ChatInput 
          input={input}
          setInput={setInput}
          isLoading={isLoading}
          onSend={handleSend}
          attachments={attachments}
          onRemoveAttachment={removeAttachment}
          onFileSelect={(e) => {
            if (e.target.files) handleFiles(Array.from(e.target.files));
          }}
          fileInputRef={fileInputRef}
        />
        <div className="mt-2 flex items-center gap-2 px-1">
           <AlertCircle size={10} className="text-muted-more/40" />
           <Typography variant="mono" className="text-[8px] text-muted-more/40 uppercase tracking-widest">
             Interactions in this environment do not affect agent reputation or collective memory.
           </Typography>
        </div>
      </div>
    </div>
  );
}
