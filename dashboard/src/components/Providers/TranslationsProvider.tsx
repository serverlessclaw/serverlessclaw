'use client';

import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import en from '../../../messages/en.json';
import cn from '../../../messages/cn.json';
import { CONFIG_KEYS } from '@claw/core/lib/constants';

type Messages = typeof en;
type Locale = 'en' | 'cn';

interface TranslationsContextType {
  t: (key: keyof Messages) => string;
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const TranslationsContext = createContext<TranslationsContextType | undefined>(undefined);

const STORAGE_KEY = 'clawcenter_locale';

/**
 * TranslationsProvider manages the UI localization state and provides a translation utility.
 * It supports dynamic language switching and persists the language direction on the document element.
 * It also persists the user's preference in localStorage and synchronizes it with the backend.
 */
export const TranslationsProvider: React.FC<{
  children: React.ReactNode;
  initialLocale?: Locale;
}> = ({ children, initialLocale = 'en' }) => {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const messages = useMemo<Messages>(() => (locale === 'cn' ? (cn as Messages) : en), [locale]);

  // Sync with localStorage on mount (Client-side only)
  useEffect(() => {
    const savedLocale = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (savedLocale && savedLocale !== locale && (savedLocale === 'en' || savedLocale === 'cn')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocaleState(savedLocale);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = async (newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem(STORAGE_KEY, newLocale);

    // Persist to backend
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: CONFIG_KEYS.ACTIVE_LOCALE,
          value: newLocale,
        }),
      });
    } catch (error) {
      console.error('Failed to persist locale to backend:', error);
    }
  };

  const t = (key: keyof Messages): string => {
    return messages[key] ?? key;
  };

  return (
    <TranslationsContext.Provider value={{ t, locale, setLocale }}>
      {children}
    </TranslationsContext.Provider>
  );
};

/**
 * Hook to access translation functions and current locale.
 */
export const useTranslations = () => {
  const context = useContext(TranslationsContext);
  if (!context) {
    throw new Error('useTranslations must be used within a TranslationsProvider');
  }
  return context;
};
