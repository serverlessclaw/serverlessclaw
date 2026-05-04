'use client';

import React from 'react';
import { Activity } from 'lucide-react';
import Typography from '../ui/Typography';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import type { Tool } from '@/lib/types/ui';

interface LeaderboardTabProps {
  allTools: Tool[];
  searchQuery?: string;
}

export default function LeaderboardTab({ allTools, searchQuery = '' }: LeaderboardTabProps) {
  const sortedByUsage = [...allTools].sort((a, b) => (b.usage?.count ?? 0) - (a.usage?.count ?? 0));

  const filteredTools = sortedByUsage.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <section className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center">
        <h4 className="text-[12px] font-black uppercase tracking-[0.4em] text-muted-foreground flex items-center gap-2">
          <Activity size={16} className="text-cyber-blue" /> Total neural invocations
        </h4>
        <Typography variant="mono" color="muted" className="text-[10px] opacity-60 font-black">
          RANKED BY HISTORICAL UTILIZATION
        </Typography>
      </div>

      <Card variant="solid" className="border-border bg-input overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[600px]">
            <thead>
              <tr className="border-b border-border bg-background/50">
                <th className="p-4 text-[10px] font-black tracking-widest text-muted-foreground">
                  Capability
                </th>
                <th className="p-4 text-[10px] font-black tracking-widest text-muted-foreground">
                  Total invocations
                </th>
                <th className="p-4 text-[10px] font-black tracking-widest text-muted-foreground">
                  Last active
                </th>
                <th className="p-4 text-[10px] font-black tracking-widest text-muted-foreground text-right">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredTools.map((tool) => {
                return (
                  <tr
                    key={tool.name}
                    className="border-b border-border hover:bg-background/40 transition-colors group"
                  >
                    <td className="p-4">
                      <div className="flex flex-col">
                        <span
                          className={`text-xs font-black tracking-wider ${tool.isExternal ? 'text-purple-400' : 'text-yellow-600 dark:text-yellow-500'}`}
                        >
                          {tool.name}
                        </span>
                        {tool.isExternal && (
                          <span className="text-[8px] opacity-60 font-black">External bridge</span>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 bg-background rounded-full flex-1 max-w-[150px] overflow-hidden border border-border">
                          <div
                            className={`h-full ${tool.isExternal ? 'bg-purple-500' : 'bg-yellow-500'}`}
                            style={{
                              width: `${Math.min(100, ((tool.usage?.count ?? 0) / (sortedByUsage[0]?.usage?.count ?? 1)) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs font-mono font-bold text-foreground opacity-80">
                          {tool.usage?.count}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="text-[10px] font-mono text-muted-foreground opacity-60">
                        {tool.usage?.lastUsed
                          ? new Date(tool.usage.lastUsed).toLocaleTimeString()
                          : 'NEVER'}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      {(tool.usage?.count ?? 0) > 0 ? (
                        <Badge
                          variant="primary"
                          className="bg-cyber-blue/10 text-cyber-blue border-cyber-blue/20 text-[8px] font-black uppercase tracking-widest"
                        >
                          Active
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-input text-muted-foreground border-border text-[8px] font-black uppercase tracking-widest"
                        >
                          Standby
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredTools.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="p-10 text-center text-white/20 italic text-xs tracking-widest"
                  >
                    No neural activity detected for current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}
