'use client';

import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import en from '../../../messages/en.json';
import cn from '../../../messages/cn.json';

type Messages = typeof en;
type Locale = 'en' | 'cn';

interface TranslationsContextType {
  t: (key: keyof Messages) => string;
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const TranslationsContext = createContext<TranslationsContextType | undefined>(undefined);

/**
 * TranslationsProvider manages the UI localization state and provides a translation utility.
 * It supports dynamic language switching and persists the language direction on the document element.
 */
export const TranslationsProvider: React.FC<{ 
  children: React.ReactNode;
  initialLocale?: Locale;
}> = ({ children, initialLocale = 'en' }) => {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const messages = useMemo<Messages>(() => (locale === 'cn' ? (cn as Messages) : en), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

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
