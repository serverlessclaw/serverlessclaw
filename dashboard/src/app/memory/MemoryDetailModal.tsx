'use client';

import React, { useState, useEffect } from 'react';
import { X, BarChart2, Clock, TrendingUp, Zap, Trash2, Edit3, Save, RefreshCw } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { toast } from 'sonner';
import MemoryPrioritySelector from '@/components/MemoryPrioritySelector';
import { MemoryItem, getBadgeVariant, getCategoryLabel } from './types';

interface MemoryDetailModalProps {
  item: MemoryItem | null;
  onClose: () => void;
  onDelete: (userId: string, timestamp: number) => void;
  onUpdate: (formData: FormData) => Promise<void>;
}

function renderContent(content: string) {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    // not JSON, treat as plain text
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    return (
      <div className="space-y-3">
        {Object.entries(obj).map(([key, value]) => (
          <div key={key} className="bg-white/[0.03] border border-white/5 rounded-lg p-4">
            <Typography variant="mono" className="text-[10px] uppercase tracking-widest text-white/40 mb-1 block">
              {key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
            </Typography>
            <Typography variant="body" className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap">
              {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
            </Typography>
          </div>
        ))}
      </div>
    );
  }

  if (parsed && typeof parsed === 'string') {
    return <p className="text-white/90 leading-relaxed text-[15px]">{parsed}</p>;
  }

  return <p className="text-white/90 leading-relaxed text-[15px] whitespace-pre-wrap">{content}</p>;
}

export default function MemoryDetailModal({ item, onClose, onDelete, onUpdate }: MemoryDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (item) {
      setEditContent(item.content);
      setIsEditing(false);
    }
  }, [item]);

  if (!item) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      let isJson = false;
      try {
        JSON.parse(item.content);
        isJson = true;
      } catch {
        // Not JSON, that's fine
      }

      if (isJson) {
        try {
          JSON.parse(editContent);
        } catch {
          toast.error('Invalid JSON content. Please check your syntax.');
          setIsSaving(false);
          return;
        }
      }

      const formData = new FormData();
      formData.set('userId', item.userId);
      formData.set('timestamp', String(item.timestamp));
      formData.set('content', editContent);
      formData.set('isJson', isJson ? 'true' : 'false');
      await onUpdate(formData);
      setIsEditing(false);
      toast.success('Memory updated successfully');
    } catch (err) {
      console.error('Failed to update memory:', err);
      toast.error('Failed to update memory');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    // eslint-disable-next-line no-alert
    if (!confirm('Are you sure you want to delete this memory? This action cannot be undone.')) return;
    onDelete(item.userId, item.timestamp);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-3xl max-h-[85vh] flex flex-col bg-[#0a0a0a] border border-white/10 rounded-lg shadow-xl overflow-hidden">
        {/* Header */}
        <div className="shrink-0 bg-[#0a0a0a] border-b border-white/10 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant={getBadgeVariant(item)} className="uppercase tracking-widest">
              {getCategoryLabel(item)}
            </Badge>
            <Typography variant="mono" color="muted" className="text-[10px] opacity-50">
              {item.userId.split('#')[1] || item.userId}
            </Typography>
            {item.metadata?.priority && item.metadata.priority >= 8 && (
              <div className="flex items-center gap-1 text-amber-400">
                <Zap size={12} />
                <span className="text-[9px] font-bold">HIGH</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isEditing ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(true)}
                className="text-white/40 hover:text-cyber-blue p-1"
                icon={<Edit3 size={16} />}
              />
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSave}
                disabled={isSaving}
                className="text-cyber-green/60 hover:text-cyber-green p-1"
                icon={isSaving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
              />
            )}
            <button onClick={onClose} className="text-white/40 hover:text-white transition-colors p-1 ml-2">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-black/20">
          {isEditing ? (
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full h-full min-h-[300px] bg-black/40 border border-white/5 rounded p-4 font-mono text-sm text-white/90 focus:outline-none focus:border-cyber-blue/30 transition-all resize-none"
              placeholder="Edit memory content..."
            />
          ) : (
            renderContent(item.content)
          )}
        </div>

        {/* Footer - metadata + actions all in one row */}
        <div className="shrink-0 bg-[#0a0a0a] border-t border-white/10 px-6 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {/* Metadata pills */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-[11px] font-mono">
                <Zap size={11} className="text-amber-400" />
                <span className="text-white/40">Pri</span>
                <span className="font-black text-amber-400">{item.metadata?.priority ?? 5}</span>
              </div>
              <span className="text-white/10">|</span>
              <div className="flex items-center gap-1.5 text-[11px] font-mono">
                <BarChart2 size={11} className="text-cyber-blue" />
                <span className="text-white/40">Use</span>
                <span className="font-bold text-white/70">{item.metadata?.hitCount ?? 0}</span>
              </div>
              <span className="text-white/10">|</span>
              <div className="flex items-center gap-1.5 text-[11px] font-mono">
                <Clock size={11} className="text-white/30" />
                <span className="text-white/40">Recalled</span>
                <span className="text-white/50">
                  {item.metadata?.lastAccessed ? new Date(item.metadata.lastAccessed).toLocaleDateString() : 'Never'}
                </span>
              </div>
              {item.metadata?.impact != null && (
                <>
                  <span className="text-white/10">|</span>
                  <div className="flex items-center gap-1.5 text-[11px] font-mono">
                    <TrendingUp size={11} className="text-cyber-green" />
                    <span className="text-white/40">Impact</span>
                    <span className="font-bold text-cyber-green">{item.metadata.impact}/10</span>
                  </div>
                </>
              )}
              {item.timestamp > 0 && (
                <>
                  <span className="text-white/10">|</span>
                  <div className="flex items-center gap-1.5 text-[11px] font-mono text-white/30">
                    <Clock size={11} />
                    {new Date(item.timestamp).toLocaleDateString()}
                  </div>
                </>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <MemoryPrioritySelector
                userId={item.userId}
                timestamp={item.timestamp}
                currentPriority={item.metadata?.priority ?? 5}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                className="text-white/40 hover:text-red-500 p-1.5"
                icon={<Trash2 size={13} />}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
