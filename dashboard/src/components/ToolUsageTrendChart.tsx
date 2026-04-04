'use client';

import React, { useMemo } from 'react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';

interface ToolUsageData {
  name: string;
  calls: number[];
  color: string;
}

interface ToolUsageTrendChartProps {
  tools: ToolUsageData[];
  days?: string[];
}

const COLORS = [
  'var(--cyber-green)',
  'var(--cyber-blue)',
  '#a855f7',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
];

export default function ToolUsageTrendChart({ tools, days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }: ToolUsageTrendChartProps) {
  const maxCalls = useMemo(() => {
    const allCalls = tools.flatMap(t => t.calls);
    return Math.max(...allCalls, 1);
  }, [tools]);

  const width = 600;
  const height = 140;
  const padding = 30;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  return (
    <Card variant="glass" padding="lg" className="border-white/5 bg-black/40">
      <Typography variant="caption" weight="black" color="intel" uppercase className="tracking-[0.4em] mb-6 block">7-Day Tool Usage Trends</Typography>

      <div className="flex flex-wrap gap-4 mb-4">
        {tools.map((tool, i) => (
          <div key={tool.name} className="flex items-center gap-2 text-[10px] font-mono">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tool.color ?? COLORS[i % COLORS.length] }} />
            <span className="text-white/60 uppercase">{tool.name}</span>
          </div>
        ))}
      </div>

      <div className="relative h-[180px] w-full">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
            const y = padding + chartHeight - tick * chartHeight;
            return (
              <g key={tick}>
                <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="white" strokeOpacity="0.05" strokeDasharray="4 4" />
                <text x={padding - 5} y={y} fill="white" fillOpacity="0.2" fontSize="8" fontFamily="monospace" textAnchor="end" alignmentBaseline="middle">
                  {Math.round(tick * maxCalls)}
                </text>
              </g>
            );
          })}

          {days.map((day, i) => {
            const x = padding + (i * chartWidth) / (days.length - 1);
            return (
              <text
                key={day}
                x={x}
                y={height - 2}
                fill="white"
                fillOpacity="0.3"
                fontSize="9"
                fontFamily="monospace"
                textAnchor="middle"
                className="uppercase font-bold"
              >
                {day}
              </text>
            );
          })}

          {tools.map((tool, toolIndex) => {
            const points = tool.calls.map((calls, i) => {
              const x = padding + (i * chartWidth) / (tool.calls.length - 1);
              const y = padding + chartHeight - (calls / maxCalls) * chartHeight;
              return `${x},${y}`;
            }).join(' ');

            const areaPath = `M ${padding},${padding + chartHeight} ${points} L ${padding + chartWidth},${padding + chartHeight} Z`;
            const color = tool.color ?? COLORS[toolIndex % COLORS.length];

            return (
              <g key={tool.name}>
                <defs>
                  <linearGradient id={`gradient-${tool.name}`} x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={areaPath} fill={`url(#gradient-${tool.name})`} />
                <polyline
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
                  points={points}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {tool.calls.map((calls, i) => {
                  const x = padding + (i * chartWidth) / (tool.calls.length - 1);
                  const y = padding + chartHeight - (calls / maxCalls) * chartHeight;
                  return (
                    <g key={i} className="group/point">
                      <circle cx={x} cy={y} r="3" fill={color} className="transition-all duration-300 group-hover/point:r-5" />
                      <text
                        x={x}
                        y={y - 8}
                        fill={color}
                        fontSize="10"
                        fontFamily="monospace"
                        textAnchor="middle"
                        className="opacity-0 group-hover/point:opacity-100 transition-opacity font-bold"
                      >
                        {calls}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </Card>
  );
}
