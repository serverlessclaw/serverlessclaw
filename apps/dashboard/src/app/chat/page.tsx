'use client';

import React, { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import ChatContent from '@/components/Chat/ChatContent';

/**
 * ChatPage — entry point for the Intelligence sector chat interface.
 * Now located at /chat to make room for the Mission Dashboard on Home.
 */
export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen w-full bg-background flex items-center justify-center">
          <Loader2 className="animate-spin text-cyber-green" size={32} />
        </div>
      }
    >
      <ChatContent />
    </Suspense>
  );
}
