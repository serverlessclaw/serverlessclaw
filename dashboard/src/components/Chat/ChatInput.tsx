import React from 'react';
import { Send, Paperclip, X, ImageIcon, File } from 'lucide-react';
import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import { AttachmentPreview } from './types';

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  onSend: (e: React.FormEvent) => void;
  attachments: AttachmentPreview[];
  onRemoveAttachment: (index: number) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function ChatInput({
  input,
  setInput,
  isLoading,
  onSend,
  attachments,
  onRemoveAttachment,
  fileInputRef,
  onFileSelect
}: ChatInputProps) {
  return (
    <div className="p-6 border-t border-white/5 bg-black/40 shrink-0">
      <form onSubmit={onSend} className="max-w-4xl mx-auto relative group">
        {/* Attachment Previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-4 p-4 bg-white/5 rounded-lg border border-white/10 animate-in fade-in slide-in-from-bottom-2">
            {attachments.map((a, i) => (
              <div key={i} className="relative group/preview">
                {a.type === 'image' ? (
                  <div className="w-16 h-16 rounded border border-white/10 overflow-hidden">
                    <img src={a.preview} alt="preview" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 bg-white/5 p-2 rounded border border-white/10">
                    <File size={16} className="text-white/40" />
                    <Typography variant="mono" className="text-[8px] max-w-[80px] truncate">{a.file.name}</Typography>
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

        <div className="relative flex items-end gap-3">
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
            className="p-3 h-[52px] w-[52px] !rounded-lg border border-white/5 hover:border-cyber-green/30 bg-white/[0.02]"
            icon={<Paperclip size={20} className="text-white/40 group-hover:text-cyber-green transition-colors" />}
          />
          
          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSend(e);
                }
              }}
              placeholder="Execute command or query system..."
              className="w-full bg-white/[0.02] border border-white/5 focus:border-cyber-green/40 rounded-lg p-4 pr-12 text-sm text-white outline-none transition-all placeholder:text-white/20 resize-none min-h-[52px] max-h-[200px] overflow-hidden"
              rows={1}
              style={{ height: 'auto' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = `${target.scrollHeight}px`;
              }}
            />
            <div className="absolute top-2 right-2 text-[8px] font-mono text-white/10 uppercase pointer-events-none group-focus-within:text-cyber-green/40 transition-colors">
              Cmd + Enter
            </div>
          </div>

          <Button
            type="submit"
            disabled={(!input.trim() && attachments.length === 0) || isLoading}
            className="h-[52px] px-6 !rounded-lg shadow-[0_0_20px_rgba(0,255,163,0.1)] group-hover:shadow-[0_0_30px_rgba(0,255,163,0.2)]"
            variant="primary"
            icon={<Send size={18} className={isLoading ? 'animate-ping' : ''} />}
          >
            {isLoading ? 'EXECUTING...' : 'SEND'}
          </Button>
        </div>
      </form>
      <div className="mt-4 flex justify-center items-center gap-6 opacity-20 group-focus-within:opacity-40 transition-opacity">
         <div className="flex items-center gap-2">
            <div className="w-1 h-1 rounded-full bg-cyber-green animate-pulse" />
            <Typography variant="mono" className="text-[7px] tracking-[0.2em] font-black">ENCRYPTED_CHANNEL</Typography>
         </div>
         <div className="flex items-center gap-2">
            <div className="w-1 h-1 rounded-full bg-cyber-green animate-pulse" />
            <Typography variant="mono" className="text-[7px] tracking-[0.2em] font-black">NEURAL_SYNC_READY</Typography>
         </div>
      </div>
    </div>
  );
}
