'use client';

import React from 'react';
import { ShortcutsHelp } from '@/components/Chat/ShortcutsHelp';
import { useUICommand } from '@/components/Providers/UICommandProvider';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

/**
 * Container for globally available modals.
 * Listens to the UICommandProvider to determine which modal should be active.
 */
export const GlobalModals: React.FC = () => {
  const { activeModal, setActiveModal } = useUICommand();
  const { t } = useTranslations();

  return (
    <>
      <ShortcutsHelp
        isOpen={activeModal === 'shortcuts'}
        onClose={() => setActiveModal(null)}
        t={t}
      />
    </>
  );
};
