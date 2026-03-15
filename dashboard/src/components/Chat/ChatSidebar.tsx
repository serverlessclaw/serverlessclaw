import React from 'react';
import { Plus, Clock, Trash2, ChevronRight } from 'lucide-react';
import { THEME } from '@/lib/theme';
import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { ConversationMeta } from './types';

interface ChatSidebarProps {
  sessions: ConversationMeta[];
  activeSessionId: string;
  onSessionSelect: (sessionId: string) => void;
  onNewChat: () => void;
  onDeleteSession: (e: React.MouseEvent, sessionId: string) => void;
  onDeleteAll: () => void;
}

export function ChatSidebar({ 
  sessions, 
  activeSessionId, 
  onSessionSelect, 
  onNewChat, 
  onDeleteSession, 
  onDeleteAll 
}: ChatSidebarProps) {
  return (
    <aside className="w-80 border-r border-white/5 flex flex-col bg-black/20 shrink-0">
      <div className="p-6 shrink-0">
        <Button
          onClick={onNewChat}
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
              onClick={onDeleteAll}
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
              onClick={() => onSessionSelect(s.sessionId)}
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
                    onClick={(e) => onDeleteSession(e, s.sessionId)}
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
  );
}
