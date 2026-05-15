import { useState, useCallback, useRef } from 'react';
import { EventStreamContentType, fetchEventSource } from '@microsoft/fetch-event-source';
import type { HydratedMessage, HydratedToolCall } from '@/utils/sessionHydration';
import { normalizeHydratedMessages } from '@/utils/sessionHydration';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

const generateId = () => `msg-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;

type Message = HydratedMessage;
type ToolCall = HydratedToolCall;

interface Session {
  id: string;
  title: string;
  messages: Message[];
  active?: boolean;
}

type SessionSummary = Pick<Session, 'id' | 'title'>;

interface ActionRequest {
  action_id: string;
  tool?: string;
  required_mode?: string;
  message?: string;
}

interface UseChatStreamProps {
  token: string | null;
  sessions: Session[];
  activeSessionId: string;
  activeSession: Session | undefined;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  setActiveSessionId: (id: string) => void;
  streamingSessionRef: React.MutableRefObject<string | null>;
  loadingRef: React.MutableRefObject<boolean>;
  setLoading: (loading: boolean) => void;
  withAssistantTail: (messages: Message[]) => Message[];
  updateSessionMessages: (sessionId: string, newMessages: Message[]) => void;
  loadSessionDetail: (id: string, authToken: string, sessionList: SessionSummary[]) => Promise<void>;
  loadWorkspaceFiles: (subPath?: string) => Promise<void>;
  workspaceSubPath: string;
  agentMode?: 'plan' | 'execute';
  onError?: (msg: string) => void;
  onActionRequired?: (req: ActionRequest) => void;
  onQuestionRequired?: (data: { question_id: string; question: string; options?: string[] }) => void;
}

export function useChatStream({
  token,
  sessions,
  activeSessionId,
  activeSession,
  setSessions,
  setActiveSessionId,
  streamingSessionRef,
  loadingRef,
  setLoading,
  withAssistantTail,
  updateSessionMessages,
  loadSessionDetail,
  loadWorkspaceFiles,
  workspaceSubPath,
  agentMode = 'execute',
  onError,
  onActionRequired,
  onQuestionRequired,
}: UseChatStreamProps) {
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [activeToolSummary, setActiveToolSummary] = useState<string | null>(null);
  const [currentIteration, setCurrentIteration] = useState<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isReceivingReasoningRef = useRef<boolean>(false);

  const stopMessage = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    loadingRef.current = false;
    streamingSessionRef.current = null;
    setActiveToolName(null);
    setActiveToolSummary(null);
  }, [setLoading, loadingRef, streamingSessionRef]);

  const setConversationLoading = useCallback((value: boolean) => {
    loadingRef.current = value;
    setLoading(value);
  }, [loadingRef, setLoading]);

  const sendMessage = useCallback(async (finalInput: string) => {
    if (!finalInput.trim() || loadingRef.current || !activeSession || !token) return;

    const sessionId = activeSessionId;
    const userMsg: Message = { id: generateId(), role: 'user', content: finalInput };

    const messagesAfterUser = normalizeHydratedMessages([...activeSession.messages, userMsg]);
    updateSessionMessages(sessionId, messagesAfterUser);

    streamingSessionRef.current = sessionId;
    setConversationLoading(true);

    const assistantMsg: Message = { id: generateId(), role: 'assistant', content: '' };
    updateSessionMessages(sessionId, [...messagesAfterUser, assistantMsg]);

    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;
    isReceivingReasoningRef.current = false;
    let streamCompleted = false;

    const isNewChat = activeSession.title === 'New Chat' && activeSession.messages.length === 0;
    const newTitle = isNewChat ? finalInput.substring(0, 15) + '...' : activeSession.title;

    try {
      await fetchEventSource(apiUrl('/v1/chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          session_id: sessionId,
          title: newTitle,
          input: userMsg.content,
          permission_mode: agentMode,
        }),
        signal: ctrl.signal,
        openWhenHidden: true,
        async onopen(response) {
          if (!response.ok) {
            throw new Error(`SSE request failed with status ${response.status}`);
          }
          const contentType = response.headers.get('content-type') || '';
          if (!contentType.startsWith(EventStreamContentType)) {
            throw new Error(`Expected SSE response, got ${contentType || 'empty content-type'}`);
          }
        },
        onmessage(ev) {
          if (ev.event === 'done' || ev.data === '[DONE]') {
            streamCompleted = true;
            streamingSessionRef.current = null;
            setConversationLoading(false);
            setActiveToolName(null);
            setActiveToolSummary(null);
            // Refresh workspace files only; streamed messages are already
            // correct in memory — reloading from API risks overwriting them.
            void loadWorkspaceFiles(workspaceSubPath || undefined);
            return;
          }
          if (ev.event === 'session_created') {
            try {
              const data = JSON.parse(ev.data);
              if (data.session_id && data.session_id !== sessionId) {
                setSessions(prev => prev.map(s =>
                  s.id === sessionId ? { ...s, id: data.session_id } : s
                ));
                setActiveSessionId(data.session_id);
                streamingSessionRef.current = data.session_id;
              }
            } catch {}
            return;
          }
          if (ev.event === 'runtime_error') {
            if (ev.data.includes('当前会话已有一轮对话正在处理中，请等待上一轮结束后再发送。')) {
              streamCompleted = true;
              streamingSessionRef.current = null;
              void loadSessionDetail(sessionId, token, sessions);
              return;
            }
            streamCompleted = true;
            streamingSessionRef.current = null;
            setConversationLoading(false);
            setActiveToolName(null);
            setActiveToolSummary(null);
            onError?.(ev.data || 'The agent run failed.');
            return;
          }
          if (ev.event === 'message' || ev.event === 'thinking_delta') {
            try {
              const data = JSON.parse(ev.data);
              const chunkText = data.choices?.[0]?.delta?.content || '';
              const reasoningText = data.choices?.[0]?.delta?.reasoning_content || '';
              
              if (!chunkText && !reasoningText) return;

              setSessions(prev => prev.map(s => {
                if (s.id === sessionId) {
                  const nextMsgs = withAssistantTail(s.messages);
                  const lastMsg = nextMsgs[nextMsgs.length - 1];
                  let newContent = lastMsg.content || '';

                  if (reasoningText) {
                    if (!isReceivingReasoningRef.current) {
                      isReceivingReasoningRef.current = true;
                      newContent += '<thinking>\n';
                    }
                    newContent += reasoningText;
                  }

                  if (chunkText) {
                    if (isReceivingReasoningRef.current) {
                      isReceivingReasoningRef.current = false;
                      newContent += '\n</thinking>\n\n';
                    }
                    newContent += chunkText;
                  }

                  nextMsgs[nextMsgs.length - 1] = {
                    ...lastMsg,
                    content: newContent
                  };
                  return { ...s, messages: nextMsgs };
                }
                return s;
              }));
            } catch(e) {
              console.warn('Failed to parse message chunk:', e);
            }
          } else if (ev.event === 'iteration_start') {
            try {
              const data = JSON.parse(ev.data);
              setCurrentIteration(data.iteration || 0);
              // Clear tool indicators at iteration boundary
              setActiveToolName(null);
              setActiveToolSummary(null);
            } catch {}
          } else if (ev.event === 'tool_call_start') {
            try {
              const data = JSON.parse(ev.data);
              setActiveToolName(data.tool);
              try {
                const parsed = typeof data.input === 'string' ? JSON.parse(data.input) : data.input;
                if (data.tool === 'Bash' && parsed.command) {
                  setActiveToolSummary(parsed.command.length > 40 ? parsed.command.substring(0, 40) + '...' : parsed.command);
                } else if (parsed.file_path) {
                  setActiveToolSummary(String(parsed.file_path).split('/').pop() || parsed.file_path);
                } else if (parsed.pattern) {
                  setActiveToolSummary(String(parsed.pattern).substring(0, 40));
                } else if (parsed.skill) {
                  setActiveToolSummary(parsed.skill);
                } else {
                  setActiveToolSummary(null);
                }
              } catch { setActiveToolSummary(null); }
              setSessions(prev => prev.map(s => {
                if (s.id === sessionId) {
                  const nextMsgs = withAssistantTail(s.messages);
                  const lastMsg = nextMsgs[nextMsgs.length - 1];
                  const inputStr = typeof data.input === 'string' ? data.input : JSON.stringify(data.input);
                  const newToolCallId = generateId();
                  const newToolCall: ToolCall = {
                    id: newToolCallId,
                    name: data.tool,
                    input: inputStr,
                    status: 'running'
                  };
                  nextMsgs[nextMsgs.length - 1] = {
                    ...lastMsg,
                    content: lastMsg.content + `\n\n[TOOL_CALL:${newToolCallId}]\n\n`,
                    toolCalls: [...(lastMsg.toolCalls || []), newToolCall]
                  };
                  return { ...s, messages: nextMsgs };
                }
                return s;
              }));
            } catch(e) {
              console.warn('Failed to parse tool_call_start:', e);
            }
          } else if (ev.event === 'tool_call_result') {
            try {
              const data = JSON.parse(ev.data);
              setActiveToolName(null);
              setActiveToolSummary(null);
              setSessions(prev => prev.map(s => {
                if (s.id === sessionId) {
                  const nextMsgs = withAssistantTail(s.messages);
                  const lastMsg = nextMsgs[nextMsgs.length - 1];
                  if (lastMsg.toolCalls) {
                    const calls = [...lastMsg.toolCalls];
                    const idx = calls.findIndex(t => t.name === data.tool && t.status === 'running');
                    if (idx !== -1) {
                      calls[idx] = {
                        ...calls[idx],
                        status: data.error ? 'error' : 'done',
                        result: data.result,
                        error: data.error
                      };
                      nextMsgs[nextMsgs.length - 1] = { ...lastMsg, toolCalls: calls };
                    }
                  }
                  return { ...s, messages: nextMsgs };
                }
                return s;
              }));
            } catch(e) {
              console.warn('Failed to parse tool_call_result:', e);
            }
            void loadWorkspaceFiles(workspaceSubPath || undefined);
          } else if (ev.event === 'action_required') {
            try {
              const data = JSON.parse(ev.data);
              onActionRequired?.(data);
            } catch(e) {
              console.warn('Failed to parse action_required:', e);
            }
          } else if (ev.event === 'question_required') {
            try {
              const data = JSON.parse(ev.data);
              onQuestionRequired?.(data);
            } catch(e) {
              console.warn('Failed to parse question_required:', e);
            }
          } else if (ev.event === 'heartbeat') {
            try {
              const data = JSON.parse(ev.data);
              // Update tool summary with elapsed time to show progress
              if (data.tool && data.elapsed_ms) {
                const elapsed = Math.round(data.elapsed_ms / 1000);
                setActiveToolSummary(prev => {
                  const base = prev?.replace(/\s*\(\d+s\)$/, '') || '';
                  return `${base} (${elapsed}s)`;
                });
              }
            } catch {}
          }
        },
        onclose() {
          if (!streamCompleted) {
            throw new Error('SSE connection closed before completion');
          }
          streamingSessionRef.current = null;
          setConversationLoading(false);
          setActiveToolName(null);
          setActiveToolSummary(null);
        },
        onerror(err) {
          if (!streamCompleted) {
            console.error('SSE Error:', err);
          }
          streamingSessionRef.current = null;
          setConversationLoading(false);
          setActiveToolName(null);
          setActiveToolSummary(null);
          throw err;
        },
      });
    } catch (err) {
      if (!streamCompleted) {
        console.error('SSE connection error:', err);
        onError?.('Connection failed. Please check your network and try again.');
      }
      streamingSessionRef.current = null;
      setConversationLoading(false);
      setActiveToolName(null);
      setActiveToolSummary(null);
    }
  }, [token, sessions, activeSessionId, activeSession, setSessions, setActiveSessionId, streamingSessionRef, loadingRef, setLoading, withAssistantTail, updateSessionMessages, loadSessionDetail, loadWorkspaceFiles, workspaceSubPath, agentMode, onError, onActionRequired, setConversationLoading]);

  return {
    activeToolName,
    activeToolSummary,
    currentIteration,
    stopMessage,
    sendMessage,
  };
}
