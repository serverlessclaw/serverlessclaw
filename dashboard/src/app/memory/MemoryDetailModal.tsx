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

export default function MemoryDetailModal({ item, onClose, onDelete }: MemoryDetailModalProps) {
  if (!item) return null;

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
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors p-1">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {renderContent(item.content)}
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
                onClick={() => onDelete(item.userId, item.timestamp)}
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
