import { describe, it, expect, beforeEach } from 'vitest';
import { isDuplicate } from './dedup';
import { ChatMessage } from './types';

const assistant = (content: string, messageId?: string): ChatMessage => ({
  role: 'assistant',
  content,
  messageId,
});

const user = (content: string): ChatMessage => ({ role: 'user', content });

describe('isDuplicate', () => {
  let seenIds: Set<string>;

  beforeEach(() => {
    seenIds = new Set();
  });

  // ── ID-based dedup ──────────────────────────────────────────────────────────

  it('accepts a message with a new messageId', () => {
    const prev: ChatMessage[] = [];
    expect(isDuplicate(seenIds, prev, 'abc-123', 'Hello')).toBe(false);
  });

  it('registers a new messageId in seenIds after accepting', () => {
    isDuplicate(seenIds, [], 'abc-123', 'Hello');
    expect(seenIds.has('abc-123')).toBe(true);
  });

  it('rejects a message whose messageId was already seen', () => {
    isDuplicate(seenIds, [], 'abc-123', 'Hello');
    expect(isDuplicate(seenIds, [], 'abc-123', 'Hello')).toBe(true);
  });

  it('accepts a different messageId even if content is identical', () => {
    isDuplicate(seenIds, [assistant('Same text', 'id-1')], 'id-1', 'Same text');
    // id-1 already in seenIds — next must have a new id
    expect(isDuplicate(seenIds, [assistant('Same text', 'id-1')], 'id-2', 'Same text')).toBe(false);
  });

  it('does not add to seenIds when a duplicate is rejected', () => {
    isDuplicate(seenIds, [], 'id-1', 'text');
    const sizeBefore = seenIds.size;
    isDuplicate(seenIds, [], 'id-1', 'text'); // duplicate → rejected
    expect(seenIds.size).toBe(sizeBefore);
  });

  // ── Content-based fallback (no messageId) ──────────────────────────────────

  it('accepts a message without messageId when content is new', () => {
    const prev = [assistant('Old message')];
    expect(isDuplicate(seenIds, prev, undefined, 'New message')).toBe(false);
  });

  it('rejects a message without messageId when identical assistant content already exists', () => {
    const prev = [assistant('Duplicate text')];
    expect(isDuplicate(seenIds, prev, undefined, 'Duplicate text')).toBe(true);
  });

  it('does not treat identical user content as a duplicate', () => {
    // same wording sent by the user must not block an assistant reply
    const prev = [user('Hello')];
    expect(isDuplicate(seenIds, prev, undefined, 'Hello')).toBe(false);
  });

  it('does not add anything to seenIds for content-based checks', () => {
    isDuplicate(seenIds, [assistant('x')], undefined, 'x'); // duplicate
    isDuplicate(seenIds, [], undefined, 'y');                // new
    expect(seenIds.size).toBe(0);
  });

  // ── ID takes precedence over content ───────────────────────────────────────

  it('uses ID check even when duplicate content exists', () => {
    const prev = [assistant('Hello', 'id-1')];
    seenIds.add('id-1');
    // same content, different id → should be accepted (id wins)
    expect(isDuplicate(seenIds, prev, 'id-2', 'Hello')).toBe(false);
  });

  // ── seenIds cleared between sessions ───────────────────────────────────────

  it('accepts a previously-seen messageId after seenIds is cleared', () => {
    isDuplicate(seenIds, [], 'id-1', 'text');
    seenIds.clear(); // simulates session switch / history reload
    expect(isDuplicate(seenIds, [], 'id-1', 'text')).toBe(false);
  });
});
