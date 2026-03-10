import { Message } from './llm.js';

export enum InsightCategory {
  USER_PREFERENCE = 'user_preference',
  TACTICAL_LESSON = 'tactical_lesson',
  STRATEGIC_GAP = 'strategic_gap',
  SYSTEM_KNOWLEDGE = 'system_knowledge',
}

export interface InsightMetadata {
  category: InsightCategory;
  confidence: number;
  impact: number;
  complexity: number;
  risk: number;
  urgency: number;
  priority: number;
  expiration?: number;
}

export interface MemoryInsight {
  id: string;
  content: string;
  metadata: InsightMetadata;
  timestamp: number;
}

export interface IMemory {
  getHistory(userId: string): Promise<Message[]>;
  addMessage(userId: string, message: Message): Promise<void>;
  clearHistory(userId: string): Promise<void>;

  getDistilledMemory(userId: string): Promise<string>;
  updateDistilledMemory(userId: string, facts: string): Promise<void>;

  setGap(gapId: string, details: string, metadata?: InsightMetadata): Promise<void>;

  addLesson(userId: string, lesson: string, metadata?: InsightMetadata): Promise<void>;
  getLessons(userId: string): Promise<string[]>;

  searchInsights(
    userId: string,
    query: string,
    category?: InsightCategory
  ): Promise<MemoryInsight[]>;
}
