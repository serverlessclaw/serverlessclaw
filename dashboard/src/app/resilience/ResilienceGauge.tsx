'use client';

import React from 'react';

interface ResilienceGaugeProps {
  /** Value from 0-100 */
  value: number;
  /** Label displayed below the gauge */
  label: string;
  /** Subtitle (e.g., "System Health") */
  subtitle?: string;
  /** Size in pixels */
  size?: number;
}

/**
 * Pure SVG circular gauge component with cyber aesthetic.
 * No external dependencies — matches existing dashboard style.
 */
export default function ResilienceGauge({
  value,
  label,
  subtitle,
  size = 140,
}: ResilienceGaugeProps) {
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference;

  // Color based on value
  let color = '#00ffa3'; // cyber-green (>70%)
  let glowColor = 'rgba(0, 255, 163, 0.3)';
  if (value < 50) {
    color = '#ef4444'; // red
    glowColor = 'rgba(239, 68, 68, 0.3)';
  } else if (value < 70) {
    color = '#f59e0b'; // amber
    glowColor = 'rgba(245, 158, 11, 0.3)';
  }

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth={strokeWidth}
        />
        {/* Value arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{
            transition: 'stroke-dashoffset 1s ease-in-out, stroke 0.5s ease',
            filter: `drop-shadow(0 0 6px ${glowColor})`,
          }}
        />
      </svg>
      {/* Center text */}
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span
          className="text-xl font-bold font-mono"
          style={{ color }}
        >
          {Math.round(value)}%
        </span>
      </div>
      {/* Label */}
      <div className="mt-2 text-center">
        <div className="text-[10px] font-bold text-white/70 uppercase tracking-wider">{label}</div>
        {subtitle && <div className="text-[8px] text-white/30 mt-0.5">{subtitle}</div>}
      </div>
    </div>
  );
}
