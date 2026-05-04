'use client';

import React from 'react';
import { Search as SearchIcon } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

interface MemoryEmptyStateProps {
  query?: string;
}

export default function MemoryEmptyState({ query }: MemoryEmptyStateProps) {
  const { t } = useTranslations();

  return (
    <Card
      variant="solid"
      padding="lg"
      className="h-64 flex flex-col items-center justify-center opacity-20 border-dashed"
    >
      <SearchIcon size={48} className="mb-4 text-muted" />
      <Typography variant="caption" uppercase className="tracking-[0.3em]">
        {t('MEMORY_NO_RECORDS')}
      </Typography>
      {query && (
        <Typography variant="body" color="muted" className="mt-2">
          {t('MEMORY_ADJUST_SEARCH')}
        </Typography>
      )}
    </Card>
  );
}
