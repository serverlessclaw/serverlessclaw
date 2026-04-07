'use client';

import React from 'react';
import { AlertTriangle, X, Info } from 'lucide-react';
import Typography from './ui/Typography';
import Button from './ui/Button';

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

const variantStyles = {
  danger: {
    border: 'border-red-500/30',
    bg: 'bg-red-500/10',
    text: 'text-red-500',
    shadow: 'shadow-red-500/20',
    iconBg: 'bg-red-500/10',
    iconBorder: 'border-red-500/20',
  },
  warning: {
    border: 'border-yellow-500/30',
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-500',
    shadow: 'shadow-yellow-500/20',
    iconBg: 'bg-yellow-500/10',
    iconBorder: 'border-yellow-500/20',
  },
  info: {
    border: 'border-blue-500/30',
    bg: 'bg-blue-500/10',
    text: 'text-blue-500',
    shadow: 'shadow-blue-500/20',
    iconBg: 'bg-blue-500/10',
    iconBorder: 'border-blue-500/20',
  },
};

export default function CyberConfirm({
  isOpen,
  onConfirm,
  onCancel,
  title,
  message,
  confirmText = 'Confirm Action',
  cancelText = 'Abort Operation',
  variant = 'warning',
}: CyberConfirmProps) {
  if (!isOpen) return null;

  const styles = variantStyles[variant];
  const Icon = variant === 'info' ? Info : AlertTriangle;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onCancel} />

      <div
        className={`relative w-full max-w-sm bg-background ${styles.border} border rounded-lg p-6 space-y-5 shadow-xl overflow-hidden`}
      >
        <div className="flex flex-col items-center text-center space-y-3">
          <div
            className={`w-14 h-14 rounded-full flex items-center justify-center ${styles.iconBg} ${styles.iconBorder} border`}
          >
            <Icon size={24} className={`${styles.text} animate-pulse`} />
          </div>
          <Typography variant="h3" weight="black" className="tracking-[0.15em]">
            {title}
          </Typography>
          <Typography variant="caption" color="muted" className="leading-relaxed text-[13px]">
            {message}
          </Typography>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            size="md"
            fullWidth
            onClick={onConfirm}
            className="tracking-[0.2em] font-black"
          >
            {confirmText}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            fullWidth
            onClick={onCancel}
            icon={<X size={12} />}
            className="text-white/40 border border-white/5 font-bold tracking-[0.2em]"
          >
            {cancelText}
          </Button>
        </div>
      </div>
    </div>
  );
}
