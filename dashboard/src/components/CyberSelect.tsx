'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { THEME } from '@/lib/theme';

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
}

export default function CyberSelect({
  value,
  onChange,
  options,
  placeholder = 'Select option...',
  disabled = false,
  className = '',
  name,
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
    <div ref={containerRef} className={`relative min-w-[200px] ${className}`}>
      {/* Hidden input for form submission compatibility */}
      {name && <input type="hidden" name={name} value={value} />}

      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full flex items-center justify-between bg-black border rounded px-3 py-2 text-xs transition-all outline-none text-left
          ${disabled ? 'opacity-50 cursor-not-allowed border-white/10' : `cursor-pointer hover:bg-${THEME.COLORS.INTEL}/5 hover:shadow-[0_0_10px_rgba(0,224,255,0.1)]`}
          ${isOpen ? `border-${THEME.COLORS.PRIMARY} shadow-[0_0_15px_rgba(0,255,163,0.2)]` : `border-${THEME.COLORS.INTEL}`}
        `}
      >
        <span className={`${!selectedOption ? 'text-white/30' : 'text-white/100'} truncate font-mono`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          size={14}
          className={`text-${THEME.COLORS.INTEL} transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className={`absolute z-50 w-full mt-1 bg-black border border-${THEME.COLORS.INTEL} rounded shadow-[0_10px_30px_rgba(0,0,0,0.8),0_0_20px_rgba(0,224,255,0.1)] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200`}>
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            {options.length === 0 ? (
              <div className="px-3 py-2 text-[10px] text-white/30 italic uppercase tracking-widest">
                No options available
              </div>
            ) : (
              options.map((option) => (
                <div
                  key={option.value}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`px-3 py-2 text-xs cursor-pointer transition-colors font-mono
                    ${option.value === value ? `bg-${THEME.COLORS.INTEL}/20 text-${THEME.COLORS.INTEL} border-l-2 border-${THEME.COLORS.INTEL}` : 'text-white/70 hover:bg-white/5 hover:text-white'}
                  `}
                >
                  {option.label}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
