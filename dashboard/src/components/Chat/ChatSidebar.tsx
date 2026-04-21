import { Plus, Clock, Trash2, Search, Pin, PinOff } from 'lucide-react';
import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import type { ConversationMeta } from '@claw/core/lib/types/memory';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import CyberTooltip from '@/components/CyberTooltip';

interface ChatSidebarProps {
  sessions: ConversationMeta[];
  activeSessionId: string;
  onSessionSelect: (sessionId: string) => void;
  onNewChat: (agentId?: string) => void;
  onDeleteSession: (e: React.MouseEvent, sessionId: string) => void;
  onDeleteAll: () => void;
  onTogglePin: (sessionId: string, isPinned: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

export function ChatSidebar({
  sessions,
  activeSessionId,
  onSessionSelect,
  onNewChat,
  onDeleteSession,
  onDeleteAll,
  onTogglePin,
  searchQuery,
  setSearchQuery,
  searchInputRef,
}: ChatSidebarProps) {
  const { t } = useTranslations();
  const filteredSessions = sessions
    .filter(
      (s) =>
        s.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.lastMessage?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      const bTime = typeof b.updatedAt === 'string' ? parseInt(b.updatedAt, 10) : b.updatedAt;
      const aTime = typeof a.updatedAt === 'string' ? parseInt(a.updatedAt, 10) : a.updatedAt;
      return bTime - aTime;
    });

  const getExpiryText = (expiresAt?: number) => {
    if (!expiresAt) return null;
    // eslint-disable-next-line react-hooks/purity
    const now = Math.floor(Date.now() / 1000);
    const diff = expiresAt - now;
    if (diff <= 0) return 'Expired';

    const hours = Math.floor(diff / (60 * 60));
    if (hours < 1) return 'Expires soon';
    if (hours < 24) return `Expires in ${hours}h`;

    const days = Math.floor(hours / 24);
    return `Expires in ${days}d`;
  };

  return (
    <aside className="w-80 border-r border-white/5 flex flex-col bg-black/20 shrink-0 overflow-hidden">
      {/* Search Header */}
      <div className="p-6 shrink-0 border-b border-white/5">
        <div className="relative group/search">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 group-focus-within/search:text-cyber-green transition-colors"
          />
          <input
            type="text"
            ref={searchInputRef as React.RefObject<HTMLInputElement>}
            placeholder={t('CHAT_SIDEBAR_SEARCH')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/[0.03] border border-white/5 focus:border-cyber-green/40 rounded-lg py-2.5 pl-9 pr-4 text-xs text-white outline-none transition-all placeholder:text-white/10"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pt-6 pb-2 space-y-2">
        <div className="mb-4 px-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock size={10} className="text-white/60" />
            <Typography variant="caption" weight="bold" color="muted">
              {t('CHAT_SIDEBAR_CONVERSATION_LOGS')}
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
              <Typography variant="mono" color="danger" className="text-[8px]">
                {t('CHAT_SIDEBAR_PURGE_ALL')}
              </Typography>
            </Button>
          )}
        </div>

        {filteredSessions.length === 0 ? (
          <Card variant="solid" padding="sm" className="text-center italic text-white/20">
            <Typography variant="caption">
              {searchQuery ? t('CHAT_SIDEBAR_NO_MATCHES') : t('CHAT_SIDEBAR_NO_LOGS')}
            </Typography>
          </Card>
        ) : (
          filteredSessions.map((s) => (
            <div
              key={s.sessionId}
              role="button"
              tabIndex={0}
              onClick={() => onSessionSelect(s.sessionId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSessionSelect(s.sessionId);
                }
              }}
              className={`p-4 flex flex-col items-stretch rounded-lg border transition-all text-left space-y-2 group cursor-pointer bg-transparent relative overflow-hidden ${
                activeSessionId === s.sessionId
                  ? 'border-cyber-green/40 bg-cyber-green/5 shadow-[0_0_20px_rgba(0,255,163,0.05)]'
                  : 'border-white/5 hover:border-white/10 hover:bg-white/[0.02]'
              }`}
            >
              {s.isPinned && (
                <div
                  className="absolute top-0 right-0 w-8 h-8 flex items-center justify-end pr-2 pt-1 opacity-40 text-cyber-green"
                >
                  <Pin size={10} className="rotate-45" />
                </div>
              )}

              <div className="flex justify-between items-start gap-2 w-full">
                <Typography
                  variant="caption"
                  weight="bold"
                  className={`truncate ${activeSessionId === s.sessionId ? 'text-cyber-green' : 'text-white/80'}`}
                >
                  {s.title ?? 'Untitled Trace'}
                </Typography>
              </div>

              <Typography
                variant="mono"
                color="muted"
                className="truncate italic block h-4 w-full cursor-pointer leading-tight"
              >
                {s.lastMessage ?? 'Waiting for signal...'}
              </Typography>

              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  <Typography
                    variant="mono"
                    color="muted"
                    className="text-[8px] cursor-pointer opacity-80"
                  >
                    {new Date(s.updatedAt).toLocaleString([], {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </Typography>
                  {!s.isPinned && s.expiresAt && (
                    <Typography
                      variant="mono"
                      className="text-[8px] text-amber-500/60 lowercase italic"
                    >
                      {getExpiryText(s.expiresAt)}
                    </Typography>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <CyberTooltip content={s.isPinned ? t('CHAT_SIDEBAR_UNPIN_SESSION') : t('CHAT_SIDEBAR_PIN_SESSION')} position="top" showIcon={false} width="w-auto">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePin(s.sessionId, !s.isPinned);
                      }}
                      className={`p-1 h-auto transition-colors z-10 ${s.isPinned ? 'text-cyber-green' : 'text-white/20'}`}
                      icon={s.isPinned ? <PinOff size={12} /> : <Pin size={12} />}
                    />
                  </CyberTooltip>
                  <CyberTooltip content={t('CHAT_DELETE_CONVERSATION')} position="top" showIcon={false} width="w-auto">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(e, s.sessionId);
                      }}
                      className="p-1 text-red-500/40 hover:text-red-500 h-auto transition-colors z-10"
                      icon={<Trash2 size={12} />}
                    />
                  </CyberTooltip>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-4 border-t border-white/5 bg-black/40">
        <Button
          onClick={() => onNewChat()}
          fullWidth
          variant="outline"
          className="h-11 border-dashed border-white/10 hover:border-cyber-green/40 hover:bg-cyber-green/5 group"
          icon={
            <Plus
              size={16}
              className="group-hover:rotate-90 transition-transform text-cyber-green"
            />
          }
        >
          <span className="group-hover:text-cyber-green transition-colors font-bold uppercase tracking-wider text-xs">
            {t('CHAT_SIDEBAR_NEW_CHAT')}
          </span>
        </Button>
      </div>
    </aside>
  );
}
