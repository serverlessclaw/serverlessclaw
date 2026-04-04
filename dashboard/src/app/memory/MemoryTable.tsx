'use client';

import React, { useState } from 'react';
import { Eye, Trash2, Clock, BarChart2, Zap, CheckSquare, Square, Loader2 } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { toast } from 'sonner';
import MemoryDetailModal from './MemoryDetailModal';
import { MemoryItem, getBadgeVariant, getCategoryLabel } from './types';

interface MemoryTableProps {
  items: MemoryItem[];
  pruneAction: (formData: FormData) => Promise<void>;
  updateAction: (formData: FormData) => Promise<void>;
  bulkPruneAction: (keys: Array<{ userId: string; timestamp: number }>) => Promise<void>;
}

function getContentPreview(content: string, maxLen: number = 80): string {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === 'string')
      return parsed.length > maxLen ? parsed.slice(0, maxLen) + '...' : parsed;
    if (typeof parsed === 'object' && parsed !== null) {
      const summaryKey = [
        'planSummary',
        'failureReason',
        'fact',
        'content',
        'summary',
        'text',
        'description',
        'message',
        'reason',
      ].find((k) => typeof parsed[k] === 'string' && parsed[k].length > 0);
      if (summaryKey) {
        const val = parsed[summaryKey] as string;
        return val.length > maxLen ? val.slice(0, maxLen) + '...' : val;
      }
      const firstString = Object.values(parsed).find(
        (v) => typeof v === 'string' && v.length > 0
      ) as string | undefined;
      if (firstString) {
        return firstString.length > maxLen ? firstString.slice(0, maxLen) + '...' : firstString;
      }
      return Object.keys(parsed).join(', ');
    }
    return JSON.stringify(parsed);
  } catch {
    return content.length > maxLen ? content.slice(0, maxLen) + '...' : content;
  }
}

