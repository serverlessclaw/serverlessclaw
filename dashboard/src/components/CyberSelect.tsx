'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { THEME } from '@/lib/theme';
import Button from './ui/Button';

interface Option {
  value: string;
  label: string;
}

interface CyberSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  name?: string;
  size?: 'sm' | 'md' | 'lg';
  compact?: boolean;
}

export default function CyberSelect({
  value,
  onChange,
  options,
  placeholder = 'Select option...',
  disabled = false,
  className = '',
  name,
  size = 'md',
  compact = false,
}: CyberSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative ${compact ? 'min-w-[120px]' : 'min-w-[200px]'} ${className}`}
    >
      {/* Hidden input for form submission compatibility */}
      {name && <input type="hidden" name={name} value={value} />}

      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full justify-between font-mono bg-background/40
          ${disabled ? 'opacity-50 cursor-not-allowed border-border' : `cursor-pointer hover:bg-${THEME.COLORS.INTEL}/5 hover:shadow-[0_0_10px_rgba(0,224,255,0.1)]`}
          ${isOpen ? `border-${THEME.COLORS.PRIMARY} shadow-[0_0_15px_rgba(0,255,163,0.2)]` : `border-${THEME.COLORS.INTEL}/30`}
        `}
        icon={
          <ChevronDown
            size={14}
            className={`text-${THEME.COLORS.INTEL} transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        }
      >
        <span className={`${!selectedOption ? 'text-muted-foreground/50' : 'text-foreground'} truncate`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
      </Button>

      {isOpen && (
        <div
          className={`absolute z-50 w-full mt-1 bg-background border border-${THEME.COLORS.INTEL}/30 rounded shadow-[0_10px_30px_rgba(0,0,0,0.8),0_0_20px_rgba(0,224,255,0.1)] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200`}
        >
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            {options.length === 0 ? (
              <div className="px-3 py-2 text-[10px] text-muted-foreground/50 italic tracking-widest">
                No options available
              </div>
            ) : (
              options.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs cursor-pointer transition-colors font-mono
                    ${option.value === value ? `bg-${THEME.COLORS.INTEL}/20 text-${THEME.COLORS.INTEL} border-l-2 border-${THEME.COLORS.INTEL}` : 'text-foreground/70 hover:bg-foreground/5 hover:text-foreground'}
                  `}
                >
                  {option.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
