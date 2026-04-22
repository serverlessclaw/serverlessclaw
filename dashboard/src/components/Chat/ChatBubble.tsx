'use client';

import React, { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { MessageSquare, X, Minimize2, Maximize2, Activity } from 'lucide-react';
import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput } from './ChatInput';
import { useChatConnection } from './useChatConnection';
import { useChatMessages } from './useChatMessages';
import { usePageContext } from '@/components/Providers/PageContextProvider';
import { ChatMessage } from './types';

/**
 * Global Chat Bubble component that floats on all pages.
 * Allows quick interaction with SuperClaw from anywhere in the dashboard.
 */
export default function ChatBubble() {
  const pathname = usePathname();

  // --- State & Refs (Must be before early returns) ---
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [input, setInput] = useState('');
  const [attachContext, setAttachContext] = useState(true);

  const isPostInFlight = useRef(false);
  const seenMessageIds = useRef(new Set<string>());
  const skipNextHistoryFetch = useRef(false);
  const activeSessionRef = useRef('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setMessagesRef = useRef<React.Dispatch<React.SetStateAction<ChatMessage[]>>>(() => {});

  const { context: pageContext } = usePageContext();

  // Initialize Connection Hook (Sync Loop)
  const chatConnection = useChatConnection(
    activeSessionId,
    setMessagesRef,
    setIsLoading,
    isPostInFlight,
    pathname === '/chat' || pathname === '/'
  );

  // Initialize Messages Hook
  const { messages, setMessages, sendMessage, attachments, handleFiles, removeAttachment } =
    useChatMessages(
      activeSessionId,
      setActiveSessionId,
      setIsLoading,
      isPostInFlight,
      seenMessageIds,
      chatConnection.fetchSessions,
      skipNextHistoryFetch,
      activeSessionRef,
      pathname === '/chat' || pathname === '/'
    );

  // Sync the ref for the connection hook
  useEffect(() => {
    setMessagesRef.current = setMessages;
  }, [setMessages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // --- Early Return (Must be after all hooks) ---
  // Hide the bubble on the main chat page, home page, or login page to avoid
  // redundancy and prevent duplicate data synchronization hooks from running.
  if (pathname === '/chat' || pathname === '/' || pathname === '/login') {
    return null;
  }

  const toggleOpen = () => {
    setIsOpen(!isOpen);
    setIsMinimized(false);
  };

  const toggleMinimized = () => {
    setIsMinimized(!isMinimized);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && attachments.length === 0) return;

    sendMessage(input, {
      pageContext: attachContext ? pageContext || undefined : undefined,
    });
    setInput('');
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(Array.from(e.target.files));
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-4">
      {/* Chat Window */}
      {isOpen && !isMinimized && (
        <Card
          variant="glass"
          className="w-[400px] h-[600px] flex flex-col shadow-2xl border-cyber-green/30 animate-in fade-in slide-in-from-bottom-4 duration-300 overflow-hidden"
          padding="none"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-border bg-card flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-cyber-green animate-pulse" />
              <Typography variant="h3" weight="bold" className="text-sm uppercase tracking-wider">
                SuperClaw Direct
              </Typography>
            </div>
            <div className="flex items-center gap-1">
              {pageContext && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAttachContext(!attachContext)}
                  icon={
                    <Activity
                      size={14}
                      className={attachContext ? 'text-cyber-green' : 'text-foreground/20'}
                    />
                  }
                  title={attachContext ? 'Page context attached' : 'Attach page context'}
                  className="hover:bg-foreground/5"
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleMinimized}
                icon={<Minimize2 size={16} />}
                className="hover:text-cyber-green"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleOpen}
                icon={<X size={16} />}
                className="hover:text-red-500"
              />
            </div>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-hidden relative bg-[radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--cyber-green)_5%,transparent)_0%,_transparent_70%)]">
            <ChatMessageList
              messages={messages}
              isLoading={isLoading}
              scrollRef={scrollRef}
              showThinking={true}
            />
          </div>

          {/* Input Area */}
          <div className="px-6 py-4 border-t border-border bg-card">
            <ChatInput
              input={input}
              setInput={setInput}
              onSend={handleSendMessage}
              isLoading={isLoading}
              attachments={attachments}
              onRemoveAttachment={removeAttachment}
              fileInputRef={fileInputRef}
              onFileSelect={handleFileSelect}
            />
          </div>
        </Card>
      )}

      {/* Minimized Bar */}
      {isOpen && isMinimized && (
        <button
          onClick={toggleMinimized}
          className="bg-background/80 backdrop-blur-md border border-cyber-green/30 px-4 py-2 rounded-lg flex items-center gap-3 shadow-lg hover:border-cyber-green transition-all group"
        >
          <div className="w-2 h-2 rounded-full bg-cyber-green animate-pulse" />
          <Typography
            variant="caption"
            weight="bold"
            className="uppercase tracking-widest text-[10px]"
          >
            SuperClaw Active
          </Typography>
          <Maximize2 size={14} className="text-foreground/40 group-hover:text-foreground" />
        </button>
      )}

      {/* Floating Action Button (FAB) */}
      {!isOpen && (
        <button
          onClick={toggleOpen}
          className="w-14 h-14 rounded-full bg-cyber-green text-black flex items-center justify-center shadow-[0_0_20px_color-mix(in_srgb,var(--cyber-green)_40%,transparent)] hover:scale-110 transition-transform group relative"
          aria-label="Open Chat"
        >
          <div className="absolute inset-0 rounded-full bg-cyber-green animate-ping opacity-20" />
          <MessageSquare size={24} className="group-hover:rotate-12 transition-transform" />
        </button>
      )}
    </div>
  );
}
