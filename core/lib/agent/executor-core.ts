import { Message, ITool, IProvider, MessageChunk, IAgentConfig } from '../types/index';
import { LIMITS } from '../constants';
import { LoopResult, ExecutorOptions } from './executor-types';
import { StandardExecutor } from './executor/standard-executor';
import { StreamingExecutor } from './executor/streaming-executor';

/**
 * Core implementation of the iterative execution loop.
 * Now delegates to specialized executor implementations to maintain modularity.
 */
export class ExecutorCore {
  private standardExecutor: StandardExecutor;
  private streamingExecutor: StreamingExecutor;

  constructor(
    provider: IProvider,
    tools: ITool[],
    agentId: string,
    agentName: string,
    systemPrompt: string = '',
    summary: string | null = null,
    contextLimit: number = LIMITS.MAX_CONTEXT_LENGTH,
    agentConfig?: IAgentConfig
  ) {
    this.standardExecutor = new StandardExecutor(
      provider,
      tools,
      agentId,
      agentName,
      systemPrompt,
      summary,
      contextLimit,
      agentConfig
    );
    this.streamingExecutor = new StreamingExecutor(
      provider,
      tools,
      agentId,
      agentName,
      systemPrompt,
      summary,
      contextLimit,
      agentConfig
    );
  }

  /**
   * Executes a standard non-streaming iteration loop.
   */
  async runLoop(messages: Message[], options: ExecutorOptions): Promise<LoopResult> {
    return this.standardExecutor.runLoop(messages, options);
  }

  /**
   * Executes a streaming iteration loop.
   */
  async *streamLoop(messages: Message[], options: ExecutorOptions): AsyncIterable<MessageChunk> {
    yield* this.streamingExecutor.streamLoop(messages, options);
  }
}
