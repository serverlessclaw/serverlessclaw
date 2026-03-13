'use client';

import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface CyberConfirmProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}

export default function CyberConfirm({
  isOpen,
  onConfirm,
  onCancel,
  title,
  message,
  confirmText = 'CONFIRM_ACTION',
  cancelText = 'ABORT_OPERATION',
  variant = 'warning'
}: CyberConfirmProps) {
  if (!isOpen) return null;

  const colors = {
    danger: 'red',
    warning: 'yellow',
    info: 'blue'
  };

  const color = colors[variant];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onCancel} />
      
      <div className={`relative w-full max-w-md bg-[#050505] border-2 border-${color}-500/30 shadow-[0_0_50px_rgba(0,0,0,0.5)] rounded-sm p-8 space-y-6 overflow-hidden`}>
        {/* Cyber background decoration */}
        <div className={`absolute top-0 right-0 p-2 opacity-5 pointer-events-none`}>
           <AlertTriangle size={120} className={`text-${color}-500`} />
        </div>

        <div className="flex flex-col items-center text-center space-y-4 relative">
          <div className={`w-16 h-16 bg-${color}-500/10 rounded-full flex items-center justify-center text-${color}-500 shadow-[0_0_20px_rgba(0,0,0,0.2)] border border-${color}-500/20`}>
            <AlertTriangle size={32} className="animate-pulse" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-black uppercase tracking-[0.2em] text-white italic">{title}</h3>
            <p className="text-xs text-white/60 leading-relaxed font-mono uppercase tracking-widest">
              {message}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 relative">
          <button
            onClick={() => {
              onConfirm();
            }}
            className={`w-full bg-${color}-600 hover:bg-${color}-500 text-white font-black py-4 rounded-sm text-[10px] uppercase tracking-[0.3em] transition-all shadow-[0_0_20px_rgba(0,0,0,0.3)] hover:scale-[1.02] border border-${color}-400/50`}
          >
            {confirmText}
          </button>
          <button
            onClick={onCancel}
            className="w-full bg-white/5 hover:bg-white/10 text-white/40 font-bold py-3 rounded-sm text-[10px] uppercase tracking-[0.3em] transition-all border border-white/5 flex items-center justify-center gap-2"
          >
            <X size={12} /> {cancelText}
          </button>
        </div>
      </div>
    </div>
  );
}
