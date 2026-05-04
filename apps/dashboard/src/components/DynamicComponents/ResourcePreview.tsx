'use client';

import React from 'react';
import { Database, Cloud, FileCode, ExternalLink, Zap } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import { DynamicComponent } from '@claw/hooks';

interface ResourcePreviewProps {
  component: DynamicComponent;
  onAction?: (actionId: string, payload?: unknown) => void;
}

/**
 * A preview card for AWS resources (Lambda, DynamoDB, S3 bucket).
 */
export default function ResourcePreview({ component, onAction }: ResourcePreviewProps) {
  const props = component.props as {
    resourceType: 'lambda' | 'dynamodb' | 's3' | 'eventbridge' | string;
    resourceId: string;
    description?: string;
    status?: string;
    metrics?: Record<string, string | number>;
    tags?: Record<string, string>;
  };

  const getIcon = () => {
    switch (props.resourceType.toLowerCase()) {
      case 'lambda':
        return <Zap size={18} className="text-cyber-green" />;
      case 'dynamodb':
        return <Database size={18} className="text-cyber-green" />;
      case 's3':
        return <Cloud size={18} className="text-cyber-green" />;
      default:
        return <FileCode size={18} className="text-cyber-green" />;
    }
  };

  return (
    <Card
      variant="glass"
      className="border-cyber-green/30 bg-cyber-green/[0.02] shadow-[0_0_20px_rgba(0,255,163,0.05)] overflow-hidden"
      padding="none"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-cyber-green/20 bg-cyber-green/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {getIcon()}
          <Typography
            variant="caption"
            weight="black"
            className="uppercase tracking-widest text-[10px] text-cyber-green"
          >
            {props.resourceType.toUpperCase()}
          </Typography>
        </div>
        <div className="flex items-center gap-2">
          <Typography
            variant="mono"
            className="text-[9px] uppercase font-bold text-muted-foreground"
          >
            {props.status || 'READY'}
          </Typography>
        </div>
      </div>

      {/* Main Info */}
      <div className="p-4 space-y-4">
        <div className="space-y-1">
          <Typography
            variant="mono"
            weight="bold"
            className="text-xs text-foreground truncate max-w-full"
          >
            {props.resourceId}
          </Typography>
          {props.description && (
            <Typography
              variant="body"
              className="text-[10px] text-foreground/60 italic leading-tight"
            >
              {props.description}
            </Typography>
          )}
        </div>

        {/* Metrics Grid */}
        {props.metrics && Object.keys(props.metrics).length > 0 && (
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">
            {Object.entries(props.metrics).map(([key, value]) => (
              <div key={key} className="flex flex-col gap-0.5">
                <Typography
                  variant="mono"
                  className="text-[9px] uppercase text-muted-foreground/50 tracking-wider"
                >
                  {key}
                </Typography>
                <Typography variant="mono" weight="bold" className="text-[11px] text-cyber-green">
                  {String(value)}
                </Typography>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="px-4 py-3 bg-card border-t border-cyber-green/10 flex items-center justify-between">
        <div className="flex gap-2">
          {component.actions?.map((action) => (
            <button
              key={action.id}
              onClick={() => onAction?.(action.id, action.payload)}
              className="px-3 py-1 bg-foreground/5 hover:bg-cyber-green/20 border border-border rounded text-[9px] font-mono text-foreground/60 transition-colors uppercase"
            >
              {action.label}
            </button>
          )) || (
            <button className="px-3 py-1 bg-foreground/5 hover:bg-foreground/10 border border-border rounded text-[9px] font-mono text-muted-foreground transition-colors uppercase flex items-center gap-1.5 cursor-not-allowed">
              View Console <ExternalLink size={10} />
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
