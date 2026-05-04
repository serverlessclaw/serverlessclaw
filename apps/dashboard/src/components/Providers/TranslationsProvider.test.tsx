/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TranslationsProvider, useTranslations } from './TranslationsProvider';
import React from 'react';

// Mock fetch for the persistence call
global.fetch = vi.fn().mockResolvedValue({ ok: true });

const TestComponent = () => {
  const { t, locale } = useTranslations();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="title">{t('DASHBOARD_TITLE')}</span>
    </div>
  );
};

describe('TranslationsProvider Basic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('provides default en locale and translations', () => {
    render(
      <TranslationsProvider initialLocale="en">
        <TestComponent />
      </TranslationsProvider>
    );
    expect(screen.getByTestId('locale').textContent).toBe('en');
    expect(screen.getByTestId('title').textContent).toBe('ClawCenter');
  });

  it('returns translation key if not found in messages', () => {
    const TestMissing = () => {
      const { t } = useTranslations();
      return <span data-testid="missing">{t('NON_EXISTENT_KEY' as any)}</span>;
    };
    render(
      <TranslationsProvider>
        <TestMissing />
      </TranslationsProvider>
    );
    expect(screen.getByTestId('missing').textContent).toBe('NON_EXISTENT_KEY');
  });
});
