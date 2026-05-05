'use client';

import React from 'react';
import { Zap } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import { EnrichedTrace, TranslationFn } from './types';

interface GroupedTableViewProps {
  groupedData: Array<[string, EnrichedTrace[]]>;
  t: TranslationFn;
  onExpand: (groupName: string) => void;
}

export default function GroupedTableView({ groupedData, t, onExpand }: GroupedTableViewProps) {
  return (
    <div className="glass-card overflow-hidden border-border">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border bg-foreground/[0.02]">
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                {t('NEURAL_GROUP')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center">
                {t('TRACES')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center">
                {t('RESOURCES')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center">
                {t('STATUS')}
              </th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-right">
                {t('ACTION')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {groupedData.map(([groupName, groupTraces]) => {
              const totalTokens = groupTraces.reduce(
                (acc, t) => acc + (t.totalTokens || 0),
                0
              );
              const errorCount = groupTraces.filter((t) => t.status === 'error').length;

              return (
                <tr key={groupName} className="hover:bg-foreground/[0.02] transition-colors group">
                  <td className="px-6 py-4">
                    <Typography
                      variant="mono"
                      weight="bold"
                      className="text-xs text-foreground/90 truncate max-w-[300px]"
                    >
                      {groupName}
                    </Typography>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-xs font-mono text-cyber-blue">{groupTraces.length}</span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex items-center justify-center gap-1.5 text-xs font-mono text-cyber-green/70">
                      <Zap size={10} /> {(totalTokens / 1000).toFixed(1)}k
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex items-center justify-center gap-2">
                      {errorCount > 0 ? (
                        <div className="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded border border-red-400/20">
                          {errorCount} ERR
                        </div>
                      ) : (
                        <div className="w-2 h-2 rounded-full bg-cyber-green shadow-[0_0_8px_rgba(0,255,163,0.5)]"></div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => onExpand(groupName)}
                      className="text-[10px] font-black uppercase tracking-widest text-cyber-blue hover:text-foreground transition-colors bg-cyber-blue/5 hover:bg-cyber-blue/20 px-3 py-1.5 rounded border border-cyber-blue/20"
                    >
                      {t('EXPLORE')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
