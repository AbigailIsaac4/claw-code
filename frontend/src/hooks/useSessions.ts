import { useState, useCallback, useRef } from 'react';
import { normalizeHydratedMessages, type HydratedMessage, type HydratedToolCall } from '@/utils/sessionHydration';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

const generateId = () => `msg-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;

type Message = HydratedMessage;
type ToolCall = HydratedToolCall;

export interface Session {
  id: string;
  title: string;
  messages: Message[];
  active?: boolean;
  updated_at?: string;
}

type SessionSummary = Pick<Session, 'id' | 'title' | 'updated_at'>;

export function useSessions(token: string | null, onAuthError?: () => void) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const loadingRef = useRef(false);
  const streamingSessionRef = useRef<string | null>(null);

  const activeSession = sessions.find(s => s.id === activeSessionId);

  const withAssistantTail = useCallback((messages: Message[]) => {
    const nextMessages = [...messages];
    if (nextMessages.at(-1)?.role !== 'assistant') {
      nextMessages.push({ id: generateId(), role: 'assistant', content: '', streaming: true });
    }
    return nextMessages;
  }, []);

  const updateSessionMessages = useCallback((sessionId: string, newMessages: Message[]) => {
    setSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        const title = (s.title === 'New Chat' && newMessages.length > 0)
            ? newMessages[0].content.substring(0, 15) + '...'
            : s.title;
        return { ...s, messages: newMessages, title };
      }
      return s;
    }));
  }, []);

  const createNewSession = useCallback(() => {
    const newSession: Session = {
      id: generateId(),
      title: 'New Chat',
      messages: []
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
  }, []);

  const deleteSession = useCallback(async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation?.();
    try {
      await fetch(apiUrl(`/v1/sessions/${id}`), {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('claw_token')}` }
      });
    } catch(err) {
      console.error(err);
    }
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (next.length === 0) {
        const fresh = { id: generateId(), title: 'New Chat', messages: [] };
        setActiveSessionId(fresh.id);
        return [fresh];
      }
      if (id === activeSessionId) {
        setActiveSessionId(next[0].id);
      }
      return next;
    });
  }, [activeSessionId]);

  const loadSessionDetail = useCallback(async (id: string, authToken: string, sessionList: SessionSummary[]) => {
    try {
      const res = await fetch(apiUrl(`/v1/sessions/${id}`), {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (res.ok) {
        const state = await res.json();
        const messages: Message[] = [];
        let currentAssistant: Message | null = null;

        for (const msg of (state.messages || [])) {
          const role = msg.role === 'user' ? 'user' : (msg.role === 'assistant' ? 'assistant' : 'tool');

          if (role === 'user') {
            if (currentAssistant) {
              messages.push(currentAssistant);
              currentAssistant = null;
            }
            let content = '';
            for (const block of msg.blocks || []) {
              if (block.type === 'text') content += block.text;
            }
            messages.push({ id: generateId(), role: 'user', content });
          } else if (role === 'assistant') {
            if (!currentAssistant) {
              currentAssistant = { id: generateId(), role: 'assistant', content: '', toolCalls: [] };
            }
            for (const block of msg.blocks || []) {
              if (block.type === 'text') {
                currentAssistant.content += block.text;
              } else if (block.type === 'tool_use') {
                currentAssistant.toolCalls!.push({
                  id: block.id || generateId(),
                  name: block.name,
                  input: typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
                  status: 'running'
                });
              }
            }
          } else if (role === 'tool') {
            for (const block of msg.blocks || []) {
              if (block.type === 'tool_result' && currentAssistant && currentAssistant.toolCalls) {
                const tc = [...currentAssistant.toolCalls].reverse().find(t => t.name === block.tool_name && t.status === 'running');
                if (tc) {
                  tc.status = block.is_error ? 'error' : 'done';
                  if (block.is_error) tc.error = block.output;
                  else tc.result = block.output;
                }
              }
            }
          }
        }

        if (currentAssistant) {
          messages.push(currentAssistant);
        }

        const isActiveTurn = Boolean(state.active_turn);
        const loadedMessages = normalizeHydratedMessages(messages, {
          activeTurn: isActiveTurn,
          generateId,
        });

        const loadedSession = {
          id,
          title: sessionList.find(s => s.id === id)?.title || 'History',
          updated_at: sessionList.find(s => s.id === id)?.updated_at,
          messages: loadedMessages,
          active: isActiveTurn,
        };

        setSessions(prev => {
          const list = prev.length > 0 ? prev : sessionList.map(s => ({ id: s.id, title: s.title, updated_at: s.updated_at, messages: [] }));
          if (!list.some(s => s.id === id)) {
            return [loadedSession, ...list];
          }
          return list.map(s => s.id === id ? loadedSession : s);
        });
        setActiveSessionId(id);
        if (streamingSessionRef.current !== id) {
          loadingRef.current = isActiveTurn;
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadSessions = useCallback(async (authToken: string) => {
    try {
      const res = await fetch(apiUrl('/v1/sessions'), {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!res.ok) {
        if (res.status === 401) onAuthError?.();
        return;
      }
      const data = await res.json();
      if (data && data.length > 0) {
        loadSessionDetail(data[0].id, authToken, data);
      } else {
        createNewSession();
      }
    } catch (e) {
      console.error(e);
    }
  }, [loadSessionDetail, createNewSession]);

  const renameSession = useCallback(async (id: string, newTitle: string, authToken: string) => {
    try {
      const res = await fetch(apiUrl(`/v1/sessions/${id}`), {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      });
      if (res.ok) {
        setSessions(prev => prev.map(s => s.id === id ? { ...s, title: newTitle } : s));
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  return {
    sessions,
    setSessions,
    activeSessionId,
    setActiveSessionId,
    activeSession,
    loadingRef,
    streamingSessionRef,
    withAssistantTail,
    updateSessionMessages,
    createNewSession,
    deleteSession,
    renameSession,
    loadSessionDetail,
    loadSessions,
  };
}
