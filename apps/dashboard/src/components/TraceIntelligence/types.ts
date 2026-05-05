import { Trace } from '@/lib/types/ui';
import { TranslationKey } from '../Providers/TranslationsProvider';

export type TabType = 'timeline' | 'sessions' | 'models' | 'tools' | 'agents' | 'live';
export type TranslationFn = (key: TranslationKey) => string;

export interface EnrichedTrace extends Trace {
  toolsUsed: string[];
  model: string;
  totalTokens: number;
  sessionId: string;
  agentId: string;
}
