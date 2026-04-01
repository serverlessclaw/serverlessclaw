import { logger } from '../logger';

/**
 * Configuration for semantic loop detection.
 */
interface LoopDetectorConfig {
  /** Number of recent outputs to track per session. */
  windowSize: number;
  /** Similarity threshold (0-1) to consider two outputs "similar". */
  similarityThreshold: number;
  /** Number of consecutive similar outputs to trigger a loop detection. */
  consecutiveThreshold: number;
}

const DEFAULT_CONFIG: LoopDetectorConfig = {
  windowSize: 10,
  similarityThreshold: 0.9,
  consecutiveThreshold: 3,
};

/**
 * A stored output entry for loop detection.
 */
interface OutputEntry {
  /** Normalized text for comparison. */
  normalized: string;
  /** Word set for Jaccard similarity. */
  wordSet: Set<string>;
  /** Timestamp of the output. */
  timestamp: number;
}

/**
 * Result of a loop detection check.
 */
export interface LoopDetectionResult {
  /** Whether a semantic loop was detected. */
  isLoop: boolean;
  /** Number of consecutive similar outputs. */
  consecutiveCount: number;
  /** Similarity score of the most recent comparison. */
  similarity: number;
  /** Recommended action. */
  action: 'continue' | 'escalate' | 'switch_agent';
}

/**
 * Detects semantic loops in agent outputs by tracking output similarity
 * over a sliding window. Prevents agents from repeating the same content
 * across multiple turns, which indicates stuck reasoning.
 *
 * Uses Jaccard similarity on word sets for lightweight, embedding-free detection.
 *
 * @since Phase C1
 */
export class SemanticLoopDetector {
  private sessions: Map<string, OutputEntry[]> = new Map();
  private config: LoopDetectorConfig;

  constructor(config: Partial<LoopDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Normalizes text for comparison: lowercase, strip whitespace, remove common
   * formatting artifacts.
   */
  private normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/\*\*[^*]*\*\*/g, '') // Remove bold
      .replace(/`[^`]*`/g, '') // Remove inline code
      .replace(/\[[^\]]*\]\([^)]*\)/g, '') // Remove links
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Creates a word set from normalized text for Jaccard similarity.
   */
  private toWordSet(text: string): Set<string> {
    const words = text.split(/\s+/).filter((w) => w.length > 2); // Skip short words
    return new Set(words);
  }

  /**
   * Computes Jaccard similarity between two word sets.
   * Jaccard = |A ∩ B| / |A ∪ B|
   */
  private jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    if (a.size === 0 || b.size === 0) return 0;

    let intersection = 0;
    for (const word of a) {
      if (b.has(word)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return intersection / union;
  }

  /**
   * Checks an agent output for semantic loops.
   * Call this after each agent output to detect repetitive behavior.
   *
   * @param sessionId - The session to track outputs for.
   * @param output - The agent output text.
   * @returns Detection result with recommended action.
   */
  check(sessionId: string, output: string): LoopDetectionResult {
    const normalized = this.normalize(output);
    const wordSet = this.toWordSet(normalized);
    const now = Date.now();

    // Get or create session history
    let history = this.sessions.get(sessionId);
    if (!history) {
      history = [];
      this.sessions.set(sessionId, history);
    }

    // If output is too short, skip detection (likely a greeting or simple ack)
    if (normalized.length < 20) {
      history.push({ normalized, wordSet, timestamp: now });
      return { isLoop: false, consecutiveCount: 0, similarity: 0, action: 'continue' };
    }

    // Compare with most recent entry
    let similarity = 0;
    if (history.length > 0) {
      const lastEntry = history[history.length - 1];
      similarity = this.jaccardSimilarity(wordSet, lastEntry.wordSet);
    }

    // Add to history
    history.push({ normalized, wordSet, timestamp: now });

    // Trim history to window size
    while (history.length > this.config.windowSize) {
      history.shift();
    }

    // Count consecutive similar outputs from the end
    let consecutiveCount = 0;
    for (let i = history.length - 1; i > 0; i--) {
      const current = history[i];
      const previous = history[i - 1];
      const sim = this.jaccardSimilarity(current.wordSet, previous.wordSet);
      if (sim >= this.config.similarityThreshold) {
        consecutiveCount++;
      } else {
        break;
      }
    }

    const isLoop = consecutiveCount >= this.config.consecutiveThreshold;

    if (isLoop) {
      logger.warn(
        `[SemanticLoopDetector] Loop detected in session ${sessionId}: ` +
          `${consecutiveCount} consecutive similar outputs (similarity: ${similarity.toFixed(3)})`
      );
    }

    let action: LoopDetectionResult['action'] = 'continue';
    if (isLoop) {
      action =
        consecutiveCount >= this.config.consecutiveThreshold + 2 ? 'escalate' : 'switch_agent';
    }

    return { isLoop, consecutiveCount, similarity, action };
  }

  /**
   * Clears the history for a specific session.
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Clears all session histories (useful for testing).
   */
  clearAll(): void {
    this.sessions.clear();
  }

  /**
   * Returns the number of tracked sessions.
   */
  get sessionCount(): number {
    return this.sessions.size;
  }
}

/** Singleton instance for global use. */
let _instance: SemanticLoopDetector | null = null;

/**
 * Gets the global SemanticLoopDetector instance.
 */
export function getSemanticLoopDetector(): SemanticLoopDetector {
  if (!_instance) {
    _instance = new SemanticLoopDetector();
  }
  return _instance;
}

/**
 * Resets the singleton instance (for testing).
 */
export function resetSemanticLoopDetector(): void {
  _instance = null;
}
