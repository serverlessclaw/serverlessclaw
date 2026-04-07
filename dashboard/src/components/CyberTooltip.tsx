'use client';

import React, { useState } from 'react';
import { Info } from 'lucide-react';

interface CyberTooltipProps {
  content: string | React.ReactNode;
  children?: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export default function CyberTooltip({
  content,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  children,
  position = 'top',
}: CyberTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <div
      className="relative inline-block ml-1 group"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      <Info size={12} className="text-muted-foreground hover:text-foreground/80 transition-colors cursor-help" />

      {isVisible && (
        <div
          className={`absolute z-50 w-64 p-3 bg-background/90 border border-border rounded shadow-2xl text-[10px] leading-relaxed text-foreground/90 backdrop-blur-md animate-in fade-in zoom-in duration-200 ${positionClasses[position]}`}
        >
          {content}
          <div
            className="absolute w-2 h-2 bg-background border-r border-b border-border rotate-45"
            style={{
              ...(position === 'top'
                ? {
                    bottom: '-5px',
                    left: 'calc(50% - 4px)',
                    borderRight: '1px solid hsl(var(--border))',
                    borderBottom: '1px solid hsl(var(--border))',
                    borderLeft: 'none',
                    borderTop: 'none',
                  }
                : {}),
              ...(position === 'bottom'
                ? {
                    top: '-5px',
                    left: 'calc(50% - 4px)',
                    borderLeft: '1px solid hsl(var(--border))',
                    borderTop: '1px solid hsl(var(--border))',
                    borderRight: 'none',
                    borderBottom: 'none',
                  }
                : {}),
            }}
          />
        </div>
      )}
    </div>
  );
}
