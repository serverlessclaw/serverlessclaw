import { describe, it, expect } from 'vitest';
import { renderComponent, navigateTo, uiAction } from './ui';

interface ToolResultWithUI {
  text: string;
  ui_blocks: Array<{
    id: string;
    componentType: string;
    props: Record<string, unknown>;
    actions?: Array<{
      id: string;
      label: string;
      type: string;
      payload?: Record<string, unknown>;
    }>;
  }>;
}

describe('system/tools/ui', () => {
  describe('renderComponent', () => {
    it('should return success message with UI block', async () => {
      const result = (await renderComponent.execute({
        componentType: 'operation-card',
        props: { title: 'Test', status: 'success' },
      })) as ToolResultWithUI;

      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('ui_blocks');
      expect(result.ui_blocks).toHaveLength(1);
      expect(result.ui_blocks[0]).toMatchObject({
        componentType: 'operation-card',
        props: { title: 'Test', status: 'success' },
      });
    });

    it('should handle actions array', async () => {
      const result = (await renderComponent.execute({
        componentType: 'diff-viewer',
        props: { diff: 'some diff' },
        actions: [
          { id: 'approve', label: 'Approve', type: 'primary' },
          { id: 'reject', label: 'Reject', type: 'danger' },
        ],
      })) as ToolResultWithUI;

      expect(result.ui_blocks[0].actions).toHaveLength(2);
      expect(result.ui_blocks[0].actions?.[0]).toMatchObject({
        id: 'approve',
        label: 'Approve',
        type: 'primary',
      });
    });
  });

  describe('navigateTo', () => {
    it('should return auto navigation block', async () => {
      const result = (await navigateTo.execute({
        path: '/traces',
        mode: 'auto',
        params: { id: '123' },
      })) as ToolResultWithUI;

      expect(result.text).toContain('Initiating automatic navigation');
      expect(result.ui_blocks[0]).toMatchObject({
        componentType: 'ui-command',
        props: {
          command: 'navigation',
          path: '/traces',
          params: { id: '123' },
          mode: 'auto',
        },
      });
      expect(result.ui_blocks[0].actions).toBeUndefined();
    });

    it('should return hitl navigation block with action', async () => {
      const result = (await navigateTo.execute({
        path: '/topology',
        mode: 'hitl',
      })) as ToolResultWithUI;

      expect(result.text).toContain('Navigation button');
      expect(result.ui_blocks[0].props.mode).toBe('hitl');
      expect(result.ui_blocks[0].actions).toHaveLength(1);
      expect(result.ui_blocks[0].actions?.[0].label).toContain('TOPOLOGY');
    });
  });

  describe('uiAction', () => {
    it('should return action command block', async () => {
      const result = (await uiAction.execute({
        action: 'open_modal',
        target: 'SettingsPanel',
        payload: { tab: 'general' },
      })) as ToolResultWithUI;

      expect(result.text).toContain('triggered');
      expect(result.ui_blocks[0]).toMatchObject({
        componentType: 'ui-command',
        props: {
          command: 'action',
          action: 'open_modal',
          target: 'SettingsPanel',
          payload: { tab: 'general' },
        },
      });
    });
  });
});
