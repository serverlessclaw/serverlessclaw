import { describe, it, expect } from 'vitest';
import {
  AUTH,
  API_ROUTES,
  DYNAMO_KEYS,
  HTTP_STATUS,
  UI_STRINGS,
  ROUTES,
  TRACE_TYPES,
  TRACE_STATUS,
} from './constants';

describe('constants', () => {
  describe('AUTH', () => {
    it('has cookie configuration', () => {
      expect(AUTH.COOKIE_NAME).toBe('claw_auth_session');
      expect(AUTH.COOKIE_VALUE).toBe('authenticated');
      expect(AUTH.COOKIE_MAX_AGE).toBe(604800); // 1 week
    });

    it('has error codes', () => {
      expect(AUTH.ERROR_INVALID_CREDENTIALS).toBe('INVALID_CREDENTIALS');
      expect(AUTH.ERROR_SYSTEM_FAILURE).toBe('SYSTEM_FAILURE');
    });
  });

  describe('API_ROUTES', () => {
    it('defines expected routes', () => {
      expect(API_ROUTES.WEBHOOK).toBe('/webhook');
      expect(API_ROUTES.HEALTH).toBe('/health');
      expect(API_ROUTES.AGENTS).toBe('/api/agents');
      expect(API_ROUTES.CHAT).toBe('/api/chat');
    });
  });

  describe('HTTP_STATUS', () => {
    it('has correct status codes', () => {
      expect(HTTP_STATUS.OK).toBe(200);
      expect(HTTP_STATUS.BAD_REQUEST).toBe(400);
      expect(HTTP_STATUS.UNAUTHORIZED).toBe(401);
      expect(HTTP_STATUS.FORBIDDEN).toBe(403);
      expect(HTTP_STATUS.NOT_FOUND).toBe(404);
      expect(HTTP_STATUS.INTERNAL_SERVER_ERROR).toBe(500);
    });
  });

  describe('DYNAMO_KEYS', () => {
    it('has expected keys', () => {
      expect(DYNAMO_KEYS.DEPLOY_LIMIT).toBe('deploy_limit');
      expect(DYNAMO_KEYS.AGENTS_CONFIG).toBe('agents_config');
    });
  });

  describe('UI_STRINGS', () => {
    it('has dashboard title', () => {
      expect(UI_STRINGS.DASHBOARD_TITLE).toBe('ClawCenter');
    });

    it('has navigation labels', () => {
      expect(UI_STRINGS.CHAT_DIRECT).toBe('Direct Chat');
      expect(UI_STRINGS.TRACE_INTEL).toBe('Traces');
      expect(UI_STRINGS.AGENTS).toBe('Agents');
      expect(UI_STRINGS.MEMORY_RESERVE).toBe('Memory');
    });
  });

  describe('ROUTES', () => {
    it('has all navigation routes', () => {
      expect(ROUTES.HOME).toBe('/');
      expect(ROUTES.CHAT).toBe('/');
      expect(ROUTES.TRACE).toBe('/trace');
      expect(ROUTES.AGENTS).toBe('/agents');
      expect(ROUTES.SETTINGS).toBe('/settings');
    });
  });

  describe('TRACE_TYPES', () => {
    it('has LLM and tool types', () => {
      expect(TRACE_TYPES.LLM_CALL).toBe('llm_call');
      expect(TRACE_TYPES.TOOL_CALL).toBe('tool_call');
      expect(TRACE_TYPES.ERROR).toBe('error');
    });

    it('has agent communication types', () => {
      expect(TRACE_TYPES.CLARIFICATION_REQUEST).toBe('clarification_request');
      expect(TRACE_TYPES.PARALLEL_DISPATCH).toBe('parallel_dispatch');
      expect(TRACE_TYPES.CONTINUATION).toBe('continuation');
    });
  });

  describe('TRACE_STATUS', () => {
    it('has completed status', () => {
      expect(TRACE_STATUS.COMPLETED).toBe('completed');
    });
  });
});
