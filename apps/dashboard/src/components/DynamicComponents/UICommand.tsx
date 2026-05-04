'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { DynamicComponent } from '@claw/hooks';
import { logger } from '@claw/core/lib/logger';

interface UICommandProps {
  component: DynamicComponent;
  onAction?: (actionId: string, payload?: unknown) => void;
}

/**
 * An invisible component that executes UI commands from the agent.
 * Handles auto-navigation and specific UI events.
 */
export default function UICommand({ component }: UICommandProps) {
  const router = useRouter();
  const executedRef = useRef(false);
  const props = component.props as {
    command: 'navigation' | 'action';
    path?: string;
    params?: Record<string, string>;
    mode?: 'auto' | 'hitl';
    action?: 'open_modal' | 'close_modal' | 'focus_resource' | 'toggle_sidebar';
    target?: string;
    payload?: unknown;
    timestamp?: number;
  };

  useEffect(() => {
    // Ensure command only runs once per component instance/timestamp
    if (executedRef.current) return;

    const runCommand = async () => {
      if (props.command === 'navigation' && props.mode === 'auto' && props.path) {
        logger.info(`[UICommand] Auto-navigating to ${props.path}`);
        const query = props.params ? '?' + new URLSearchParams(props.params).toString() : '';
        router.push(`${props.path}${query}`);
        executedRef.current = true;
      } else if (props.command === 'action' && props.action && props.target) {
        logger.info(`[UICommand] Triggering UI Action: ${props.action} on ${props.target}`);

        // Custom event for the dashboard to listen to
        const event = new CustomEvent('claw:ui-command', {
          detail: {
            action: props.action,
            target: props.target,
            payload: props.payload,
          },
        });
        window.dispatchEvent(event);
        executedRef.current = true;
      }
    };

    runCommand();
  }, [
    props.command,
    props.mode,
    props.path,
    props.params,
    props.action,
    props.target,
    props.payload,
    router,
  ]);

  // If it's HITL mode, we might render a small "Command Pending" indicator or nothing
  // since the ChatBubble/ChatMessageList will render the actions (buttons) anyway.
  if (props.mode === 'hitl' && props.command === 'navigation') {
    return (
      <div className="px-3 py-2 bg-cyber-green/5 border border-dashed border-cyber-green/20 rounded flex items-center justify-between">
        <span className="text-[10px] font-mono text-cyber-green/60 uppercase tracking-tighter italic">
          suggested view: {props.path}
        </span>
        <div className="flex gap-1">
          <div className="w-1 h-1 rounded-full bg-cyber-green/40" />
          <div className="w-1 h-1 rounded-full bg-cyber-green/20" />
          <div className="w-1 h-1 rounded-full bg-cyber-green/10" />
        </div>
      </div>
    );
  }

  return null;
}
