'use client';

import React from 'react';
import MemorySearch from './MemorySearch';
import PageHeader from '@/components/PageHeader';

export default function MemoryHeader() {
  return (
    <PageHeader titleKey="MEMORY_TITLE" subtitleKey="MEMORY_SUBTITLE">
      <MemorySearch />
    </PageHeader>
  );
}
