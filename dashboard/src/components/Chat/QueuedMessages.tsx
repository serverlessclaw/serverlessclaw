/**
 * @module QueuedMessages
 * @description Components for displaying and managing messages that are waiting to be processed.
 */
import React, { useState } from 'react';
import { Clock, Edit2, X, Check } from 'lucide-react';
import { logger } from '@claw/core/lib/logger';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import type { PendingMessage } from '@claw/core/lib/types/session';

interface QueuedMessageItemProps {
  message: PendingMessage;
  onEdit: (messageId: string, newContent: string) => Promise<void>;
  onRemove: (messageId: string) => Promise<void>;
}

/**
 * Individual item representing a queued message with edit and remove capabilities.
 *
 * @param props - Component properties including message and event handlers.
 */
export function QueuedMessageItem({ message, onEdit, onRemove }: QueuedMessageItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(message.content);
  const [isLoading, setIsLoading] = useState(false);

  const handleSave = async () => {
    if (editedContent.trim() === message.content) {
      setIsEditing(false);
      return;
    }
    setIsLoading(true);
    try {
      await onEdit(message.id, editedContent);
      setIsEditing(false);
    } catch (error) {
      logger.error('Failed to edit message:', error);
      setEditedContent(message.content);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemove = async () => {
    setIsLoading(true);
    try {
      await onRemove(message.id);
    } catch (error) {
      logger.error('Failed to remove message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatTimestamp = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex gap-3 justify-end">
      <div className="flex gap-3 max-w-[85%] flex-row-reverse">
        <div className="w-8 h-8 rounded shrink-0 flex items-center justify-center border bg-amber-500/10 border-amber-500/30 text-amber-500">
          <Clock size={16} />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 pl-1">
            <Typography
              variant="caption"
              weight="bold"
              color="warning"
              className="flex items-center gap-1"
            >
              <Clock size={10} className="animate-pulse" />
              Queued
            </Typography>
            <Typography variant="mono" className="text-[10px] text-white/30">
              {formatTimestamp(message.timestamp)}
            </Typography>
          </div>
          <Card
            variant="glass"
            padding="sm"
            className="rounded-lg bg-amber-500/5 text-white/80 border border-amber-500/20"
          >
            {isEditing ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  className="w-full bg-black/20 border border-amber-500/30 rounded p-2 text-sm text-white/90 resize-none focus:outline-none focus:border-amber-500/50"
                  rows={Math.max(2, editedContent.split('\n').length)}
                  autoFocus
                />
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIsEditing(false);
                      setEditedContent(message.content);
                    }}
                    className="!py-1 !px-2 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSave}
                    disabled={isLoading}
                    className="!py-1 !px-2 text-xs"
                  >
                    <Check size={12} />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <Typography variant="body" className="flex-1 break-words">
                  {message.content}
                </Typography>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setIsEditing(true)}
                    className="p-1 hover:bg-white/10 rounded transition-colors"
                    title="Edit message"
                  >
                    <Edit2 size={12} className="text-white/50 hover:text-amber-400" />
                  </button>
                  <button
                    onClick={handleRemove}
                    disabled={isLoading}
                    className="p-1 hover:bg-white/10 rounded transition-colors"
                    title="Remove message"
                  >
                    <X size={12} className="text-white/50 hover:text-red-400" />
                  </button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

interface QueuedMessagesListProps {
  messages: PendingMessage[];
  onEdit: (messageId: string, newContent: string) => Promise<void>;
  onRemove: (messageId: string) => Promise<void>;
}

/**
 * A list of queued messages displayed at the bottom of the chat.
 * Represents messages that were sent while an agent task was already in progress.
 *
 * @param props - Component properties including the array of pending messages.
 */
export function QueuedMessagesList({ messages, onEdit, onRemove }: QueuedMessagesListProps) {
  if (messages.length === 0) return null;

  return (
    <div className="border-t border-amber-500/10 pt-3 mt-3">
      <div className="flex items-center gap-2 mb-2 px-1">
        <Clock size={14} className="text-amber-500 animate-pulse" />
        <Typography variant="caption" weight="bold" color="warning">
          {messages.length} queued message{messages.length !== 1 ? 's' : ''} (waiting for current
          task)
        </Typography>
      </div>
      <div className="space-y-2">
        {messages.map((msg) => (
          <QueuedMessageItem key={msg.id} message={msg} onEdit={onEdit} onRemove={onRemove} />
        ))}
      </div>
    </div>
  );
}
