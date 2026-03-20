import React from 'react';
import { User, Bot, Terminal, File, Loader2 } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import { ChatMessage } from './types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatMessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export function ChatMessageList({ messages, isLoading, scrollRef }: ChatMessageListProps) {
  return (
    <div 
      ref={scrollRef}
      className="flex-1 overflow-y-auto p-4 space-y-3 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/[0.02] via-transparent to-transparent custom-scrollbar"
    >
      {messages.length === 0 && !isLoading && (
          <div className="h-full flex flex-col items-center justify-center text-white/80">
              <Terminal size={48} className="mb-4 opacity-10" />
              <Typography variant="h3" weight="normal" color="white" className="opacity-80">
                System Ready // Waiting for Input Command/File
              </Typography>
              <Typography variant="mono" color="muted" className="mt-2 block">
                Initialise interaction by sending a message
              </Typography>
          </div>
      )}

      {messages.map((m, i) => (
        <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`flex gap-3 max-w-[85%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
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
              <div className="flex flex-col gap-2">
                {m.content && (
                  <Card variant="glass" padding="sm" className={`rounded-lg ${
                    m.role === 'user' ? 'bg-white/5 text-white/90 border border-white/10' : 'text-cyber-green/90 border-cyber-green/20 shadow-[0_0_20px_rgba(0,255,145,0.05)]'
                  }`}>
                    <ReactMarkdown 
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }) => <Typography variant="body" className="block mb-2 last:mb-0 break-words">{children}</Typography>,
                        h1: ({ children }) => <Typography variant="h3" className="block mt-4 mb-2 text-cyber-green" glow>{children}</Typography>,
                        h2: ({ children }) => <Typography variant="h3" className="block mt-3 mb-1 text-cyber-green/90">{children}</Typography>,
                        h3: ({ children }) => <Typography variant="body" weight="bold" className="block mt-2 mb-1 text-cyber-green/80">{children}</Typography>,
                        ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
                        li: ({ children }) => <li><Typography variant="body" className="inline">{children}</Typography></li>,
                        code: ({ children, className }) => {
                          const inline = !className?.includes('language-');
                          return inline ? (
                            <code className="bg-white/10 px-1 rounded font-mono text-sm text-cyber-green/100">{children}</code>
                          ) : (
                            <pre className="bg-black/40 p-3 rounded-md border border-white/10 my-2 overflow-x-auto custom-scrollbar">
                              <code className="font-mono text-sm text-cyber-green/90">{children}</code>
                            </pre>
                          );
                        },
                        strong: ({ children }) => <Typography variant="body" weight="bold" className="inline text-white">{children}</Typography>,
                        a: ({ children, href }) => (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyber-green hover:underline decoration-cyber-green/50 underline-offset-4">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {m.content}
                    </ReactMarkdown>
                  </Card>
                )}
                
                {m.attachments && m.attachments.length > 0 && (
                  <div className={`flex flex-wrap gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {m.attachments.map((a, ai) => (
                      <div key={ai} className="relative group/att">
                        {a.type === 'image' && (a.url || a.base64) ? (
                          <div className="w-32 h-32 rounded-lg overflow-hidden border border-white/10 hover:border-cyber-green/50 transition-colors shadow-lg">
                            <img 
                              src={a.url || `data:${a.mimeType ?? 'image/png'};base64,${a.base64}`} 
                              alt={a.name} 
                              className="w-full h-full object-cover cursor-zoom-in"
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
                            <File size={16} className="text-white/40 group-hover/dl:text-cyber-green transition-colors" />
                            <div className="flex flex-col">
                              <Typography variant="caption" className="max-w-[120px] truncate">{a.name}</Typography>
                              {a.url && <Typography variant="mono" className="text-[8px] text-white/30 uppercase">Download</Typography>}
                            </div>
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
      
      {isLoading && (
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
  );
}
