'use client';

import React, { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import ChatContent from '@/components/Chat/ChatContent';

/**
 * ChatPage — entry point for the Intelligence sector chat interface.
 *
 * Wraps {@link ChatContent} in Suspense so the Next.js shell renders
 * immediately while async hooks (URL search params, MQTT connection) initialise.
 */
export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen w-full bg-[#0a0a0a] flex items-center justify-center">
          <Loader2 className="animate-spin text-cyber-green" size={32} />
        </div>
      }
    >
      <ChatContent />
    </Suspense>
  );
}
