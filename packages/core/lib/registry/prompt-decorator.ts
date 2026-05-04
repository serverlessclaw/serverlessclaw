import { logger } from '../logger';

export interface PromptDecorationContext {
  workspaceId?: string;
  agentId: string;
  userId?: string;
  metadata?: Record<string, any>;
}

export type PromptDecorator = (
  prompt: string,
  context: PromptDecorationContext
) => string | Promise<string>;

/**
 * Registry for system prompt decorators.
 * Allows external plugins to inject context into agent instructions.
 */
export class PromptDecoratorRegistry {
  private static decorators: PromptDecorator[] = [];

  /**
   * Registers a new prompt decorator.
   */
  static register(decorator: PromptDecorator) {
    this.decorators.push(decorator);
    logger.debug(
      `[PromptDecoratorRegistry] Registered new decorator. Total: ${this.decorators.length}`
    );
  }

  /**
   * Applies all registered decorators to a prompt.
   */
  static async decorate(prompt: string, context: PromptDecorationContext): Promise<string> {
    let decoratedPrompt = prompt;

    for (const decorator of this.decorators) {
      try {
        decoratedPrompt = await decorator(decoratedPrompt, context);
      } catch (err) {
        logger.error('[PromptDecoratorRegistry] Error applying decorator:', err);
      }
    }

    return decoratedPrompt;
  }

  /**
   * Clears all decorators (useful for testing).
   */
  static clear() {
    this.decorators = [];
  }
}
