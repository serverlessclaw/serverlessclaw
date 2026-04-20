/**
 * Generic NDJSON stream processor for chat interactions.
 */
import { logger } from '@claw/core/lib/logger';

export interface StreamCallbacks<TFinal> {
  onChunk?: (chunk: unknown) => void;
  onFinal?: (data: TFinal) => void;
  onError?: (error: string) => void;
  onClose?: () => void;
}

/**
 * Processes a ReadableStream containing NDJSON lines.
 * 
 * @param stream - The stream to read from.
 * @param callbacks - Callbacks for different event types.
 */
export async function processNdjsonStream<TFinal = unknown>(
  stream: ReadableStream<Uint8Array>,
  callbacks: StreamCallbacks<TFinal>
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;

  try {
    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;

      if (value) {
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine === '') continue;

          try {
            const payload = JSON.parse(trimmedLine);
            
            if (payload.type === 'chunk' && callbacks.onChunk) {
              callbacks.onChunk(payload);
            } else if (payload.type === 'final' && callbacks.onFinal) {
              callbacks.onFinal(payload.data);
            } else if (payload.type === 'error' && callbacks.onError) {
              callbacks.onError(payload.error || 'Unknown stream error');
            }
          } catch (e) {
            logger.warn('[StreamReader] Failed to parse line:', trimmedLine.substring(0, 100), e);
          }
        }
      }
    }
  } catch (error) {
    if (callbacks.onError) {
      callbacks.onError(error instanceof Error ? error.message : String(error));
    } else {
      throw error;
    }
  } finally {
    if (callbacks.onClose) {
      callbacks.onClose();
    }
    reader.releaseLock();
  }
}
