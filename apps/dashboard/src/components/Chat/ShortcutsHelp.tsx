'use client';

import React from 'react';
import { Keyboard, X } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Button from '@/components/ui/Button';
import { TranslationKey } from '@/components/Providers/TranslationsProvider';

interface ShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
  t: (key: TranslationKey) => string;
}

export const ShortcutsHelp: React.FC<ShortcutsHelpProps> = ({ isOpen, onClose, t }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-card-elevated border border-border rounded-2xl p-6 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Keyboard size={18} className="text-cyber-green" />
            <Typography variant="h3" weight="bold" color="primary" glow className="uppercase">
              {t('CHAT_KEYBOARD_SHORTCUTS_TITLE')}
            </Typography>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="p-1 text-muted-foreground/40 hover:text-foreground"
            icon={<X size={16} />}
          />
        </div>
        <div className="space-y-2 text-[11px] font-mono">
          {[
            { keys: 'Cmd/Ctrl + K', desc: t('SHORTCUTS_FOCUS_SEARCH') },
            { keys: 'Cmd/Ctrl + Alt + N', desc: t('SHORTCUTS_NEW_CHAT') },
            { keys: 'Cmd/Ctrl + /', desc: t('SHORTCUTS_FOCUS_CHAT_INPUT') },
            { keys: 'Cmd/Ctrl + E', desc: t('SHORTCUTS_EDIT_SESSION_TITLE') },
            { keys: 'Cmd/Ctrl + T', desc: t('SHORTCUTS_TOGGLE_THINKING') },
            { keys: 'Cmd/Ctrl + Enter', desc: t('SHORTCUTS_SEND_MESSAGE') },
            { keys: 'Shift + Enter', desc: t('SHORTCUTS_NEW_LINE') },
            { keys: 'Escape', desc: t('SHORTCUTS_CLOSE_MODALS') },
            { keys: '?', desc: t('SHORTCUTS_SHOW_HELP') },
          ].map(({ keys, desc }) => (
            <div
              key={keys}
              className="flex items-center justify-between py-1.5 border-b border-border last:border-0"
            >
              <span className="text-muted-foreground">{desc}</span>
              <kbd className="bg-foreground/5 border border-border rounded px-2 py-0.5 text-[10px] text-cyber-green">
                {keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
