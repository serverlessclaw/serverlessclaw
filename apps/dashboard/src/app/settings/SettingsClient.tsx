'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import Typography from '@/components/ui/Typography';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

interface SettingsClientProps {
  triggerRebuild: () => Promise<void>;
}

export default function SettingsClient({ triggerRebuild }: SettingsClientProps) {
  const { t } = useTranslations();

  return (
    <Card variant="solid" padding="lg" className="border-red-900/20 bg-red-950/5 space-y-6">
      <Typography
        variant="caption"
        weight="bold"
        color="danger"
        uppercase
        className="flex items-center gap-2"
      >
        <AlertTriangle size={16} /> {t('SETTINGS_DANGER_ZONE')}
      </Typography>
      <div className="flex flex-col md:flex-row md:justify-between md:items-center bg-red-950/20 p-6 rounded border border-red-900/30 gap-4">
        <div>
          <Typography variant="caption" weight="bold" color="white" uppercase>
            {t('SETTINGS_FORCE_INFRA_REBUILD')}
          </Typography>
          <Typography variant="caption" color="white" className="mt-1 block opacity-70">
            {t('SETTINGS_FORCE_INFRA_REBUILD_DESC')}
          </Typography>
        </div>
        <form action={triggerRebuild}>
          <Button variant="danger" size="sm" type="submit" uppercase className="px-5">
            {t('SETTINGS_TRIGGER_REBUILD')}
          </Button>
        </form>
      </div>
    </Card>
  );
}
