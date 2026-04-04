import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import '../globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
});

import Sidebar from '@/components/Sidebar';
import { Toaster } from 'sonner';
import { TranslationsProvider } from '@/components/Providers/TranslationsProvider';
import { ConfigManager } from '@claw/core/lib/registry/config';
import { CONFIG_KEYS } from '@claw/core/lib/constants';

export const metadata: Metadata = {
  title: 'ClawCenter | Neural Hub',
  description: 'Autonomous Agent Command & Control Hub',
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Fetch the active locale from system config (server-side)
  const initialLocale = (await ConfigManager.getTypedConfig<string>(
    CONFIG_KEYS.ACTIVE_LOCALE,
    'en'
  )) as 'en' | 'cn';

  return (
    <html
      lang={initialLocale}
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body
        suppressHydrationWarning
        className="min-h-full flex bg-[#0a0a0a] text-white font-mono text-base antialiased"
      >
        <TranslationsProvider initialLocale={initialLocale}>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-4 focus:bg-cyber-green focus:text-black"
          >
            Skip to content
          </a>
          <Toaster
            position="bottom-right"
            toastOptions={{
              className: 'cyber-toast',
              classNames: {
                success: 'cyber-toast-success',
                error: 'cyber-toast-error',
                description: 'cyber-toast-description',
              },
            }}
          />
          <div className="flex h-screen w-full overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0 relative">
              <main id="main-content" className="flex-1 flex flex-col min-h-0 pt-16 lg:pt-0">
                {children}
              </main>
            </div>
          </div>
        </TranslationsProvider>
      </body>
    </html>
  );
}
