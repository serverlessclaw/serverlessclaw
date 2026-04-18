import { useState } from 'react';
import {
  ChatMessage,
  AttachmentPreview,
  ToolCall,
  DynamicComponent,
  PageContextData,
} from './types';
import { AGENT_ERRORS } from '@/lib/constants';
import {
  mergeHistoryWithMessages,
} from './message-handler';

interface ChatApiResponse {
  reply?: string;
  thought?: string;
  messageId?: string;
  agentName?: string;
  tool_calls?: ToolCall[];
  error?: string;
  details?: string;
}

export function useChatMessages(
  activeSessionId: string,
  setActiveSessionId: (id: string) => void,
  setIsLoading: (loading: boolean) => void,
  isPostInFlight: React.MutableRefObject<boolean>,
  seenMessageIds: React.MutableRefObject<Set<string>>,
  fetchSessions: () => void,
  skipNextHistoryFetch: React.MutableRefObject<boolean>,
  activeSessionRef: React.MutableRefObject<string>
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([]);

  const fetchHistory = async (sessionId: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/chat?sessionId=${sessionId}`);
      const data = await response.json();
      if (data.history) {
        setMessages((prev: ChatMessage[]) => {
          const { messages: mergedMessages, seenIds } = mergeHistoryWithMessages(prev, data.history);
          
          // Sync the shared ref
          seenIds.forEach(id => seenMessageIds.current.add(id));
          
          return mergedMessages;
        });
      }
    } catch (error) {
      console.error('Failed to fetch history:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const updateAssistantResponse = (data: ChatApiResponse & { ui_blocks?: DynamicComponent[] }, tempId: string) => {
    const targetId = data.messageId || tempId;
    seenMessageIds.current.add(targetId);
    setMessages((prev: ChatMessage[]) => {
      const existingIdx = prev.findIndex(
        (m: ChatMessage) => m.messageId === targetId && m.role === 'assistant'
      );
      if (existingIdx !== -1) {
        const existing = prev[existingIdx];
        const hasExistingContent = existing.content && existing.content.length > 0;
        const hasExistingThought = existing.thought && existing.thought.length > 0;
        const updated = [...prev];
        updated[existingIdx] = {
          ...existing,
          content: hasExistingContent ? existing.content : data.reply || existing.content,
          thought: hasExistingThought ? existing.thought : data.thought || existing.thought,
          tool_calls: data.tool_calls || existing.tool_calls,
          agentName: data.agentName || existing.agentName,
          ui_blocks: data.ui_blocks || existing.ui_blocks,
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
        },
      ];
    });
  };

  const handleConnectionError = async (sessionId: string, error: unknown) => {
    console.error('Chat connection error:', error);
    const errorMsg = AGENT_ERRORS.CONNECTION_FAILURE;
    if (sessionId === activeSessionRef.current) {
      const errorId = `error_${Date.now()}`;
      seenMessageIds.current.add(errorId);
      setMessages((prev: ChatMessage[]) => [
        ...prev,
        {
          role: 'assistant',
          content: errorMsg,
          agentName: 'SystemGuard',
          messageId: errorId,
          isError: true,
        },
      ]);
    }
    try {
      await fetch('/api/memory/gap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          details: `Chat failure in session ${sessionId}. Error: ${error instanceof Error ? error.message : String(error)}`,
          metadata: { category: 'strategic_gap', urgency: 7, impact: 5 },
        }),
      });
    } catch (e) {
      console.error('Failed to report strategic gap:', e);
    }
  };

  const sendMessage = async (text: string, pageContext?: PageContextData) => {
    if (!text.trim() && attachments.length === 0) return;
    if (isPostInFlight.current) return;

    const userMsg = text.trim();
    const currentAttachments = [...attachments];
    const tempId = crypto.randomUUID();

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
      },
    ]);

    setIsLoading(true);
    setAttachments([]);
    isPostInFlight.current = true;

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

      const response = await fetch('/api/chat?stream=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: userMsg,
          sessionId: currentSessionId,
          attachments: apiAttachments,
          traceId: tempId,
          pageContext,
        }),
      });

      const data = (await response.json()) as ChatApiResponse & { ui_blocks?: DynamicComponent[] };

      if (!response.ok || data.error) {
        const errorContent = data.details || data.error || AGENT_ERRORS.PROCESS_FAILURE;
        console.error('Chat API error:', data);
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

      if (currentSessionId === activeSessionRef.current) {
        updateAssistantResponse(data, tempId);
      }
      
      // Only refresh sidebar if this was a new session creation
      if (isNewSession) {
        fetchSessions();
      }
    } catch (error) {
      handleConnectionError(currentSessionId, error);
    } finally {
      isPostInFlight.current = false;
      setIsLoading(false);
    }
  };

  /**
   * Processes approval for a specific tool call.
   */
  const handleToolApproval = async (callId: string, comment?: string) => {
    const currentSessionId = activeSessionRef.current;
    setIsLoading(true);
    isPostInFlight.current = true;

    try {
      const response = await fetch('/api/chat?stream=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: comment || 'I approve the tool execution.',
          sessionId: currentSessionId,
          approvedToolCalls: [callId],
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setMessages((prev: ChatMessage[]) => [
          ...prev,
          {
            role: 'assistant',
            content: `Error during approval: ${data.error || 'Unknown error'}`,
            agentName: 'SystemGuard',
            isError: true,
          },
        ]);
      }
      fetchSessions();
    } catch (error) {
      console.error('Approval error:', error);
    } finally {
      isPostInFlight.current = false;
      setIsLoading(false);
    }
  };

  /**
   * Processes rejection for a specific tool call.
   */
  const handleToolRejection = async (callId: string, comment?: string) => {
    const currentSessionId = activeSessionRef.current;
    setIsLoading(true);
    isPostInFlight.current = true;

    try {
      const response = await fetch('/api/chat?stream=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: comment || 'I reject this tool execution.',
          sessionId: currentSessionId,
          rejectedToolCalls: [callId],
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setMessages((prev: ChatMessage[]) => [
          ...prev,
          {
            role: 'assistant',
            content: `Error during rejection: ${data.error || 'Unknown error'}`,
            agentName: 'SystemGuard',
            isError: true,
          },
        ]);
      }
      fetchSessions();
    } catch (error) {
      console.error('Rejection error:', error);
    } finally {
      isPostInFlight.current = false;
      setIsLoading(false);
    }
  };

  /**
   * Processes clarification for a specific tool call.
   */
  const handleToolClarification = async (callId: string, comment?: string) => {
    const currentSessionId = activeSessionRef.current;
    setIsLoading(true);
    isPostInFlight.current = true;

    try {
      const response = await fetch('/api/chat?stream=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: comment || 'Requesting clarification.',
          sessionId: currentSessionId,
          clarifiedToolCalls: [callId],
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setMessages((prev: ChatMessage[]) => [
          ...prev,
          {
            role: 'assistant',
            content: `Error during clarification: ${data.error || 'Unknown error'}`,
            agentName: 'SystemGuard',
            isError: true,
          },
        ]);
      }
      fetchSessions();
    } catch (error) {
      console.error('Clarification error:', error);
    } finally {
      isPostInFlight.current = false;
      setIsLoading(false);
    }
  };

  /**
   * Processes task cancellation.
   */
  const handleTaskCancellation = async (taskId: string, comment?: string) => {
    const currentSessionId = activeSessionRef.current;
    setIsLoading(true);
    isPostInFlight.current = true;

    try {
      const response = await fetch('/api/chat?stream=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: comment || 'Stop the current task.',
          sessionId: currentSessionId,
          cancelledTasks: [taskId],
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setMessages((prev: ChatMessage[]) => [
          ...prev,
          {
            role: 'assistant',
            content: `Error during cancellation: ${data.error || 'Unknown error'}`,
            agentName: 'SystemGuard',
            isError: true,
          },
        ]);
      }
      fetchSessions();
    } catch (error) {
      console.error('Cancellation error:', error);
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
    handleConnectionError,
    handleToolApproval,
    handleToolRejection,
    handleToolClarification,
    handleTaskCancellation,
  };
}
