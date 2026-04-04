'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Button from '@/components/ui/Button';
import { ChevronRight } from 'lucide-react';

interface SessionPaginationProps {
  nextToken?: string;
}

export default function SessionPagination({ nextToken }: SessionPaginationProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  if (!nextToken) return null;

  const handleNext = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('next', nextToken);
    router.push(`/sessions?${params.toString()}`);
  };

  return (
    <div className="flex justify-center mt-10 pb-10">
      <Button
        variant="outline"
        onClick={handleNext}
        icon={<ChevronRight size={16} />}
        className="px-10 border-white/5 hover:border-cyber-blue/40 transition-all group"
      >
        <span className="group-hover:text-cyber-blue transition-colors uppercase tracking-widest text-[11px] font-bold">
          Load Next Sessions Page
        </span>
      </Button>
    </div>
  );
}
