import React, { memo, useMemo, useState } from 'react';
import Image from 'next/image';
import {
  User,
  Bot,
  Terminal,
  File,
  Loader2,
  MessageCircle,
  Copy,
  Check,
  Wrench,
  ChevronDown,
  ChevronRight,
  Search,
  X as CloseIcon,
} from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { ChatMessage } from './types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type MarkdownComponents = NonNullable<React.ComponentProps<typeof ReactMarkdown>['components']>;
type MarkdownNodeProps = {
  children?: React.ReactNode;
};

const CodeBlock = ({ children }: { children: string }) => {
  const [copied, setCopied] = React.useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group/code my-2">
      <div className="absolute right-2 top-2 z-10 opacity-0 group-hover/code:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="sm"
          onClick={copyToClipboard}
          className="!p-1.5 h-auto bg-black/40 border border-white/10 text-white/40 hover:text-cyber-green"
          icon={copied ? <Check size={12} /> : <Copy size={12} />}
          title="Copy to clipboard"
        />
      </div>
      <pre className="bg-black/40 p-3 rounded-md border border-white/10 overflow-x-auto custom-scrollbar">
        <code className="font-mono text-sm text-cyber-green/90">{children}</code>
      </pre>
    </div>
  );
};

interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

const ToolCallsDisplay = ({ toolCalls }: { toolCalls: ToolCall[] }) => {
  const [expanded, setExpanded] = useState(false);

  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.03] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-amber-500/5 transition-colors"
      >
        {expanded ? (
          <ChevronDown size={12} className="text-amber-500/70" />
        ) : (
          <ChevronRight size={12} className="text-amber-500/70" />
        )}
        <Wrench size={12} className="text-amber-500/70" />
        <Typography
          variant="mono"
          className="text-[10px] text-amber-500/80 uppercase tracking-wider"
        >
          {toolCalls.length} tool call{toolCalls.length !== 1 ? 's' : ''}
        </Typography>
        <Typography variant="mono" className="text-[9px] text-white/30 ml-auto">
          {toolCalls
            .map((tc) => tc.function?.name)
            .filter(Boolean)
            .join(', ')}
        </Typography>
      </button>
      {expanded && (
        <div className="border-t border-amber-500/10 px-3 py-2 space-y-2">
          {toolCalls.map((tc, i) => (
            <div key={tc.id || i} className="bg-black/20 rounded p-2">
              <Typography variant="mono" className="text-[10px] text-amber-400 font-bold">
                {tc.function?.name ?? 'unknown'}
              </Typography>
              {tc.function?.arguments && (
                <pre className="mt-1 text-[10px] text-white/50 whitespace-pre-wrap overflow-x-auto custom-scrollbar">
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(tc.function.arguments), null, 2);
                    } catch {
                      return tc.function.arguments;
                    }
                  })()}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Static markdown component map — defined outside render to avoid recreation
const markdownComponents = (role: string): MarkdownComponents => ({
  p: ({ children }: MarkdownNodeProps) => (
    <Typography
      variant="body"
      color={role === 'assistant' ? 'inherit' : 'white'}
      className="block mb-2 last:mb-0 break-words"
    >
      {children}
    </Typography>
  ),
  h1: ({ children }: MarkdownNodeProps) => (
    <Typography
      variant="h3"
      color={role === 'assistant' ? 'inherit' : 'white'}
      className="block mt-4 mb-2 text-cyber-green"
      glow
    >
      {children}
    </Typography>
  ),
  h2: ({ children }: MarkdownNodeProps) => (
    <Typography
      variant="h3"
      color={role === 'assistant' ? 'inherit' : 'white'}
      className="block mt-3 mb-1 text-cyber-green/90"
    >
      {children}
    </Typography>
  ),
  h3: ({ children }: MarkdownNodeProps) => (
    <Typography
      variant="body"
      weight="bold"
      color={role === 'assistant' ? 'inherit' : 'white'}
      className="block mt-2 mb-1 text-cyber-green/80"
    >
      {children}
    </Typography>
  ),
  ul: ({ children }: MarkdownNodeProps) => (
    <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>
  ),
  ol: ({ children }: MarkdownNodeProps) => (
    <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>
  ),
  li: ({ children }: MarkdownNodeProps) => (
    <li>
      <Typography
        variant="body"
        color={role === 'assistant' ? 'inherit' : 'white'}
        className="inline"
      >
        {children}
      </Typography>
    </li>
  ),
  code: ({ children, className }: React.ComponentProps<'code'>) => {
    const inline = !className?.includes('language-');
    if (inline) {
      return (
        <code className="bg-white/10 px-1 rounded font-mono text-sm text-cyber-green/100">
          {children}
        </code>
      );
    }
    return <CodeBlock>{String(children).replace(/\n$/, '')}</CodeBlock>;
  },
  strong: ({ children }: { children?: React.ReactNode }) => (
    <Typography
      variant="body"
      weight="bold"
      color={role === 'assistant' ? 'inherit' : 'white'}
      className="inline text-white"
    >
      {children}
    </Typography>
  ),
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-cyber-green hover:underline decoration-cyber-green/50 underline-offset-4"
    >
      {children}
    </a>
  ),
});

interface ChatMessageRowProps {
  message: ChatMessage;
  index: number;
  onOptionClick?: (value: string, comment?: string) => void;
  showThinking?: boolean;
  isLast?: boolean;
  isLoading?: boolean;
}

const ChatMessageRow = memo(function ChatMessageRow({
  message,
  index,
  onOptionClick,
  showThinking,
  isLast,
  isLoading,
}: ChatMessageRowProps) {
  const m = message;
  const key = m.messageId ? `${m.role}-${m.messageId}` : `local-${index}`;
  const components = useMemo(() => markdownComponents(m.role), [m.role]);
  const [comment, setComment] = React.useState('');

  const shouldShowThought = showThinking || (isLast && isLoading && m.thought);

  return (
    <div key={key} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`flex gap-3 max-w-[85%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
      >
        <div
          className={`w-8 h-8 rounded shrink-0 flex items-center justify-center border ${
            m.role === 'user'
              ? 'bg-white/5 border-white/10 text-white/100'
              : 'bg-cyber-green/10 border-cyber-green/30 text-cyber-green'
          }`}
        >
          {m.role === 'user' ? <User size={16} /> : <Bot size={16} />}
        </div>
        <div className="flex flex-col gap-1">
          {m.role === 'assistant' && m.agentName && (
            <Typography
              variant="caption"
              weight="bold"
              color="primary"
              className="flex items-center gap-1 pl-1"
            >
              <span className="w-1 h-1 rounded-full bg-cyber-green/60 inline-block" />
              {m.agentName}
            </Typography>
          )}
          <div className="flex flex-col gap-2">
            {m.role === 'assistant' && m.thought && shouldShowThought && (
              <Card
                variant="glass"
                padding="sm"
                className="rounded-lg bg-cyber-green/[0.03] border-dashed border-cyber-green/20 text-cyber-green/80 italic text-[11px] leading-relaxed max-w-full mb-1 shadow-[0_0_15px_rgba(0,255,145,0.02)]"
              >
                <div className="flex items-start gap-2">
                  <Terminal size={11} className="shrink-0 mt-0.5 text-cyber-green/50" />
                  <div className="whitespace-pre-wrap">{m.thought}</div>
                </div>
              </Card>
            )}

            {(m.role === 'user' || m.content) && (
              <Card
                variant="glass"
                padding="sm"
                className={`rounded-lg ${
                  m.role === 'user'
                    ? 'bg-white/5 text-white/90 border border-white/10'
                    : 'text-cyber-green/90 border-cyber-green/20 shadow-[0_0_20px_rgba(0,255,145,0.05)]'
                }`}
              >
                {m.content && (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                    {m.content}
                  </ReactMarkdown>
                )}
              </Card>
            )}

            {m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0 && (
              <ToolCallsDisplay toolCalls={m.tool_calls} />
            )}

            {m.attachments && m.attachments.length > 0 && (
              <div
                className={`flex flex-wrap gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {m.attachments.map((a, ai) => (
                  <div key={ai} className="relative group/att">
                    {a.type === 'image' && (a.url || a.base64) ? (
                      <div className="w-32 h-32 rounded-lg overflow-hidden border border-white/10 hover:border-cyber-green/50 transition-colors shadow-lg relative">
                        <Image
                          src={a.url || `data:${a.mimeType ?? 'image/png'};base64,${a.base64}`}
                          alt={a.name ?? 'Attachment'}
                          fill
                          className="object-cover cursor-zoom-in"
                          onClick={() => a.url && window.open(a.url, '_blank')}
                        />
                      </div>
                    ) : (
                      <a
                        href={a.url}
                        download={a.name}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 bg-white/5 border border-white/10 p-2 rounded-lg hover:border-cyber-green/50 transition-colors group/dl"
                      >
                        <File
                          size={16}
                          className="text-white/40 group-hover/dl:text-cyber-green transition-colors"
                        />
                        <div className="flex flex-col">
                          <Typography variant="caption" className="max-w-[120px] truncate">
                            {a.name}
                          </Typography>
                          {a.url && (
                            <Typography
                              variant="mono"
                              className="text-[8px] text-white/30 uppercase"
                            >
                              Download
                            </Typography>
                          )}
                        </div>
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {m.options && m.options.length > 0 && (
              <div className="flex flex-col gap-3 mt-2">
                <div className="flex flex-wrap gap-2">
                  {m.options.map((opt, oi) => (
                    <Button
                      key={oi}
                      variant={
                        opt.type === 'primary'
                          ? 'primary'
                          : opt.type === 'danger'
                            ? 'danger'
                            : 'outline'
                      }
                      size="sm"
                      className="!py-1 !px-3 text-[10px] font-mono tracking-wider uppercase border border-white/10"
                      onClick={() => {
                        onOptionClick?.(opt.value, comment);
                        setComment('');
                      }}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>

                <div className="relative max-w-sm">
                  <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-white/20">
                    <MessageCircle size={14} />
                  </div>
                  <input
                    type="text"
                    placeholder="Add an optional comment..."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg py-1.5 pl-9 pr-3 text-[11px] text-white/80 placeholder:text-white/20 focus:outline-none focus:border-cyber-green/30 transition-colors font-mono"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

interface ChatMessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onOptionClick?: (value: string, comment?: string) => void;
  showThinking?: boolean;
}

export function ChatMessageList({
  messages,
  isLoading,
  scrollRef,
  onOptionClick,
  showThinking,
}: ChatMessageListProps) {
  const [msgSearchQuery, setMsgSearchQuery] = useState('');

  const filteredMessages = useMemo(() => {
    if (!msgSearchQuery.trim()) return messages;
    const lowerQuery = msgSearchQuery.toLowerCase();
    return messages.filter(
      (m) =>
        m.content?.toLowerCase().includes(lowerQuery) ||
        m.thought?.toLowerCase().includes(lowerQuery) ||
        m.agentName?.toLowerCase().includes(lowerQuery)
    );
  }, [messages, msgSearchQuery]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-transparent relative">
      {/* Local Message Search Overlay */}
      <div className="absolute top-0 left-0 right-0 z-10 px-6 py-2 border-b border-white/5 bg-black/40 backdrop-blur-md flex items-center gap-3">
        <div className="relative flex-1 group/msgsearch">
          <Search
            size={12}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 group-focus-within/msgsearch:text-cyber-green transition-colors"
          />
          <input
            type="text"
            placeholder="Search messages..."
            value={msgSearchQuery}
            onChange={(e) => setMsgSearchQuery(e.target.value)}
            className="w-full bg-white/[0.03] border border-white/5 focus:border-cyber-green/40 rounded py-1 pl-8 pr-4 text-[10px] text-white outline-none transition-all placeholder:text-white/10"
          />
          {msgSearchQuery && (
            <button
              onClick={() => setMsgSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/60 transition-colors"
            >
              <CloseIcon size={10} />
            </button>
          )}
        </div>
        {msgSearchQuery && (
          <Typography
            variant="mono"
            className="text-[9px] text-cyber-green/60 uppercase whitespace-nowrap"
          >
            {filteredMessages.length} Matches
          </Typography>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 pt-12 space-y-3 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/[0.02] via-transparent to-transparent custom-scrollbar"
      >
        {filteredMessages.length === 0 && !isLoading && (
          <div className="h-full flex flex-col items-center justify-center text-white/80">
            <Terminal size={48} className="mb-4 opacity-10" />
            <Typography variant="h3" weight="normal" color="white" className="opacity-80">
              {msgSearchQuery
                ? 'No matching signals found'
                : 'System Ready // Waiting for Input Command/File'}
            </Typography>
            <Typography variant="mono" color="muted" className="mt-2 block">
              {msgSearchQuery
                ? 'Try a different search query'
                : 'Initialise interaction by sending a message'}
            </Typography>
          </div>
        )}

        {filteredMessages.map((m, i) => (
          <ChatMessageRow
            key={m.messageId ? `${m.role}-${m.messageId}` : `local-${i}`}
            message={m}
            index={i}
            onOptionClick={onOptionClick}
            showThinking={showThinking}
            isLast={i === messages.length - 1}
            isLoading={isLoading}
          />
        ))}

        {isLoading && !msgSearchQuery && (
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded shrink-0 flex items-center justify-center border bg-cyber-green/10 border-cyber-green/30 text-cyber-green animate-pulse">
              <Bot size={16} />
            </div>
            <Card variant="glass" padding="sm" className="flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-cyber-green" />
              <Typography variant="caption" weight="bold" color="primary" className="animate-pulse">
                Processing...
              </Typography>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
