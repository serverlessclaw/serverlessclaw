'use client';

import React, { useState } from 'react';
import { Info } from 'lucide-react';

interface CyberTooltipProps {
  content: string | React.ReactNode;
  children?: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export default function CyberTooltip({ content, children, position = 'top' }: CyberTooltipProps) {
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
      <Info size={12} className="text-white/40 hover:text-white/80 transition-colors cursor-help" />
      
      {isVisible && (
        <div className={`absolute z-50 w-64 p-3 bg-black/90 border border-white/20 rounded shadow-2xl text-[10px] leading-relaxed text-white/90 backdrop-blur-md animate-in fade-in zoom-in duration-200 ${positionClasses[position]}`}>
          {content}
          <div className="absolute w-2 h-2 bg-black border-r border-b border-white/20 rotate-45" style={{
            ...(position === 'top' ? { bottom: '-5px', left: 'calc(50% - 4px)', borderRight: '1px solid rgba(255,255,255,0.2)', borderBottom: '1px solid rgba(255,255,255,0.2)', borderLeft: 'none', borderTop: 'none' } : {}),
            ...(position === 'bottom' ? { top: '-5px', left: 'calc(50% - 4px)', borderLeft: '1px solid rgba(255,255,255,0.2)', borderTop: '1px solid rgba(255,255,255,0.2)', borderRight: 'none', borderBottom: 'none' } : {}),
          }} />
        </div>
      )}
    </div>
  );
}
