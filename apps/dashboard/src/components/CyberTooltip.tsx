import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle } from 'lucide-react';
import Typography from '@/components/ui/Typography';

interface CyberTooltipProps {
  children?: React.ReactNode;
  content: string | React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  width?: string;
  showIcon?: boolean;
  className?: string;
}

/**
 * Enhanced CyberTooltip with smart collision detection and portal rendering.
 * Ensures the tooltip is always visible and doesn't get clipped by containers.
 */
export default function CyberTooltip({
  children,
  content,
  position = 'top',
  width = 'w-48',
  showIcon = true,
  className = '',
}: CyberTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [isPositioned, setIsPositioned] = useState(false);
  const [activePosition, setActivePosition] = useState(position);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // Mounting flag for portal safety
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const hideTooltip = () => {
    setIsVisible(false);
    setIsPositioned(false);
    setCoords({ top: 0, left: 0 });
  };

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

      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      content: '""',
      position: 'absolute',
      width: '8px',
      height: '8px',
      background: 'rgba(0,0,0,0.85)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255,255,255,0.1)',
      transform: 'rotate(45deg)',
    };

    switch (pos) {
      case 'top':
        return { ...common, bottom: '-5px', left: 'calc(50% - 4px)', borderTop: 0, borderLeft: 0 };
      case 'bottom':
        return { ...common, top: '-5px', left: 'calc(50% - 4px)', borderBottom: 0, borderRight: 0 };
      case 'left':
        return {
          ...common,
          right: '-5px',
          top: 'calc(50% - 4px)',
          borderBottom: 0,
          borderLeft: 0,
        };
      case 'right':
        return { ...common, left: '-5px', top: 'calc(50% - 4px)', borderTop: 0, borderRight: 0 };
      default:
        return common;
    }
  };

  const tooltipElement = isVisible && (
    <div
      ref={tooltipRef}
      style={{
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        zIndex: 9999,
        pointerEvents: 'none',
        opacity: isPositioned ? 1 : 0,
        transform: isPositioned ? 'scale(1)' : 'scale(0.95)',
        transition: 'opacity 150ms ease-out, transform 150ms ease-out',
      }}
      className="hidden md:block"
    >
      <div
        data-testid="cyber-tooltip-content"
        className={`relative ${positionClasses[activePosition]} ${width}`}
      >
        <div
          className="bg-black/85 backdrop-blur-xl border border-white/10 rounded px-3 py-2 shadow-2xl overflow-hidden"
          style={{
            boxShadow: '0 10px 30px -10px rgba(0,0,0,0.5), 0 0 20px rgba(0,255,163,0.05)',
          }}
        >
          {/* Subtle accent line */}
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-cyber-green/30 to-transparent" />

          <div className="flex items-start gap-2">
            {showIcon && children && (
              <div className="mt-0.5 w-1.5 h-1.5 rounded-full bg-cyber-green/50 animate-pulse" />
            )}
            <Typography as="div" variant="body" className="text-[10px] leading-tight text-white/90">
              {content}
            </Typography>
          </div>
        </div>

        {/* CSS-based arrow */}
        <div style={getArrowStyles(activePosition) as React.CSSProperties} />
      </div>
    </div>
  );

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={hideTooltip}
        className={`inline-block ${className}`}
      >
        {children ||
          (showIcon && (
            <HelpCircle
              size={14}
              className="text-muted-foreground/50 hover:text-cyber-blue transition-colors cursor-help"
            />
          )) ||
          null}
      </div>
      {mounted && createPortal(tooltipElement, document.body)}
    </>
  );
}
