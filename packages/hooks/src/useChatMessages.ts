import { useState, useCallback, useEffect, useRef } from 'react';
import { logger } from '@claw/core/lib/logger';
import { AGENT_ERRORS } from '@claw/core/lib/constants';
import {
  ChatMessage,
  AttachmentPreview,
  IncomingChunk,
  PageContextData,
  DynamicComponent,
} from './types';
import { mergeHistoryWithMessages } from './message-handler';

interface ChatApiResponse {
  reply?: string;
  thought?: string;
  messageId?: string;
  agentName?: string;
  tool_calls?: any[];
  error?: string;
  details?: string;
  model?: string;
  usage?: any;
}

export interface UseChatMessagesOptions {
  activeSessionId: string;
  setActiveSessionId: (id: string) => void;
  setIsLoading: (loading: boolean) => void;
  isPostInFlight: React.MutableRefObject<boolean>;
  seenMessageIds: React.MutableRefObject<Set<string>>;
  fetchSessions: () => void;
  skipNextHistoryFetch: React.MutableRefObject<boolean>;
  activeSessionRef: React.MutableRefObject<string>;
  workspaceId?: string | null;
  disabled?: boolean;
  apiBaseUrl?: string;
}

/**
 * Headless hook for managing chat messages and history.
 */
export function useChatMessages({
  activeSessionId,
  setActiveSessionId,
  setIsLoading,
  isPostInFlight,
  seenMessageIds,
  fetchSessions,
  skipNextHistoryFetch,
  activeSessionRef,
  workspaceId = null,
  disabled = false,
  apiBaseUrl = '',
}: UseChatMessagesOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([]);

  const fetchHistory = useCallback(
    async (sessionId: string) => {
      if (!sessionId) return;
      setIsLoading(true);
      try {
        const url = new URL(`${apiBaseUrl}/api/chat`, window.location.origin);
        url.searchParams.set('sessionId', sessionId);
        if (workspaceId) url.searchParams.set('workspaceId', workspaceId);

        const response = await fetch(url.toString());
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
          return;
        }
        const data = await response.json();
        if (data.history) {
          setMessages((prev: ChatMessage[]) => {
            const { messages: mergedMessages, seenIds } = mergeHistoryWithMessages(
              prev,
              data.history
            );
            seenIds.forEach((id) => seenMessageIds.current.add(id));
            return mergedMessages;
          });
        }
      } catch (error) {
        logger.error('Failed to fetch history:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [setIsLoading, seenMessageIds, workspaceId, apiBaseUrl]
  );

  useEffect(() => {
    if (disabled) return;
    if (activeSessionId) {
      if (skipNextHistoryFetch.current) {
        skipNextHistoryFetch.current = false;
        fetchHistory(activeSessionId);
        return;
      }
      setMessages([]);
      seenMessageIds.current.clear();
      fetchHistory(activeSessionId);
    } else {
      setMessages([]);
      seenMessageIds.current.clear();
    }
  }, [activeSessionId, disabled, fetchHistory, seenMessageIds, skipNextHistoryFetch]);

  const updateAssistantResponse = (
    data: ChatApiResponse & { ui_blocks?: DynamicComponent[] },
    tempId: string
  ) => {
    const targetId = data.messageId || tempId;
    seenMessageIds.current.add(targetId);
    setMessages((prev: ChatMessage[]) => {
      let existingIdx = prev.findIndex(
        (m: ChatMessage) => m.messageId === targetId && m.role === 'assistant'
      );
      if (existingIdx === -1) {
        existingIdx = prev.findIndex((m: ChatMessage) => m.role === 'assistant' && m.isThinking);
      }

      if (existingIdx !== -1) {
        const existing = prev[existingIdx];
        const updated = [...prev];
        updated[existingIdx] = {
          ...existing,
          content: data.reply || existing.content,
          thought:
            data.thought && data.thought.length > (existing.thought?.length ?? 0)
              ? data.thought
              : existing.thought || data.thought,
          tool_calls: data.tool_calls || existing.tool_calls,
          agentName: data.agentName || existing.agentName,
          ui_blocks: data.ui_blocks || existing.ui_blocks,
          isThinking: false,
          modelName: data.model || existing.modelName,
          usage: data.usage || existing.usage,
        };
        return updated;
      }
      return [
        ...prev,
        {
          role: 'assistant',
          content: data.reply || (data.tool_calls ? 'Executing tools...' : ''),
          thought: data.thought,
          messageId: targetId,
          agentName: data.agentName || 'SuperClaw',
          tool_calls: data.tool_calls,
          ui_blocks: data.ui_blocks,
          createdAt: Date.now(),
          modelName: data.model,
          usage: data.usage,
        },
      ];
    });
  };

  const sendMessage = async (
    text: string,
    options: {
      agentId?: string;
      agentIds?: string[];
      collaborationId?: string;
      pageContext?: PageContextData;
      profile?: string;
      isIsolated?: boolean;
      source?: string;
      overrideConfig?: Record<string, unknown>;
      promptOverrides?: Record<string, string>;
      force?: boolean;
    } = {}
  ) => {
    const {
      agentId,
      agentIds,
      collaborationId,
      pageContext,
      profile,
      isIsolated = false,
      source,
      overrideConfig,
      promptOverrides,
      force = false,
    } = options;

    if (!text.trim() && attachments.length === 0) return;
    if (isPostInFlight.current) return;

    const userMsg = text.trim();
    const currentAttachments = [...attachments];
    const tempId = crypto.randomUUID();
    const primaryAgentId = agentIds && agentIds.length > 0 ? agentIds[0] : agentId || 'superclaw';

    setMessages((prev: ChatMessage[]) => [
      ...prev,
      {
        role: 'user',
        content: userMsg,
        messageId: tempId,
        pageContext,
        attachments: currentAttachments.map((a) => ({
          type: a.type,
          name: a.file.name,
          mimeType: a.file.type,
          url: a.preview,
        })),
        createdAt: Date.now(),
      },
      {
        role: 'assistant',
        content: '',
        messageId: `${tempId}-${primaryAgentId}`,
        agentName: primaryAgentId,
        isThinking: true,
        createdAt: Date.now(),
      },
    ]);

    let currentSessionId = activeSessionRef.current;
    let isNewSession = false;
    if (!currentSessionId) {
      currentSessionId = `session_${Date.now()}`;
      skipNextHistoryFetch.current = true;
      activeSessionRef.current = currentSessionId;
      setActiveSessionId(currentSessionId);
      isNewSession = true;
    }

    try {
      const apiAttachments = await Promise.all(
        currentAttachments.map(async (a) => {
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
            reader.readAsDataURL(a.file);
          });
          return { type: a.type, name: a.file.name, mimeType: a.file.type, base64 };
        })
      );

      const response = await fetch(`${apiBaseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: userMsg,
          sessionId: currentSessionId,
          attachments: apiAttachments,
          traceId: tempId,
          pageContext,
          profile,
          agentId: agentId || primaryAgentId,
          agentIds,
          collaborationId,
          isIsolated,
          workspaceId: workspaceId || undefined,
          source,
          overrideConfig,
          promptOverrides,
          force,
        }),
      });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = { error: 'Unknown response format' };
        }

        if (response.status === 429) {
          if (currentSessionId === activeSessionRef.current) {
            setMessages((prev: ChatMessage[]) => [
              ...prev,
              {
                role: 'assistant',
                content: 'Session is currently busy with another request.',
                agentName: 'SystemGuard',
                isError: true,
                errorType: 'busy',
              },
            ]);
          }
          fetchSessions();
          return;
        }

        const errorContent = errorData.details || errorData.error || AGENT_ERRORS.PROCESS_FAILURE;
        if (currentSessionId === activeSessionRef.current) {
          setMessages((prev: ChatMessage[]) => [
            ...prev,
            {
              role: 'assistant',
              content: errorContent,
              agentName: 'SystemGuard',
              isError: true,
            },
          ]);
        }
        fetchSessions();
        return;
      }

      const data = await response.json();
      if (currentSessionId === activeSessionRef.current) {
        updateAssistantResponse(data, tempId);
      }
      if (isNewSession) fetchSessions();
    } catch (error) {
      logger.error('Chat error:', error);
    } finally {
      isPostInFlight.current = false;
      setIsLoading(false);
    }
  };

  const handleFiles = async (files: File[]) => {
    const newAttachments = await Promise.all(
      files.map(async (file) => {
        const type = (file.type.startsWith('image/') ? 'image' : 'file') as 'image' | 'file';
        let preview = '';
        if (type === 'image') {
          preview = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
        }
        return { file, preview, type };
      })
    );
    setAttachments((prev) => [...prev, ...newAttachments]);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  return {
    messages,
    setMessages,
    attachments,
    setAttachments,
    handleFiles,
    removeAttachment,
    fetchHistory,
    sendMessage,
    updateAssistantResponse,
  };
}
