'use client';

import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { Info } from 'lucide-react';
import { createPortal } from 'react-dom';

interface CyberTooltipProps {
  content: string | React.ReactNode;
  children?: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  showIcon?: boolean;
  className?: string;
  width?: string;
}

/**
 * A premium tooltip component that uses React Portals for perfect stacking
 * and includes smart positioning to stay within the viewport.
 */
export default function CyberTooltip({
  content,
  children,
  position = 'top',
  showIcon = true,
  className = '',
  width = 'w-64',
}: CyberTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [isPositioned, setIsPositioned] = useState(false);
  const [activePosition, setActivePosition] = useState(position);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset positioning state when tooltip is hidden
  useEffect(() => {
    if (!isVisible) {
      setIsPositioned(false);
      setCoords({ top: 0, left: 0 });
    }
  }, [isVisible]);

  useLayoutEffect(() => {
    if (isVisible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const margin = 8;
      let finalPos = position;

      // Smart positioning: detect collisions with viewport edges
      const estimatedHeight = 80;
      const widthPart = width.split('-')[1];
      const widthVal = widthPart ? parseInt(widthPart) : NaN;
      const estimatedWidth = isNaN(widthVal) ? 120 : widthVal * 4;

      if (position === 'top' && rect.top < estimatedHeight) {
        finalPos = 'bottom';
      } else if (position === 'bottom' && rect.bottom + estimatedHeight > window.innerHeight) {
        finalPos = 'top';
      }

      if (position === 'left' && rect.left < estimatedWidth) {
        finalPos = 'right';
      } else if (position === 'right' && rect.right + estimatedWidth > window.innerWidth) {
        finalPos = 'left';
      }

      setActivePosition(finalPos);

      let top = 0;
      let left = 0;

      switch (finalPos) {
        case 'top':
          top = rect.top - margin;
          left = rect.left + rect.width / 2;
          break;
        case 'bottom':
          top = rect.bottom + margin;
          left = rect.left + rect.width / 2;
          break;
        case 'left':
          top = rect.top + rect.height / 2;
          left = rect.left - margin;
          break;
        case 'right':
          top = rect.top + rect.height / 2;
          left = rect.right + margin;
          break;
      }

      setCoords({ top, left });
      setIsPositioned(true);
    }
  }, [isVisible, position, width]);

  const positionClasses = {
    top: '-translate-x-1/2 -translate-y-full',
    bottom: '-translate-x-1/2 translate-y-0',
    left: '-translate-x-full -translate-y-1/2',
    right: 'translate-x-0 -translate-y-1/2',
  };

  const getArrowStyles = (pos: string) => {
    const common = {
      width: '8px',
      height: '8px',
      backgroundColor: 'var(--card-bg-elevated)', 
      borderStyle: 'solid',
      borderColor: 'var(--cyber-green-opacity-20, rgba(0, 255, 163, 0.2))', 
    };

    switch (pos) {
      case 'top':
        return {
          ...common,
          bottom: '-4px',
          left: 'calc(50% - 4px)',
          borderWidth: '0 1px 1px 0',
        };
      case 'bottom':
        return {
          ...common,
          top: '-4px',
          left: 'calc(50% - 4px)',
          borderWidth: '1px 0 0 1px',
        };
      case 'left':
        return {
          ...common,
          right: '-4px',
          top: 'calc(50% - 4px)',
          borderWidth: '1px 1px 0 0',
        };
      case 'right':
        return {
          ...common,
          left: '-4px',
          top: 'calc(50% - 4px)',
          borderWidth: '0 0 1px 1px',
        };
      default:
        return {};
    }
  };

  const tooltipContent = (
    <div
      ref={tooltipRef}
      data-testid="cyber-tooltip-content"
      className={`fixed z-[9999] ${width} p-3 bg-card-elevated border border-border rounded shadow-premium text-[10px] leading-relaxed text-foreground backdrop-blur-xl animate-in fade-in zoom-in duration-200 pointer-events-none ring-1 ring-cyber-green/5 ${positionClasses[activePosition]} ${isPositioned ? 'opacity-100' : 'opacity-0'}`}
      style={{
        top: coords.top,
        left: coords.left,
      }}
    >
      <div className="relative z-10">
        {content}
      </div>
      <div
        className="absolute rotate-45"
        style={getArrowStyles(activePosition)}
      />
      <div className="absolute top-0 right-0 w-1 h-1 bg-cyber-green/40 rounded-bl-sm" />
    </div>
  );

  return (
    <div
      ref={triggerRef}
      className={`relative inline-block group ${className}`}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
    >
      {children ? (
        children
      ) : showIcon ? (
        <Info size={12} className="text-muted-more hover:text-cyber-green transition-colors cursor-help ml-1" />
      ) : null}

      {isVisible && mounted && content && isPositioned && createPortal(tooltipContent, document.body)}
    </div>
  );
}
