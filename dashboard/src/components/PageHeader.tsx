'use client';

import React from 'react';
import Typography from '@/components/ui/Typography';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

interface PageHeaderProps {
  titleKey: string;
  subtitleKey: string;
  children?: React.ReactNode;
  stats?: React.ReactNode;
}

/**
 * Standardized Page Header component based on /trace design.
 * Provides consistent typography, spacing, and responsive behavior.
 */
export default function PageHeader({
  titleKey,
  subtitleKey,
  children,
  stats,
  className = '',
}: PageHeaderProps & { className?: string }) {
  const { t } = useTranslations();

  return (
    <header
      className={`flex flex-col lg:flex-row lg:justify-between lg:items-start border-b border-white/5 pb-4 gap-6 ${className}`}
    >
      <div>
        <Typography variant="h2" color="white" glow uppercase>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {t(titleKey as any)}
        </Typography>
        <Typography variant="body" color="muted" className="mt-2 block">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {t(subtitleKey as any)}
        </Typography>
      </div>
      <div className="flex flex-wrap gap-4 items-end lg:justify-end">
        {stats}
        {children}
      </div>
    </header>
  );
}
