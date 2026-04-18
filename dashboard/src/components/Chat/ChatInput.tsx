'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, X, File } from 'lucide-react';
import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import { AttachmentPreview } from './types';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  onSend: (e: React.FormEvent) => void;
  attachments: AttachmentPreview[];
  onRemoveAttachment: (index: number) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isShaking?: boolean;
  chatInputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export function ChatInput({
  input,
  setInput,
  isLoading,
  onSend,
  attachments,
  onRemoveAttachment,
  fileInputRef,
  onFileSelect,
  isShaking = false,
  chatInputRef,
}: ChatInputProps) {
  const { t } = useTranslations();
  const [localShake, setLocalShake] = useState(false);
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = (chatInputRef as React.RefObject<HTMLTextAreaElement>) || internalRef;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    // If no text and no attachments, shake the input
    if (!input.trim() && attachments.length === 0) {
      setLocalShake(true);
      setTimeout(() => setLocalShake(false), 500);
      // Focus the textarea
      textareaRef.current?.focus();
      return;
    }
    onSend(e);
  };

  const shouldShake = isShaking || localShake;

  // Focus textarea when isShaking changes to true (from parent)
  useEffect(() => {
    if (isShaking) {
      textareaRef.current?.focus();
    }
  }, [isShaking, textareaRef]);

  return (
    <div className="px-6 py-4 border-t border-white/5 bg-black/40 shrink-0">
      <form onSubmit={handleSend} className="max-w-4xl mx-auto relative group">
        {/* Attachment Previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-4 p-4 bg-white/5 rounded-lg border border-white/10 animate-in fade-in slide-in-from-bottom-2">
            {attachments.map((a, i) => (
              <div key={i} className="relative group/preview">
                {a.type === 'image' ? (
                  <div className="w-16 h-16 rounded border border-white/10 overflow-hidden relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.preview} alt="preview" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 bg-white/5 p-2 rounded border border-white/10">
                    <File size={16} className="text-white/40" />
                    <Typography variant="mono" className="text-[8px] max-w-[80px] truncate">
                      {a.file.name}
                    </Typography>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(i)}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white scale-0 group-hover/preview:scale-100 transition-transform shadow-lg"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="relative flex items-stretch gap-3">
          <input
            type="file"
            ref={fileInputRef}
            onChange={onFileSelect}
            className="hidden"
            multiple
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="h-[52px] w-[52px] !rounded-lg border border-white/5 hover:border-cyber-green/30 bg-white/[0.02] flex items-center justify-center p-0 self-center"
            icon={
              <Paperclip
                size={20}
                className="text-white/40 group-hover:text-cyber-green transition-colors"
              />
            }
          />

          <div className={`flex-1 relative flex ${shouldShake ? 'animate-shake' : ''}`}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                  e.preventDefault();
                  handleSend(e);
                }
              }}
              placeholder={t('CHAT_PLACEHOLDER')}
              className={`w-full h-full bg-white/[0.02] border rounded-lg py-[15px] px-4 pr-12 text-sm text-white outline-none transition-all placeholder:text-white/20 resize-none max-h-[200px] overflow-hidden leading-5 box-border ${shouldShake ? 'border-cyber-green shadow-[0_0_15px_rgba(0,255,163,0.5)]' : 'border-white/5 focus:border-cyber-green/40'}`}
              rows={1}
              style={{ height: '52px' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = '52px';
                if (target.scrollHeight > 52) {
                  target.style.height = `${target.scrollHeight}px`;
                }
              }}
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[8px] font-mono text-white/10 uppercase pointer-events-none group-focus-within:text-cyber-green/40 transition-colors">
              {t('CHAT_CMD_ENTER')}
            </div>
          </div>

          <Button
            type="submit"
            disabled={(!input.trim() && attachments.length === 0) || isLoading}
            className={`h-[52px] px-6 !rounded-lg self-center transition-all ${
              (!input.trim() && attachments.length === 0) || isLoading
                ? 'opacity-50 cursor-not-allowed'
                : 'shadow-[0_0_20px_rgba(0,255,163,0.1)] group-hover:shadow-[0_0_30px_rgba(0,255,163,0.2)]'
            }`}
            variant="primary"
            icon={<Send size={18} className={isLoading ? 'animate-ping' : ''} />}
          >
            {isLoading ? t('CHAT_EXECUTING') : t('CHAT_SEND')}
          </Button>
        </div>
      </form>
    </div>
  );
}
