import { ITool } from '../types/index';
import { ToolExecutionContext } from '../agent/tool-executor';
import { logger } from '../logger';

export interface ToolMiddlewareResult {
  allowed: boolean;
  reason?: string;
  modifiedArgs?: Record<string, unknown>;
}

export interface IToolMiddleware {
  /**
   * Executed before tool validation.
   * Can block execution or modify arguments.
   */
  beforeExecute?: (
    tool: ITool,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ) => Promise<ToolMiddlewareResult> | ToolMiddlewareResult;
}

/**
 * Registry for tool execution middleware.
 * Allows plugins to inject custom validation logic into the tool execution flow.
 */
export class ToolMiddlewareRegistry {
  private static middlewares: IToolMiddleware[] = [];

  /**
   * Registers a new tool middleware.
   */
  static register(middleware: IToolMiddleware) {
    this.middlewares.push(middleware);
    logger.debug(
      `[ToolMiddlewareRegistry] Registered new middleware. Total: ${this.middlewares.length}`
    );
  }

  /**
   * Executes all registered middleware for a tool call.
   */
  static async execute(
    tool: ITool,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolMiddlewareResult> {
    let currentArgs = { ...args };

    for (const middleware of this.middlewares) {
      if (middleware.beforeExecute) {
        try {
          const result = await middleware.beforeExecute(tool, currentArgs, context);

          if (!result.allowed) {
            return {
              allowed: false,
              reason: result.reason || 'Blocked by tool middleware',
            };
          }

          if (result.modifiedArgs) {
            currentArgs = { ...currentArgs, ...result.modifiedArgs };
          }
        } catch (err) {
          logger.error('[ToolMiddlewareRegistry] Error in middleware beforeExecute:', err);
          // Fail closed on middleware errors for safety
          return {
            allowed: false,
            reason: `Middleware execution error: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }
    }

    return { allowed: true, modifiedArgs: currentArgs };
  }

  /**
   * Clears all middleware (useful for testing).
   */
  static clear() {
    this.middlewares = [];
  }
}
