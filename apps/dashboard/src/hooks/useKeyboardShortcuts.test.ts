// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls handler when shortcut matches', () => {
    const handler = vi.fn();
    const shortcuts = [{ keys: 'meta+k', handler, description: 'Test' }];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(handler).toHaveBeenCalled();
  });

  it('supports cmd alias for meta', () => {
    const handler = vi.fn();
    const shortcuts = [{ keys: 'cmd+k', handler, description: 'Test' }];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    expect(handler).toHaveBeenCalled();
  });

  it('supports option alias for alt', () => {
    const handler = vi.fn();
    const shortcuts = [{ keys: 'option+n', handler, description: 'Test' }];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    const event = new KeyboardEvent('keydown', {
      key: 'n',
      altKey: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    expect(handler).toHaveBeenCalled();
  });

  it('respects shift modifier', () => {
    const handler = vi.fn();
    const shortcuts = [{ keys: 'shift+s', handler, description: 'Test' }];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    // Without shift
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    expect(handler).not.toHaveBeenCalled();

    // With shift
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', shiftKey: true }));
    expect(handler).toHaveBeenCalled();
  });

  it('handles "?" key special case', () => {
    const handler = vi.fn();
    const shortcuts = [{ keys: '?', handler, description: 'Help' }];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    // Usually '?' requires shift, but our hook is flexible
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true }));
    expect(handler).toHaveBeenCalled();

    handler.mockClear();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: false }));
    expect(handler).toHaveBeenCalled();
  });

  it('does not trigger when disabled', () => {
    const handler = vi.fn();
    const shortcuts = [{ keys: 'meta+k', handler, description: 'Test' }];

    renderHook(() => useKeyboardShortcuts(shortcuts, false));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not trigger in inputs unless enter is part of shortcut', () => {
    const handler = vi.fn();
    const shortcuts = [{ keys: 'meta+k', handler, description: 'Test' }];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
    });
    input.dispatchEvent(event);

    expect(handler).not.toHaveBeenCalled();

    // But if it's meta+enter
    const enterHandler = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([{ keys: 'meta+enter', handler: enterHandler, description: 'Send' }])
    );

    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      metaKey: true,
      bubbles: true,
    });
    input.dispatchEvent(enterEvent);
    expect(enterHandler).toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it('prevents default by default', () => {
    const handler = vi.fn();
    const shortcuts = [{ keys: 'meta+k', handler, description: 'Test' }];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      cancelable: true,
    });
    vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('respects preventDefault: false', () => {
    const handler = vi.fn();
    const shortcuts = [{ keys: 'meta+k', handler, description: 'Test', preventDefault: false }];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      cancelable: true,
    });
    vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