export default function MemoryTable({
  items,
  pruneAction,
  updateAction,
  bulkPruneAction,
}: MemoryTableProps) {
  const [selectedItem, setSelectedItem] = useState<MemoryItem | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [isBulkPruning, setIsBulkPruning] = useState(false);

  const toggleSelect = (userId: string, timestamp: number) => {
    const key = `${userId}|${timestamp}`;
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  };

  const toggleSelectAll = () => {
    if (selectedKeys.size === items.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(items.map((i) => `${i.userId}|${i.timestamp}`)));
    }
  };

  const handleBulkPrune = async () => {
    if (selectedKeys.size === 0) return;
    // eslint-disable-next-line no-alert
    if (!confirm(`Permanently prune ${selectedKeys.size} memory records?`)) return;

    setIsBulkPruning(true);
    try {
      const keys = Array.from(selectedKeys).map((k) => {
        const [userId, timestamp] = k.split('|');
        return { userId, timestamp: parseInt(timestamp) };
      });
      await bulkPruneAction(keys);
      setSelectedKeys(new Set());
      toast.success(`${keys.length} records pruned`);
    } catch {
      toast.error('Failed to prune selected records');
    } finally {
      setIsBulkPruning(false);
    }
  };

  const handleDelete = async (userId: string, timestamp: number) => {
    const formData = new FormData();
    formData.set('userId', userId);
    formData.set('timestamp', String(timestamp));
    await pruneAction(formData);
    setSelectedItem(null);
  };

  const formatDate = (val: number | string | undefined, type: 'date' | 'time' = 'date') => {
    if (!val) return type === 'date' ? 'N/A' : '';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return type === 'date' ? 'N/A' : '';
      return type === 'date'
        ? d.toLocaleDateString()
        : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return type === 'date' ? 'N/A' : '';
    }
  };

  return (
    <>
      <div className="flex justify-between items-center mb-4 px-2">
        <Typography
          variant="mono"
          color="muted"
          className="text-[10px] uppercase tracking-widest opacity-40"
        >
          {selectedKeys.size > 0
            ? `${selectedKeys.size} Records Selected`
            : 'Select records for bulk operations'}
        </Typography>
        {selectedKeys.size > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkPrune}
            disabled={isBulkPruning}
            icon={
              isBulkPruning ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />
            }
            className="h-7 text-red-400 border-red-500/20 hover:bg-red-500/10 text-[10px] uppercase font-black"
          >
            Prune Selected
          </Button>
        )}
      </div>

      <div className="glass-card overflow-hidden border-white/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02]">
                <th className="pl-6 pr-2 py-4 w-10">
                  <button
                    onClick={toggleSelectAll}
                    className="text-white/20 hover:text-white transition-colors"
                  >
                    {selectedKeys.size === items.length && items.length > 0 ? (
                      <CheckSquare size={14} className="text-cyber-blue" />
                    ) : (
                      <Square size={14} />
                    )}
                  </button>
                </th>
                <th className="px-4 py-4 text-[10px] font-black uppercase tracking-widest text-white/40">
                  Category
                </th>

                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white/40">
                  Content
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white/40 text-center">
                  Pri
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white/40 text-center">
                  Use
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white/40">
                  Created
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white/40">
                  Last Recalled
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white/40 text-right">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items &&
                items.length > 0 &&
                items.map((item, i) => {
                  const key = `${item.userId}|${item.timestamp}`;
                  const isSelected = selectedKeys.has(key);
                  return (
                    <tr
                      key={`${item.userId}-${item.timestamp}-${i}`}
                      onClick={() => toggleSelect(item.userId, item.timestamp)}
                      className={`hover:bg-white/[0.03] transition-colors cursor-pointer group ${
                        isSelected
                          ? 'bg-cyber-blue/[0.05]'
                          : item.metadata?.priority && item.metadata.priority >= 8
                            ? 'bg-amber-500/[0.03]'
                            : ''
                      }`}
                    >
                      <td className="pl-6 pr-2 py-4">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelect(item.userId, item.timestamp);
                          }}
                          className={`transition-colors ${isSelected ? 'text-cyber-blue' : 'text-white/10 group-hover:text-white/30'}`}
                        >
                          {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                        </button>
                      </td>
                      <td className="px-4 py-4">
                        <Badge
                          variant={getBadgeVariant(item)}
                          className="uppercase tracking-widest whitespace-nowrap"
                        >
                          {getCategoryLabel(item)}
                        </Badge>
                      </td>
                      <td
                        className="px-5 py-3"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedItem(item);
                        }}
                      >
                        <Typography
                          variant="body"
                          className="text-xs text-white/80 max-w-[400px] truncate block"
                        >
                          {getContentPreview(item.content || '')}
                        </Typography>
                      </td>

                      <td className="px-5 py-3 text-center">
                        {item.metadata?.priority != null && item.metadata.priority >= 8 ? (
                          <span className="inline-flex items-center gap-1 text-amber-400 font-mono text-xs font-bold">
                            <Zap size={10} /> {item.metadata.priority}
                          </span>
                        ) : (
                          <span className="text-white/40 font-mono text-xs">
                            {item.metadata?.priority ?? '-'}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className="flex items-center justify-center gap-1 text-white/50 font-mono text-xs">
                          <BarChart2 size={10} /> {item.metadata?.hitCount ?? 0}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="flex flex-col text-cyber-blue/60 font-mono text-[10px] leading-tight">
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {formatDate(
                              item.createdAt || item.metadata?.createdAt || item.timestamp,
                              'date'
                            )}
                          </span>
                          <span className="pl-3.5 opacity-70">
                            {formatDate(
                              item.createdAt || item.metadata?.createdAt || item.timestamp,
                              'time'
                            )}
                          </span>
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-1 text-white/40 font-mono text-[11px]">
                          <Clock size={10} />
                          {item.metadata?.lastAccessed
                            ? formatDate(item.metadata.lastAccessed, 'date')
                            : 'Never'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedItem(item);
                            }}
                            className="text-white/50 hover:text-cyber-blue p-1"
                            icon={<Eye size={14} />}
                            title="View Details"
                          />
                          <form action={pruneAction} onClick={(e) => e.stopPropagation()}>
                            <input type="hidden" name="userId" value={item.userId} />
                            <input type="hidden" name="timestamp" value={item.timestamp} />
                            <Button
                              variant="ghost"
                              size="sm"
                              type="submit"
                              className="text-white/50 hover:text-red-500 p-1"
                              icon={<Trash2 size={14} />}
                              title="Delete"
                            />
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <MemoryDetailModal
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onDelete={handleDelete}
        onUpdate={updateAction}
      />
    </>
  );
}
