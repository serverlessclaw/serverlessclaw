'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';

export default function MemorySearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');

  // Update URL when query changes, with a small debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (query) {
        params.set('q', query);
      } else {
        params.delete('q');
      }
      // Reset pagination when searching
      params.delete('next');
      
      const newUrl = `/memory?${params.toString()}`;
      if (window.location.search !== `?${params.toString()}`) {
        router.push(newUrl);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [query, router, searchParams]);

  return (
    <div className="relative w-full max-w-xl">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <Search size={16} className="text-muted" />
      </div>
      <input
        type="text"
        className="block w-full pl-10 pr-10 py-2 border border-white/10 rounded-lg bg-black/40 text-white placeholder-muted focus:ring-1 focus:ring-cyber-blue focus:border-cyber-blue transition-all"
        placeholder="Search Neural Reserve (Facts, Lessons, Gaps...)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query && (
        <button
          onClick={() => setQuery('')}
          className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted hover:text-white"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
