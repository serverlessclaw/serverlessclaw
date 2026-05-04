'use client';

import React from 'react';
import { FileCode, Check, X, Plus, Minus, ArrowRight } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { DynamicComponent } from '@claw/hooks';

interface CodeDiffProps {
  component: DynamicComponent;
  onAction?: (actionId: string, payload?: Record<string, unknown>) => void;
}

interface DiffLine {
  type: 'added' | 'removed' | 'context';
  content: string;
  lineNumber?: number;
}

/**
 * A specialized component to display code diffs/patches with interactive actions.
 */
export default function CodeDiff({ component, onAction }: CodeDiffProps) {
  const { props, actions } = component;

  const fileName = typeof props.fileName === 'string' ? props.fileName : 'unnamed_patch.diff';
  const language = typeof props.language === 'string' ? props.language : 'typescript';
  const description = typeof props.description === 'string' ? props.description : undefined;

  // Expecting lines as an array of objects
  const lines = (props.lines as DiffLine[]) || [];

  return (
    <Card
      variant="glass"
      className="border-cyber-green/30 bg-black/40 shadow-[0_0_30px_rgba(0,255,163,0.1)] overflow-hidden max-w-full"
      padding="none"
    >
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-cyber-green/20 bg-cyber-green/5 flex items-center justify-between">
        <div className="flex items-center gap-2 overflow-hidden">
          <FileCode size={14} className="text-cyber-green shrink-0" />
          <Typography
            variant="mono"
            weight="black"
            className="uppercase tracking-wider text-[10px] truncate"
          >
            {fileName}
          </Typography>
          <span className="px-1.5 py-0.5 rounded bg-cyber-green/10 text-[8px] font-mono text-cyber-green/60 uppercase">
            {language}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex gap-1">
            <div className="w-2 h-2 rounded-full bg-red-500/40" />
            <div className="w-2 h-2 rounded-full bg-amber-500/40" />
            <div className="w-2 h-2 rounded-full bg-green-500/40" />
          </div>
        </div>
      </div>

      {/* Description */}
      {description && (
        <div className="px-4 py-2 border-b border-white/5 bg-white/2">
          <Typography variant="body" className="text-[10px] text-foreground/60 italic">
            {description}
          </Typography>
        </div>
      )}

      {/* Diff View */}
      <div className="bg-black/60 font-mono text-[11px] overflow-x-auto custom-scrollbar max-h-[400px]">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => {
              const isAdded = line.type === 'added';
              const isRemoved = line.type === 'removed';

              return (
                <tr
                  key={idx}
                  className={`
                    ${isAdded ? 'bg-green-500/10 text-green-400/90' : ''}
                    ${isRemoved ? 'bg-red-500/10 text-red-400/90' : ''}
                    ${!isAdded && !isRemoved ? 'text-foreground/40' : ''}
                    hover:bg-white/5 transition-colors
                  `}
                >
                  <td className="w-10 px-2 py-0.5 border-r border-white/5 text-right select-none opacity-30 text-[9px]">
                    {line.lineNumber || idx + 1}
                  </td>
                  <td className="w-6 px-1 py-0.5 text-center select-none opacity-50">
                    {isAdded ? <Plus size={10} /> : isRemoved ? <Minus size={10} /> : null}
                  </td>
                  <td className="px-3 py-0.5 whitespace-pre">{line.content}</td>
                </tr>
              );
            })}
            {lines.length === 0 && (
              <tr>
                <td colSpan={3} className="p-8 text-center text-foreground/20 italic">
                  No changes to display in this patch
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Actions */}
      {actions && actions.length > 0 && (
        <div className="p-3 bg-cyber-green/5 border-t border-cyber-green/20 flex flex-wrap gap-2 justify-end">
          {actions.map((action) => (
            <Button
              key={action.id}
              variant={
                action.type === 'primary'
                  ? 'primary'
                  : action.type === 'danger'
                    ? 'danger'
                    : 'outline'
              }
              size="sm"
              className="!py-1.5 !px-3 text-[9px] font-mono tracking-wider uppercase"
              icon={
                action.type === 'primary' ? (
                  <Check size={12} />
                ) : action.type === 'danger' ? (
                  <X size={12} />
                ) : (
                  <ArrowRight size={12} />
                )
              }
              onClick={() => onAction?.(action.id, action.payload as Record<string, unknown>)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}
