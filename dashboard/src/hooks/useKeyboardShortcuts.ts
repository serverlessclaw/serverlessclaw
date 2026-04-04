'use client';

import { useEffect, useCallback, useRef } from 'react';

export interface ShortcutDefinition {
  keys: string;
  handler: () => void;
  description: string;
  preventDefault?: boolean;
}

function parseShortcut(shortcut: string): {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
} {
  const parts = shortcut
    .toLowerCase()
    .split('+')
    .map((s) => s.trim());
  return {
    metaKey: parts.includes('meta') || parts.includes('cmd'),
    ctrlKey: parts.includes('ctrl'),
    altKey: parts.includes('alt') || parts.includes('option'),
    shiftKey: parts.includes('shift'),
    key: parts[parts.length - 1],
  };
}

function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parsed = parseShortcut(shortcut);
  return (
    e.key.toLowerCase() === parsed.key &&
    e.metaKey === parsed.metaKey &&
    e.ctrlKey === parsed.ctrlKey &&
    e.altKey === parsed.altKey &&
    e.shiftKey === parsed.shiftKey
  );
}

export function useKeyboardShortcuts(shortcuts: ShortcutDefinition[], enabled = true) {
  const shortcutsRef = useRef(shortcuts);

  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      for (const shortcut of shortcutsRef.current) {
        if (matchesShortcut(e, shortcut.keys)) {
          if (isInput && !shortcut.keys.toLowerCase().includes('enter')) {
            continue;
          }
          if (shortcut.preventDefault !== false) {
            e.preventDefault();
          }
          shortcut.handler();
          break;
        }
      }
    },
    [enabled]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

export const SHORTCUT_DESCRIPTIONS: Record<string, string> = {
  'meta+k': 'Focus search',
  'ctrl+k': 'Focus search',
  'meta+alt+n': 'New chat',
  'ctrl+alt+n': 'New chat',
  'meta+/': 'Focus chat input',
  'ctrl+/': 'Focus chat input',
  'meta+enter': 'Send message',
  'ctrl+enter': 'Send message',
  escape: 'Close modal / Cancel',
  'meta+e': 'Edit session title',
  'ctrl+e': 'Edit session title',
  'meta+d': 'Delete current session',
  'ctrl+d': 'Delete current session',
  'meta+t': 'Toggle thinking visibility',
  'ctrl+t': 'Toggle thinking visibility',
  'meta+shift+s': 'Export session as JSON',
  'ctrl+shift+s': 'Export session as JSON',
  '?': 'Show keyboard shortcuts help',
};
