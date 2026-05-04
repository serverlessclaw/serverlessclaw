import React from 'react';
import Typography from './ui/Typography';

interface TrustGaugeProps {
  score: number;
  label: string;
  size?: number;
}

export default function TrustGauge({ score, label, size = 120 }: TrustGaugeProps) {
  const radius = size * 0.4;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const getColor = (s: number) => {
    if (s >= 90) return '#10b981'; // Success green
    if (s >= 70) return '#dba61e'; // Primary amber/gold
    if (s >= 50) return '#f59e0b'; // Warning orange
    return '#ef4444'; // Danger red
  };

  const color = getColor(score);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        {/* Background Circle */}
        <svg className="transform -rotate-90 w-full h-full">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth="8"
            fill="transparent"
            className="text-border"
          />
          {/* Progress Circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth="8"
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
            style={{ filter: `drop-shadow(0 0 4px ${color}44)` }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center flex-col">
          <Typography variant="h3" weight="bold" color="white" className="leading-none">
            {Math.round(score)}
          </Typography>
          <Typography variant="mono" color="muted" className="text-[10px] mt-1">
            TRUST
          </Typography>
        </div>
      </div>
      <Typography
        variant="caption"
        weight="bold"
        className="uppercase tracking-widest text-muted-foreground"
      >
        {label}
      </Typography>
    </div>
  );
}
