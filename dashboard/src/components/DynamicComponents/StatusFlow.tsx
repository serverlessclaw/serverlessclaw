'use client';

import React from 'react';
import { CheckCircle2, Circle, Activity, AlertCircle } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import { DynamicComponent } from '../Chat/types';

interface StatusFlowProps {
  component: DynamicComponent;
  onAction?: (actionId: string, payload?: unknown) => void;
}

/**
 * A multi-step progress indicator for complex processes (e.g., deployments).
 */
export default function StatusFlow({ component, onAction }: StatusFlowProps) {
  const props = component.props as {
    title?: string;
    steps: Array<{
      id: string;
      label: string;
      status: 'pending' | 'active' | 'completed' | 'failed';
      description?: string;
    }>;
    currentStep?: string;
  };

  const title = props.title || 'Operation Flow';
  const steps = props.steps || [];

  return (
    <Card
      variant="glass"
      className="border-cyber-green/30 bg-cyber-green/[0.02] shadow-[0_0_20px_rgba(0,255,163,0.05)] overflow-hidden"
      padding="none"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-cyber-green/20 bg-cyber-green/5 flex items-center justify-between">
        <Typography variant="caption" weight="black" className="uppercase tracking-widest text-[10px] text-cyber-green">
          {String(title)}
        </Typography>
        <div className="flex items-center gap-2">
           <div className="w-1.5 h-1.5 rounded-full bg-cyber-green animate-pulse" />
        </div>
      </div>

      {/* Steps List */}
      <div className="p-4 space-y-6">
        {steps.map((step, idx) => {
          const isLast = idx === steps.length - 1;
          const isActive = step.status === 'active';
          const isCompleted = step.status === 'completed';
          const isFailed = step.status === 'failed';

          return (
            <div key={step.id} className="relative flex gap-4">
              {/* Connector Line */}
              {!isLast && (
                <div 
                  className={`absolute left-2.5 top-6 w-0.5 h-6 ${isCompleted ? 'bg-cyber-green/40' : 'bg-foreground/10'}`} 
                />
              )}

              {/* Icon */}
              <div className="relative z-10 pt-1">
                {isCompleted ? (
                  <CheckCircle2 size={20} className="text-cyber-green" />
                ) : isFailed ? (
                  <AlertCircle size={20} className="text-red-500" />
                ) : isActive ? (
                  <Activity size={20} className="text-cyber-green animate-pulse" />
                ) : (
                  <Circle size={20} className="text-foreground/20" />
                )}
              </div>

              {/* Labels */}
              <div className="flex-1 min-w-0">
                <Typography 
                  variant="mono" 
                  weight="bold" 
                  className={`text-[11px] uppercase tracking-wider ${isActive ? 'text-cyber-green' : isCompleted ? 'text-foreground/80' : 'text-muted-foreground'}`}
                >
                  {step.label}
                </Typography>
                {step.description && (
                  <Typography variant="body" className="text-[10px] text-muted-foreground italic leading-tight mt-0.5">
                    {step.description}
                  </Typography>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer Actions */}
      {component.actions && component.actions.length > 0 && (
         <div className="px-4 py-3 bg-card border-t border-cyber-green/10 flex flex-wrap gap-2">
            {component.actions.map((action) => (
              <button
                key={action.id}
                onClick={() => onAction?.(action.id, action.payload)}
                className="px-3 py-1 bg-foreground/5 hover:bg-foreground/10 border border-border rounded text-[10px] font-mono text-foreground/60 transition-colors uppercase"
              >
                {action.label}
              </button>
            ))}
         </div>
      )}
    </Card>
  );
}
