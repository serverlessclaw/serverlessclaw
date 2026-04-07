'use client';

import React from 'react';
import { Bot } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { DynamicComponent } from '../Chat/types';

interface OperationCardProps {
  component: DynamicComponent;
  onAction?: (actionId: string, payload?: any) => void;
}

/**
 * A generic operational card that can display structured info and action buttons.
 */
export default function OperationCard({ component, onAction }: OperationCardProps) {
  const { props, actions } = component;

  const title = typeof props.title === 'string' ? props.title : 'Agent Operation';
  const status = typeof props.status === 'string' ? props.status : undefined;
  const description = typeof props.description === 'string' ? props.description : undefined;
  const details = props.details && typeof props.details === 'object' ? (props.details as Record<string, unknown>) : undefined;

  return (
    <Card
      variant="glass"
      className="border-cyber-green/30 bg-cyber-green/[0.02] shadow-[0_0_20px_rgba(0,255,163,0.05)] overflow-hidden"
      padding="none"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-cyber-green/20 bg-cyber-green/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-cyber-green" />
          <Typography variant="caption" weight="black" className="uppercase tracking-widest text-[10px]">
            {title}
          </Typography>
        </div>
        {status && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/40 border border-cyber-green/20">
            <div className={`w-1.5 h-1.5 rounded-full ${status === 'active' ? 'bg-cyber-green animate-pulse' : 'bg-white/40'}`} />
            <Typography variant="mono" className="text-[9px] uppercase font-bold text-cyber-green/80">
              {status}
            </Typography>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {description && (
          <Typography variant="body" className="text-xs text-white/80 leading-relaxed">
            {description}
          </Typography>
        )}

        {details && (
          <div className="space-y-2">
            {Object.entries(details).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between py-1 border-b border-white/5">
                <Typography variant="mono" className="text-[10px] text-white/40 uppercase">
                  {key.replace(/_/g, ' ')}
                </Typography>
                <Typography variant="mono" className="text-[10px] text-cyber-green/90 font-bold">
                  {String(value)}
                </Typography>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      {actions && actions.length > 0 && (
        <div className="p-3 bg-black/40 border-t border-cyber-green/10 flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action.id}
              variant={action.type === 'primary' ? 'primary' : action.type === 'danger' ? 'danger' : 'outline'}
              size="sm"
              className="!py-1.5 !px-3 text-[10px] font-mono tracking-wider uppercase border-cyber-green/20"
              onClick={() => onAction?.(action.id, action.payload)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}
