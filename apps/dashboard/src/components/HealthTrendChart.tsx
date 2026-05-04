'use client';

import React from 'react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';

interface HealthTrendChartProps {
  currentScore: number;
}

export default function HealthTrendChart({ currentScore }: HealthTrendChartProps) {
  // Mock historical data for the last 7 days
  const data = [
    { day: 'Mon', score: 78 },
    { day: 'Tue', score: 82 },
    { day: 'Wed', score: 80 },
    { day: 'Thu', score: 85 },
    { day: 'Fri', score: 83 },
    { day: 'Sat', score: 88 },
    { day: 'Sun', score: currentScore || 85 },
  ];

  const maxScore = 100;
  const height = 120;
  const width = 600;
  const padding = 20;

  const points = data
    .map((d, i) => {
      const x = (i * (width - padding * 2)) / (data.length - 1) + padding;
      const y = height - (d.score / maxScore) * height + padding;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <Card variant="glass" padding="lg" className="border-border bg-background/40">
      <Typography
        variant="caption"
        weight="black"
        color="intel"
        uppercase
        className="tracking-[0.4em] mb-6 block"
      >
        7-Day Cognitive Stability Trend
      </Typography>

      <div className="relative h-[160px] w-full text-foreground">
        <svg
          viewBox={`0 0 ${width} ${height + padding * 2}`}
          className="w-full h-full overflow-visible"
        >
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map((tick) => {
            const y = height - (tick / maxScore) * height + padding;
            return (
              <g key={tick}>
                <line
                  x1={padding}
                  y1={y}
                  x2={width - padding}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity="0.05"
                  strokeDasharray="4 4"
                />
                <text
                  x="0"
                  y={y}
                  fill="currentColor"
                  fillOpacity="0.2"
                  fontSize="8"
                  fontFamily="monospace"
                  alignmentBaseline="middle"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {/* Area under line */}
          <path
            d={`M ${padding},${height + padding} ${points} L ${width - padding},${height + padding} Z`}
            fill="url(#gradient)"
            fillOpacity="0.1"
          />

          <defs>
            <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="var(--cyber-blue)" stopOpacity="0.5" />
              <stop offset="100%" stopColor="var(--cyber-blue)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* The line */}
          <polyline
            fill="none"
            stroke="var(--cyber-blue)"
            strokeWidth="2"
            points={points}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="drop-shadow-[0_0_8px_rgba(0,224,255,0.4)]"
          />

          {/* Data points */}
          {data.map((d, i) => {
            const x = (i * (width - padding * 2)) / (data.length - 1) + padding;
            const y = height - (d.score / maxScore) * height + padding;
            return (
              <g key={i} className="group/point">
                <circle
                  cx={x}
                  cy={y}
                  r="3"
                  fill="var(--cyber-blue)"
                  className="transition-all duration-300 group-hover/point:r-5"
                />
                <text
                  x={x}
                  y={height + padding + 15}
                  fill="currentColor"
                  fillOpacity="0.4"
                  fontSize="10"
                  fontFamily="monospace"
                  textAnchor="middle"
                  className="uppercase font-bold"
                >
                  {d.day}
                </text>
                {/* Tooltip value */}
                <text
                  x={x}
                  y={y - 8}
                  fill="var(--cyber-blue)"
                  fontSize="10"
                  fontFamily="monospace"
                  textAnchor="middle"
                  className="opacity-0 group-hover/point:opacity-100 transition-opacity font-bold"
                >
                  {d.score}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </Card>
  );
}
