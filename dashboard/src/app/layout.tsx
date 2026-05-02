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
import ChatBubble from '@/components/Chat/ChatBubble';
import { Toaster } from 'sonner';
import { TranslationsProvider } from '@/components/Providers/TranslationsProvider';
import { PageContextProvider } from '@/components/Providers/PageContextProvider';
import { UICommandProvider } from '@/components/Providers/UICommandProvider';
import { RealtimeProvider } from '@/components/Providers/RealtimeProvider';
import { ConfigManager } from '@claw/core/lib/registry/config';
import { CONFIG_KEYS } from '@claw/core/lib/constants';

export const metadata: Metadata = {
  title: 'ClawCenter | Neural Hub',
  description: 'Autonomous Agent Command & Control Hub',
};

export const dynamic = 'force-dynamic';

import { ThemeProvider } from '@/components/Providers/ThemeProvider';
import { TenantProvider } from '@/components/Providers/TenantProvider';
import { GlobalModals } from '@/components/GlobalModals';
import CommandPalette from '@/components/CommandPalette';
import { MainLayout } from '@/components/Layout/MainLayout';

import { PresenceProvider } from '@/components/Providers/PresenceProvider';

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
        className="min-h-full flex bg-background text-foreground font-mono text-base antialiased"
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <TranslationsProvider initialLocale={initialLocale}>
            <TenantProvider>
              <RealtimeProvider>
                <PresenceProvider>
                  <UICommandProvider>
                    <PageContextProvider>
                      <GlobalModals />
                      <CommandPalette />
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
                          <MainLayout>{children}</MainLayout>
                          <ChatBubble />
                        </div>
                      </div>
                    </PageContextProvider>
                  </UICommandProvider>
                </PresenceProvider>
              </RealtimeProvider>
            </TenantProvider>
          </TranslationsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
