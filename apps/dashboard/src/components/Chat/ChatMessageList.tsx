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
import { ChatMessage } from '@claw/hooks';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DynamicComponentRegistry } from '@/components/DynamicComponents/Registry';

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
          className="!p-1.5 h-auto bg-card-elevated border border-border text-muted-foreground hover:text-cyber-green"
          icon={copied ? <Check size={12} /> : <Copy size={12} />}
          title="Copy to clipboard"
        />
      </div>
      <pre className="bg-input p-3 rounded-md border border-border overflow-x-auto custom-scrollbar">
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
        <Typography variant="mono" className="text-[9px] text-muted-foreground/40 ml-auto">
          {toolCalls
            .map((tc) => tc.function?.name)
            .filter(Boolean)
            .join(', ')}
        </Typography>
      </button>
      {expanded && (
        <div className="border-t border-amber-500/10 px-3 py-2 space-y-2">
          {toolCalls.map((tc, i) => (
            <div key={tc.id || i} className="bg-input rounded p-2">
              <Typography variant="mono" className="text-[10px] text-amber-400 font-bold">
                {tc.function?.name ?? 'unknown'}
              </Typography>
              {tc.function?.arguments && (
                <pre className="mt-1 text-[10px] text-muted-foreground whitespace-pre-wrap overflow-x-auto custom-scrollbar">
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
      as="div"
      color={role === 'assistant' ? 'inherit' : 'primary'}
      className="block mb-1 last:mb-0 break-words"
    >
      {children}
    </Typography>
  ),
  h1: ({ children }: MarkdownNodeProps) => (
    <Typography
      variant="h3"
      color={role === 'assistant' ? 'inherit' : 'primary'}
      className="block mt-4 mb-2 text-cyber-green"
      glow
    >
      {children}
    </Typography>
  ),
  h2: ({ children }: MarkdownNodeProps) => (
    <Typography
      variant="h3"
      color={role === 'assistant' ? 'inherit' : 'primary'}
      className="block mt-3 mb-1 text-cyber-green/90"
    >
      {children}
    </Typography>
  ),
  h3: ({ children }: MarkdownNodeProps) => (
    <Typography
      variant="body"
      weight="bold"
      color={role === 'assistant' ? 'inherit' : 'primary'}
      className="block mt-2 mb-1 text-cyber-green/80"
    >
      {children}
    </Typography>
  ),
  ul: ({ children }: MarkdownNodeProps) => (
    <ul className="list-disc pl-5 mb-1 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }: MarkdownNodeProps) => (
    <ol className="list-decimal pl-5 mb-1 space-y-0.5">{children}</ol>
  ),
  li: ({ children }: MarkdownNodeProps) => (
    <li>
      <Typography
        variant="body"
        as="div"
        color={role === 'assistant' ? 'inherit' : 'primary'}
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
        <code className="bg-foreground/5 px-1 rounded font-mono text-sm text-cyber-green/100">
          {children}
        </code>
      );
    }
    return <CodeBlock>{String(children).replace(/\n$/, '')}</CodeBlock>;
  },
  strong: ({ children }: { children?: React.ReactNode }) => (
    <Typography
      variant="body"
      as="span"
      weight="bold"
      color={role === 'assistant' ? 'inherit' : 'primary'}
      className="inline font-bold"
    >
      {children}
    </Typography>
  ),
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-cyber-green hover:text-cyber-green/80 underline decoration-cyber-green/30 underline-offset-4 transition-colors font-medium"
    >
      {children}
    </a>
  ),
});

const formatTime = (ts?: number) => {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

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
}: Omit<ChatMessageRowProps, 'isLast' | 'isLoading'>) {
  const m = message;
  const key = m.messageId ? `${m.role}-${m.messageId}` : `local-${index}`;
  const components = useMemo(() => markdownComponents(m.role), [m.role]);
  const [comment, setComment] = React.useState('');

  const shouldShowThought = showThinking ?? true;
  const [copied, setCopied] = useState(false);

  const copyMessage = () => {
    if (!m.content) return;
    navigator.clipboard.writeText(m.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Visibility Guard: Hide the entire row if there's no visible content and it's not thinking
  const hasVisibleContent = !!(
    (m.content && m.content.trim().length > 0) ||
    (m.thought && m.thought.trim().length > 0 && shouldShowThought) ||
    (m.tool_calls && m.tool_calls.length > 0) ||
    (m.ui_blocks && m.ui_blocks.length > 0) ||
    (m.attachments && m.attachments.length > 0) ||
    (m.options && m.options.length > 0)
  );

  if (m.role === 'assistant' && !hasVisibleContent && !m.isThinking) {
    return null;
  }

  return (
    <div key={key} className={`flex gap-4 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`flex gap-4 max-w-[90%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
      >
        <div
          className={`w-8 h-8 rounded shrink-0 flex items-center justify-center border ${
            m.role === 'user'
              ? 'bg-foreground/5 border-border text-foreground'
              : 'bg-cyber-green/10 border-cyber-green/30 text-cyber-green'
          }`}
        >
          {m.role === 'user' ? <User size={16} /> : <Bot size={16} />}
        </div>
        <div className="flex flex-col gap-1">
          {m.role === 'assistant' && m.agentName && (
            <div className="flex items-center gap-2 pl-2">
              <Typography
                variant="caption"
                weight="bold"
                color="primary"
                className="flex items-center gap-1"
              >
                <span className="w-1 h-1 rounded-full bg-cyber-green/60 inline-block" />
                {m.agentName}
              </Typography>
              {m.createdAt && (
                <Typography variant="mono" className="text-[9px] text-muted-foreground/40">
                  {formatTime(m.createdAt)}
                </Typography>
              )}
              {m.modelName && (
                <Typography
                  variant="mono"
                  className="text-[8px] text-cyber-blue/30 uppercase tracking-tighter"
                >
                  {m.modelName}
                </Typography>
              )}
            </div>
          )}
          {m.role === 'user' && m.createdAt && (
            <div className="flex justify-end pr-2">
              <Typography variant="mono" className="text-[9px] text-muted-foreground/30">
                {formatTime(m.createdAt)}
              </Typography>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {m.role === 'assistant' && m.thought && shouldShowThought && (
              <Card
                variant="glass"
                padding="xs"
                className="rounded-lg bg-cyber-green/[0.03] border-dashed border-cyber-green/20 text-cyber-green/80 italic text-[11px] leading-relaxed max-w-full mb-1 shadow-[0_0_15px_rgba(0,255,145,0.02)]"
              >
                <div className="flex items-start gap-2">
                  <Terminal size={11} className="shrink-0 mt-0.5 text-cyber-green/50" />
                  <div className="whitespace-pre-wrap">{m.thought}</div>
                </div>
              </Card>
            )}

            {(m.role === 'user' || (m.content && m.content.trim().length > 0) || m.isThinking) && (
              <div className="relative group/msg">
                <Card
                  variant="glass"
                  padding="xs"
                  className={`rounded-lg ${
                    m.role === 'user'
                      ? 'bg-input text-foreground border border-border shadow-[0_4px_12px_rgba(0,0,0,0.02)]'
                      : 'text-cyber-green/90 border-cyber-green/20 shadow-[0_0_20px_rgba(0,255,145,0.05)]'
                  }`}
                >
                  {m.isThinking ? (
                    <div className="flex items-center gap-2 py-1">
                      <Loader2 size={14} className="animate-spin text-cyber-green" />
                      <Typography
                        variant="caption"
                        weight="bold"
                        color="primary"
                        className="animate-pulse uppercase tracking-wider text-[10px]"
                      >
                        Analysing Signal...
                      </Typography>
                    </div>
                  ) : (
                    m.content && (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                        {m.content}
                      </ReactMarkdown>
                    )
                  )}
                </Card>

                {m.isError && m.errorType === 'busy' && (
                  <div className="mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onOptionClick?.('FORCE_UNLOCK')}
                      className="text-[10px] text-amber-500 border-amber-500/50 hover:bg-amber-500/10 flex items-center gap-2"
                    >
                      <Terminal size={12} />
                      Force Unlock Session
                    </Button>
                  </div>
                )}

                {!m.isThinking && m.content && (
                  <div
                    className={`absolute top-2 ${
                      m.role === 'user' ? '-left-8' : '-right-8'
                    } opacity-0 group-hover/msg:opacity-100 transition-opacity flex flex-col gap-1`}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={copyMessage}
                      className="!p-1.5 h-auto hover:text-cyber-green"
                      icon={copied ? <Check size={12} /> : <Copy size={12} />}
                      title="Copy message"
                    />
                  </div>
                )}
              </div>
            )}

            {m.pageContext && (
              <div
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} mt-1 mb-2`}
              >
                <div className="flex items-center gap-2 px-2 py-1 rounded border border-cyber-blue/20 bg-cyber-blue/[0.03] max-w-[80%]">
                  <div className="w-1 h-1 rounded-full bg-cyber-blue animate-pulse" />
                  <Typography variant="mono" className="text-[9px] text-cyber-blue/70 truncate">
                    Context: {m.pageContext.title || m.pageContext.url}
                  </Typography>
                </div>
              </div>
            )}

            {m.role === 'assistant' && m.usage && (
              <div className="flex items-center gap-3 pl-2 opacity-40 hover:opacity-100 transition-opacity">
                <Typography variant="mono" className="text-[8px] uppercase tracking-widest">
                  IO_TKS: {m.usage.prompt_tokens} / {m.usage.completion_tokens}
                </Typography>
                <div className="w-1 h-1 rounded-full bg-muted-foreground/20" />
                <Typography variant="mono" className="text-[8px] uppercase tracking-widest">
                  TTL_TKS:{' '}
                  {m.usage.total_tokens || m.usage.prompt_tokens + m.usage.completion_tokens}
                </Typography>
              </div>
            )}

            {m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0 && (
              <ToolCallsDisplay toolCalls={m.tool_calls} />
            )}

            {m.role === 'assistant' && m.ui_blocks && m.ui_blocks.length > 0 && (
              <div className="flex flex-col gap-4 mt-2 max-w-sm">
                {m.ui_blocks.map((block) => (
                  <DynamicComponentRegistry
                    key={block.id}
                    component={block}
                    onAction={(actionId, payload) => {
                      onOptionClick?.(
                        actionId,
                        payload
                          ? typeof payload === 'string'
                            ? payload
                            : JSON.stringify(payload)
                          : undefined
                      );
                    }}
                  />
                ))}
              </div>
            )}

            {m.attachments && m.attachments.length > 0 && (
              <div
                className={`flex flex-wrap gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {m.attachments.map((a, ai) => (
                  <div key={ai} className="relative group/att">
                    {a.type === 'image' && (a.url || a.base64) ? (
                      <div className="w-32 h-32 rounded-lg overflow-hidden border border-border hover:border-cyber-green/50 transition-colors shadow-lg relative">
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
                        className="flex items-center gap-2 bg-input border border-border p-2 rounded-lg hover:border-cyber-green/50 transition-colors group/dl"
                      >
                        <File
                          size={16}
                          className="text-muted-foreground/40 group-hover/dl:text-cyber-green transition-colors"
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
                      className="!py-1 !px-3 text-[10px] font-mono tracking-wider uppercase border border-border"
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
                  <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-muted-foreground/20">
                    <MessageCircle size={14} />
                  </div>
                  <input
                    type="text"
                    placeholder="Add an optional comment..."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    className="w-full bg-input border border-border rounded-lg py-1.5 pl-9 pr-3 text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-cyber-green/30 transition-colors font-mono"
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

  // Auto-scroll logic
  React.useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    // We check if the user is currently at the bottom (with a bit of buffer)
    // If they are, we keep them at the bottom when new messages arrive.
    const threshold = 150;
    const isAtBottom =
      container.scrollHeight - container.scrollTop <= container.clientHeight + threshold;

    // Determine if we should force scroll (e.g. new message just sent or first response chunk)
    const lastMessage = messages[messages.length - 1];
    const shouldForceScroll = lastMessage?.role === 'user' || (messages.length > 0 && isAtBottom);

    if (shouldForceScroll || isAtBottom) {
      // Use requestAnimationFrame to ensure the DOM has rendered the new messages
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }, [messages, scrollRef]);

  // Force scroll to bottom when the component mounts or messages change for the first time in a session
  React.useEffect(() => {
    const container = scrollRef.current;
    if (container && messages.length > 0) {
      container.scrollTop = container.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length === 0]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-transparent relative">
      {/* Local Message Search Overlay */}
      <div className="absolute top-0 left-0 right-0 z-10 px-6 py-2 border-b border-border bg-background/40 backdrop-blur-md flex items-center gap-3">
        <div className="relative flex-1 group/msgsearch">
          <Search
            size={12}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/20 group-focus-within/msgsearch:text-cyber-green transition-colors"
          />
          <input
            type="text"
            placeholder="Search messages..."
            value={msgSearchQuery}
            onChange={(e) => setMsgSearchQuery(e.target.value)}
            className="w-full bg-input border border-border focus:border-cyber-green/40 rounded py-1 pl-8 pr-4 text-[10px] text-foreground outline-none transition-all placeholder:text-muted-foreground/40"
          />
          {msgSearchQuery && (
            <button
              onClick={() => setMsgSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/20 hover:text-foreground transition-colors"
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
        className="flex-1 overflow-y-auto px-6 py-4 pt-12 space-y-4 bg-[radial-gradient(circle_at_center,color-mix(in_srgb,var(--cyber-green)_2%,transparent)_0%,_transparent_70%)] custom-scrollbar"
      >
        {filteredMessages.length === 0 && !isLoading && (
          <div className="flex-1 flex flex-col items-center justify-center text-foreground/40 px-8 min-h-0">
            <Terminal size={48} className="mb-4 opacity-10" />
            <Typography variant="h3" weight="normal" color="primary" className="opacity-80">
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
          />
        ))}

        {isLoading &&
          !msgSearchQuery &&
          !messages.some((m) => m.role === 'assistant' && m.isThinking) && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded shrink-0 flex items-center justify-center border bg-cyber-green/10 border-cyber-green/30 text-cyber-green animate-pulse">
                <Bot size={16} />
              </div>
              <Card variant="glass" padding="sm" className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-cyber-green" />
                <Typography
                  variant="caption"
                  weight="bold"
                  color="primary"
                  className="animate-pulse"
                >
                  Processing...
                </Typography>
              </Card>
            </div>
          )}
      </div>
    </div>
  );
}
