'use client';

import React from 'react';
import { X, BarChart2, Clock, TrendingUp, Zap, Trash2 } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import MemoryPrioritySelector from '@/components/MemoryPrioritySelector';

interface MemoryItem {
  userId: string;
  timestamp: number;
  content: string;
  metadata?: {
    priority?: number;
    category?: string;
    impact?: number;
    hitCount?: number;
    lastAccessed?: number;
  };
  type?: string;
}

interface MemoryDetailModalProps {
  item: MemoryItem | null;
  onClose: () => void;
  onDelete: (userId: string, timestamp: number) => void;
}

function getBadgeVariant(item: MemoryItem) {
  if (item.userId.startsWith('GAP') || item.type === 'GAP' || item.type === 'MEMORY:STRATEGIC_GAP') return 'danger';
  if (item.userId.startsWith('LESSON') || item.type === 'LESSON' || item.type === 'MEMORY:TACTICAL_LESSON') return 'primary';
  if (item.userId.startsWith('DISTILLED') || item.type === 'DISTILLED' || item.type === 'MEMORY:SYSTEM_KNOWLEDGE') return 'intel';
  if (item.type === 'MEMORY:USER_PREFERENCE' || item.userId.startsWith('USER#')) return 'warning';
  return 'audit';
}

function getCategoryLabel(item: MemoryItem) {
  return item.metadata?.category || item.type?.replace('MEMORY:', '').replace(/_/g, ' ') || 'UNKNOWN';
}

function renderContent(content: string) {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === 'string') {
      return <p className="text-white/90 leading-relaxed">{parsed}</p>;
    }
    if (typeof parsed === 'object' && parsed !== null) {
      return (
        <pre className="text-xs text-white/80 font-mono leading-relaxed bg-black/40 border border-white/5 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap custom-scrollbar max-h-[400px]">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
    }
    return <p className="text-white/90 leading-relaxed">{JSON.stringify(parsed)}</p>;
  } catch {
    return <p className="text-white/90 leading-relaxed whitespace-pre-wrap">{content}</p>;
  }
}

export default function MemoryDetailModal({ item, onClose, onDelete }: MemoryDetailModalProps) {
  if (!item) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-[#0a0a0a] border border-white/10 rounded-lg shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[#0a0a0a] border-b border-white/10 px-6 py-4 flex items-center justify-between">
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
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors p-1">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <div>
            <Typography variant="caption" color="muted" className="text-[10px] uppercase tracking-widest mb-3 block">
              Content
            </Typography>
            {renderContent(item.content)}
          </div>

          {/* Metadata - compact row at bottom */}
          <div className="pt-4 border-t border-white/5">
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2 bg-white/[0.03] border border-white/5 rounded px-3 py-2">
                <Zap size={12} className="text-amber-400" />
                <Typography variant="mono" className="text-[10px] uppercase tracking-widest text-white/40">Priority</Typography>
                <Typography variant="mono" className="text-sm font-black text-amber-400">{item.metadata?.priority ?? 5}</Typography>
              </div>
              <div className="flex items-center gap-2 bg-white/[0.03] border border-white/5 rounded px-3 py-2">
                <BarChart2 size={12} className="text-cyber-blue" />
                <Typography variant="mono" className="text-[10px] uppercase tracking-widest text-white/40">Utility</Typography>
                <Typography variant="mono" className="text-sm font-black">{item.metadata?.hitCount ?? 0}</Typography>
              </div>
              <div className="flex items-center gap-2 bg-white/[0.03] border border-white/5 rounded px-3 py-2">
                <Clock size={12} className="text-white/40" />
                <Typography variant="mono" className="text-[10px] uppercase tracking-widest text-white/40">Recalled</Typography>
                <Typography variant="mono" className="text-xs font-bold text-white/70">
                  {item.metadata?.lastAccessed ? new Date(item.metadata.lastAccessed).toLocaleDateString() : 'Never'}
                </Typography>
              </div>
              {item.metadata?.impact != null && (
                <div className="flex items-center gap-2 bg-white/[0.03] border border-white/5 rounded px-3 py-2">
                  <TrendingUp size={12} className="text-cyber-green" />
                  <Typography variant="mono" className="text-[10px] uppercase tracking-widest text-white/40">Impact</Typography>
                  <Typography variant="mono" className="text-sm font-black text-cyber-green">{item.metadata.impact}/10</Typography>
                </div>
              )}
              <div className="flex items-center gap-2 bg-white/[0.03] border border-white/5 rounded px-3 py-2">
                <Clock size={12} className="text-white/30" />
                <Typography variant="mono" className="text-[10px] uppercase tracking-widest text-white/40">Created</Typography>
                <Typography variant="mono" className="text-xs text-white/50">
                  {new Date(item.timestamp).toLocaleString()}
                </Typography>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="sticky bottom-0 z-10 bg-[#0a0a0a] border-t border-white/10 px-6 py-4 flex items-center justify-between">
          <MemoryPrioritySelector
            userId={item.userId}
            timestamp={item.timestamp}
            currentPriority={item.metadata?.priority ?? 5}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(item.userId, item.timestamp)}
            className="text-white/50 hover:text-red-500"
            icon={<Trash2 size={14} />}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
