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
      {/* Container for SVG and centered overlay text */}
      <div
        className="relative flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} className="transform -rotate-90 block">
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

        {/* Center text overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="flex items-baseline">
            <span className="text-2xl font-bold font-mono tracking-tighter" style={{ color }}>
              {Math.round(value)}
            </span>
            <span className="text-[10px] font-bold ml-0.5 opacity-50 font-mono" style={{ color }}>
              %
            </span>
          </div>
        </div>
      </div>

      {/* Label and Subtitle */}
      <div className="mt-4 text-center">
        <div className="text-[10px] font-bold text-white/70 uppercase tracking-[0.2em]">
          {label}
        </div>
        {subtitle && (
          <div className="text-[8px] text-white/30 mt-1 uppercase font-mono tracking-wider">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
