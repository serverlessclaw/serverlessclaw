'use client';

import React from 'react';
import { useExtensions, LayoutSlot } from '../Providers/ExtensionProvider';

interface SlotProps {
  name: LayoutSlot;
  fallback?: React.ReactNode;
}

/**
 * Slot component renders all registered layout extensions for a given name.
 */
export function Slot({ name, fallback }: SlotProps) {
  const { layoutExtensions } = useExtensions();
  const extensions = layoutExtensions.get(name) || [];

  if (extensions.length === 0) {
    return <>{fallback}</>;
  }

  return (
    <>
      {extensions.map((ext) => (
        <ext.component key={ext.id} />
      ))}
    </>
  );
}
