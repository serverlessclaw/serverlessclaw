import { describe, it, expect } from 'vitest';
import {
  getSyntheticUserId,
  parseSyntheticUserId,
  CollaborationRole,
  ParticipantType,
} from './collaboration';

describe('lib/types/collaboration', () => {
  describe('getSyntheticUserId', () => {
    it('should generate correct synthetic user ID', () => {
      const result = getSyntheticUserId('abc123');
      expect(result).toBe('shared#collab#abc123');
    });

    it('should handle different collaboration IDs', () => {
      expect(getSyntheticUserId('test-456')).toBe('shared#collab#test-456');
      expect(getSyntheticUserId('collab-789')).toBe('shared#collab#collab-789');
    });
  });

  describe('parseSyntheticUserId', () => {
    it('should extract collaboration ID from synthetic user ID', () => {
      expect(parseSyntheticUserId('shared#collab#abc123')).toBe('abc123');
      expect(parseSyntheticUserId('shared#collab#test-456')).toBe('test-456');
    });

    it('should return null for invalid synthetic user ID', () => {
      expect(parseSyntheticUserId('regular-user-id')).toBeNull();
      expect(parseSyntheticUserId('shared#other#123')).toBeNull();
      expect(parseSyntheticUserId('')).toBeNull();
    });
  });

  describe('type definitions', () => {
    it('should allow valid CollaborationRole values', () => {
      const roles: CollaborationRole[] = ['owner', 'editor', 'viewer'];
      expect(roles).toContain('owner');
      expect(roles).toContain('editor');
      expect(roles).toContain('viewer');
    });

    it('should allow valid ParticipantType values', () => {
      const types: ParticipantType[] = ['agent', 'human'];
      expect(types).toContain('agent');
      expect(types).toContain('human');
    });
  });
});
