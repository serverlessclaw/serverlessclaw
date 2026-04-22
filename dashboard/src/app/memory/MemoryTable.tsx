'use client';

import React, { useState } from 'react';
import { Eye, Trash2, Clock, BarChart2, Zap, CheckSquare, Square, Loader2 } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { toast } from 'sonner';
import MemoryDetailModal from './MemoryDetailModal';
import { MemoryItem, getBadgeVariant, getCategoryLabel } from './types';
import CyberConfirm from '@/components/CyberConfirm';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

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
  const { t } = useTranslations();
  const [selectedItem, setSelectedItem] = useState<MemoryItem | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [isBulkPruning, setIsBulkPruning] = useState(false);
  const [showBulkPruneConfirm, setShowBulkPruneConfirm] = useState(false);

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
    setShowBulkPruneConfirm(true);
  };

  const confirmBulkPrune = async () => {
    setShowBulkPruneConfirm(false);
    setIsBulkPruning(true);
    try {
      const keys = Array.from(selectedKeys).map((k) => {
        const [userId, timestamp] = k.split('|');
        return { userId, timestamp: parseInt(timestamp) };
      });
      await bulkPruneAction(keys);
      setSelectedKeys(new Set());
      toast.success(`${keys.length} ${t('MEMORY_PRUNED_SUCCESS')}`);
    } catch {
      toast.error(t('MEMORY_PRUNE_ERROR'));
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
            ? `${selectedKeys.size} ${t('MEMORY_RECORDS_SELECTED')}`
            : t('MEMORY_SELECT_RECORDS_BULK')}
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
            {t('MEMORY_PRUNE_SELECTED')}
          </Button>
        )}
      </div>

      <div className="glass-card overflow-hidden border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border bg-card">
                <th className="pl-6 pr-2 py-4 w-10">
                  <button
                    onClick={toggleSelectAll}
                    className="text-muted-more hover:text-foreground transition-colors"
                  >
                    {selectedKeys.size === items.length && items.length > 0 ? (
                      <CheckSquare size={14} className="text-cyber-blue" />
                    ) : (
                      <Square size={14} />
                    )}
                  </button>
                </th>
                <th className="px-4 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  {t('MEMORY_CATEGORY')}
                </th>

                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  {t('MEMORY_CONTENT')}
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center">
                  {t('MEMORY_PRIORITY')}
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center">
                  {t('MEMORY_USE_COUNT')}
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  {t('MEMORY_CREATED')}
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  {t('MEMORY_LAST_RECALLED')}
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-right">
                  {t('COMMON_ACTIONS')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items &&
                items.length > 0 &&
                items.map((item, i) => {
                  const key = `${item.userId}|${item.timestamp}`;
                  const isSelected = selectedKeys.has(key);
                  return (
                    <tr
                      key={`${item.userId}-${item.timestamp}-${i}`}
                      onClick={() => toggleSelect(item.userId, item.timestamp)}
                      className={`hover:bg-input transition-colors cursor-pointer group ${
                        isSelected
                          ? 'bg-cyber-blue/10'
                          : item.metadata?.priority && item.metadata.priority >= 8
                            ? 'bg-amber-500/5'
                            : ''
                      }`}
                    >
                      <td className="pl-6 pr-2 py-4">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelect(item.userId, item.timestamp);
                          }}
                          className={`transition-colors ${isSelected ? 'text-cyber-blue' : 'text-muted-more group-hover:text-muted-foreground'}`}
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
                          className="text-xs text-foreground/80 max-w-[400px] truncate block"
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
                          <span className="text-muted-foreground font-mono text-xs">
                            {item.metadata?.priority ?? '-'}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className="flex items-center justify-center gap-1 text-muted-foreground font-mono text-xs">
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
                        <span className="flex items-center gap-1 text-muted-foreground font-mono text-[11px]">
                          <Clock size={10} />
                          {item.metadata?.lastAccessed
                            ? formatDate(item.metadata.lastAccessed, 'date')
                            : t('MEMORY_RECALLED_NEVER')}
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
                            className="text-muted-foreground hover:text-cyber-blue p-1"
                            icon={<Eye size={14} />}
                            title={t('COMMON_VIEW_DETAILS')}
                          />
                          <form action={pruneAction} onClick={(e) => e.stopPropagation()}>
                            <input type="hidden" name="userId" value={item.userId} />
                            <input type="hidden" name="timestamp" value={item.timestamp} />
                            <Button
                              variant="ghost"
                              size="sm"
                              type="submit"
                              className="text-muted-foreground hover:text-red-500 p-1"
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

      <CyberConfirm
        isOpen={showBulkPruneConfirm}
        title={t('MEMORY_BULK_PURGE_TITLE')}
        message={t('MEMORY_BULK_PURGE_MESSAGE').replace('{count}', String(selectedKeys.size))}
        variant="danger"
        confirmText={t('MEMORY_CONFIRM_BULK_PRUNE')}
        onConfirm={confirmBulkPrune}
        onCancel={() => setShowBulkPruneConfirm(false)}
      />
    </>
  );
}
