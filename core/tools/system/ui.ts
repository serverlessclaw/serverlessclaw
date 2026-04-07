import { ITool, ToolResult } from '../../lib/types/index';
import { systemSchema as schema } from './schema';

/**
 * Tool for agents to render specialized UI components in the dashboard.
 */
export const renderComponent: ITool = {
  ...schema.renderComponent,
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // This tool is purely instructional for the frontend.
    // The executor will capture the tool call and include it in the response as ui_blocks.
    return {
      text: `UI Component '${args.componentType}' rendered successfully.`,
      images: [],
      metadata: {},
      ui_blocks: [
        {
          id: `ui_${Date.now()}`,
          componentType: String(args.componentType),
          props: (args.props as Record<string, unknown>) || {},
          actions: (args.actions as Array<Record<string, unknown>> | undefined)?.length
            ? (args.actions as Array<Record<string, unknown>>).map((a) => ({
                id: String(a.id),
                label: String(a.label),
                type: (a.type as 'primary' | 'secondary' | 'danger') || 'secondary',
                payload: a.payload as Record<string, unknown> | undefined,
              }))
            : undefined,
        },
      ],
    };
  },
};

/**
 * Tool for SuperClaw to navigate the user to different parts of the dashboard.
 */
export const navigateTo: ITool = {
  ...schema.navigateTo,
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const { path, mode, params } = args as {
      path: string;
      mode: 'auto' | 'hitl';
      params?: Record<string, unknown>;
    };

    return {
      text:
        mode === 'auto'
          ? `Initiating automatic navigation to ${path}...`
          : `Navigation button to ${path} presented to user.`,
      images: [],
      metadata: {},
      ui_blocks: [
        {
          id: `nav_${Date.now()}`,
          componentType: 'ui-command',
          props: {
            command: 'navigation',
            path,
            params,
            mode,
            timestamp: Date.now(),
          },
          // For HITL mode, we provide a primary action button
          actions:
            mode === 'hitl'
              ? [
                  {
                    id: 'confirm_nav',
                    label: `Jump to ${path.replace(/^\//, '').toUpperCase() || 'Home'}`,
                    type: 'primary',
                    payload: { path, params },
                  },
                ]
              : undefined,
        },
      ],
    };
  },
};

/**
 * Tool for agents to trigger specific UI actions.
 */
export const uiAction: ITool = {
  ...schema.uiAction,
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const { action, target, payload } = args as {
      action: string;
      target: string;
      payload?: Record<string, unknown>;
    };

    return {
      text: `UI Action '${action}' triggered for target '${target}'.`,
      images: [],
      metadata: {},
      ui_blocks: [
        {
          id: `act_${Date.now()}`,
          componentType: 'ui-command',
          props: {
            command: 'action',
            action,
            target,
            payload,
            timestamp: Date.now(),
          },
        },
      ],
    };
  },
};

/**
 * Tool for agents to render a code diff/patch in the dashboard.
 */
export const renderCodeDiff: ITool = {
  ...schema.renderCodeDiff,
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    return {
      text: `Code diff for '${args.fileName}' rendered successfully.`,
      images: [],
      metadata: {},
      ui_blocks: [
        {
          id: `diff_${Date.now()}`,
          componentType: 'code-diff',
          props: {
            fileName: args.fileName,
            language: args.language,
            description: args.description,
            lines: args.lines,
          },
          actions: (args.actions as Array<Record<string, unknown>> | undefined)?.length
            ? (args.actions as Array<Record<string, unknown>>).map((a) => ({
                id: String(a.id),
                label: String(a.label),
                type: (a.type as 'primary' | 'secondary' | 'danger') || 'secondary',
                payload: a.payload as Record<string, unknown> | undefined,
              }))
            : undefined,
        },
      ],
    };
  },
};

/**
 * Tool for agents to render a strategic plan editor.
 */
export const renderPlanEditor: ITool = {
  ...schema.renderPlanEditor,
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    return {
      text: `Plan editor for '${args.planId}' rendered successfully.`,
      images: [],
      metadata: {},
      ui_blocks: [
        {
          id: `plan_${Date.now()}`,
          componentType: 'plan-editor',
          props: {
            planId: args.planId,
            content: args.content,
          },
          actions: (args.actions as Array<Record<string, unknown>> | undefined)?.length
            ? (args.actions as Array<Record<string, unknown>>).map((a) => ({
                id: String(a.id),
                label: String(a.label),
                type: (a.type as 'primary' | 'secondary' | 'danger') || 'secondary',
                payload: a.payload as Record<string, unknown> | undefined,
              }))
            : undefined,
        },
      ],
    };
  },
};
