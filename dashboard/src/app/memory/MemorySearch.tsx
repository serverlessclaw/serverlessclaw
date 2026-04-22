'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

export default function MemorySearch() {
  const { t } = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');

  // Update URL when query changes, with a small debounce
  useEffect(() => {
    // Check if the query in state is different from the one in searchParams
    const currentQ = searchParams.get('q') || '';
    if (query === currentQ) return;

    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (query) {
        params.set('q', query);
      } else {
        params.delete('q');
      }
      // Reset pagination when searching
      params.delete('next');

      router.push(`/memory?${params.toString()}`);
    }, 400);

    return () => clearTimeout(timer);
  }, [query, router, searchParams]);

  return (
    <div className="relative w-full max-w-md">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <Search size={16} className="text-muted-foreground" />
      </div>
      <input
        type="text"
        className="block w-full pl-10 pr-10 py-2 border border-input rounded-lg bg-input text-foreground placeholder-muted-foreground focus:ring-1 focus:ring-cyber-blue focus:border-cyber-blue transition-all"
        placeholder={t('MEMORY_SEARCH_PLACEHOLDER')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query && (
        <button
          onClick={() => setQuery('')}
          className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
