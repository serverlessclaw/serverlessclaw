'use client';

import React, { useState } from 'react';
import { LayoutList, Save, Play, X, RotateCcw } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { DynamicComponent } from '../Chat/types';

interface PlanEditorProps {
  component: DynamicComponent;
  onAction?: (actionId: string, payload?: Record<string, unknown>) => void;
}

/**
 * A component for reviewing and editing strategic plans before execution.
 */
export default function PlanEditor({ component, onAction }: PlanEditorProps) {
  const { props, actions } = component;

  const planId = typeof props.planId === 'string' ? props.planId : 'new-plan';
  const initialContent = props.content ? JSON.stringify(props.content, null, 2) : '';
  const [content, setContent] = useState(initialContent);
  const [isDirty, setIsDirty] = useState(false);

  const handleAction = (actionId: string, payload?: Record<string, unknown>) => {
    // Inject current editor content into the payload
    let finalPayload: Record<string, unknown> = { ...(payload || {}), planId };
    try {
        finalPayload = { ...finalPayload, content: JSON.parse(content) };
    } catch {
        finalPayload = { ...finalPayload, content: content, parseError: true };
    }
    onAction?.(actionId, finalPayload);
    if (actionId === 'save') setIsDirty(false);
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
          <LayoutList size={16} className="text-cyber-green" />
          <Typography variant="caption" weight="black" className="uppercase tracking-widest text-[10px] text-cyber-green">
            PLAN EDITOR: {planId}
          </Typography>
        </div>
        {isDirty && (
          <div className="flex items-center gap-1">
             <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
             <Typography variant="mono" className="text-[8px] uppercase text-amber-500 font-bold">Unsaved Changes</Typography>
          </div>
        )}
      </div>

      {/* Editor Area */}
      <div className="p-4 bg-black/40">
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setIsDirty(true);
          }}
          className="w-full h-[300px] bg-transparent font-mono text-[11px] text-cyber-green/90 outline-none resize-none custom-scrollbar border border-white/5 p-2 rounded focus:border-cyber-green/30 transition-colors"
          spellCheck={false}
        />
      </div>

      {/* Footer Actions */}
      <div className="p-3 bg-card border-t border-cyber-green/10 flex flex-wrap gap-2 justify-between">
         <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-[9px] font-mono opacity-60 hover:opacity-100"
              icon={<RotateCcw size={12} />}
              onClick={() => {
                setContent(initialContent);
                setIsDirty(false);
              }}
            >
              Reset
            </Button>
         </div>
         <div className="flex gap-2">
            {actions?.map((action) => {
               const isPrimary = action.type === 'primary';
               const isDanger = action.type === 'danger';
               
               return (
                 <Button
                   key={action.id}
                   variant={isPrimary ? 'primary' : isDanger ? 'danger' : 'outline'}
                   size="sm"
                   className="!py-1.5 !px-3 text-[9px] font-mono tracking-wider uppercase"
                   icon={isPrimary ? <Play size={12} /> : isDanger ? <X size={12} /> : <Save size={12} />}
                   onClick={() => handleAction(action.id, action.payload as Record<string, unknown>)}
                 >
                   {action.label}
                 </Button>
               );
            })}
            
            {!actions?.some(a => a.id === 'save') && (
               <Button
                 variant="primary"
                 size="sm"
                 className="!py-1.5 !px-3 text-[9px] font-mono tracking-wider uppercase"
                 icon={<Save size={12} />}
                 onClick={() => handleAction('save')}
               >
                 Save & Apply
               </Button>
            )}
         </div>
      </div>
    </Card>
  );
}
