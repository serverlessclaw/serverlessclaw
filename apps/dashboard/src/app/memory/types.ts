export interface MemoryItem {
  userId: string;
  timestamp: number;
  createdAt?: number;
  content: string;
  metadata?: {
    priority?: number;
    category?: string;
    impact?: number;
    hitCount?: number;
    lastAccessed?: number;
    createdAt?: number;
  };
  type?: string;
}

export function getBadgeVariant(item: MemoryItem) {
  const userId = item.userId || '';
  const type = item.type || '';

  if (
    userId.startsWith('GAP') ||
    userId.startsWith('GAP#') ||
    type === 'GAP' ||
    type === 'MEMORY:STRATEGIC_GAP'
  )
    return 'danger';

  if (type === 'MEMORY:GAP_LOCK' || userId.includes('#LOCK')) return 'warning';

  if (
    userId.startsWith('LESSON') ||
    userId.startsWith('LESSON#') ||
    type === 'LESSON' ||
    type === 'MEMORY:TACTICAL_LESSON'
  )
    return 'primary';

  if (
    userId.startsWith('DISTILLED') ||
    userId.startsWith('DISTILLED#') ||
    type === 'DISTILLED' ||
    type === 'MEMORY:SYSTEM_KNOWLEDGE'
  )
    return 'intel';

  if (
    type === 'MEMORY:USER_PREFERENCE' ||
    userId.startsWith('USER#') ||
    userId.startsWith('SESSIONS#')
  )
    return 'warning';

  return 'audit';
}

export function getCategoryLabel(item: MemoryItem) {
  const userId = item.userId || '';
  const type = item.type || '';

  if (userId.startsWith('GAP') || type === 'MEMORY:STRATEGIC_GAP') return 'STRATEGIC GAP';
  if (userId.startsWith('LESSON') || type === 'MEMORY:TACTICAL_LESSON') return 'TACTICAL LESSON';
  if (userId.startsWith('DISTILLED') || type === 'MEMORY:SYSTEM_KNOWLEDGE') return 'DISTILLED FACT';
  if (userId.startsWith('SESSIONS#')) return 'CONVERSATION';
  if (type === 'MEMORY:GAP_LOCK') return 'RESOURCE LOCK';

  return (
    item.metadata?.category || type.replace('MEMORY:', '').replace(/_/g, ' ') || 'MEMORY OBJECT'
  );
}
