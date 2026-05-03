'use client';

import React from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import Breadcrumbs from '../Breadcrumbs';
import { Slot } from '../Slot';

export function MainLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isEmbedded = searchParams?.get('mode') === 'embedded';

  const isChatPage = pathname === '/chat' || pathname?.startsWith('/chat/');

  const noPadding = isChatPage || isEmbedded;
  const hideBreadcrumbs = isChatPage || isEmbedded;

  return (
    <main
      id="main-content"
      className={`flex-1 flex flex-col min-h-0 pt-16 lg:pt-0 transition-all duration-300 ease-in-out ${noPadding ? '' : 'p-6 lg:p-10'}`}
    >
      {!hideBreadcrumbs && <Breadcrumbs />}
      <Slot name="main_top" />
      {children}
    </main>
  );
}
