'use client';

import { useState, useRef, useEffect } from 'react';
import { EventStreamContentType, fetchEventSource } from '@microsoft/fetch-event-source';
import { Button, Input, Modal, Typography, Space, Popconfirm, Avatar, App as AntdApp, Tooltip } from 'antd';
import { Markdown, DraggablePanel, ActionIcon, Header, Tag as LobeTag, Text as LobeText } from '@lobehub/ui';
import { ChatList, LoadingDots } from '@lobehub/ui/chat';
import { PlusOutlined, DeleteOutlined, UserOutlined, LockOutlined, SettingOutlined, ApiOutlined, CheckCircleOutlined, PaperClipOutlined, RobotOutlined, ShareAltOutlined, CopyOutlined, MenuFoldOutlined, MenuUnfoldOutlined, FolderOutlined, FileOutlined, ReloadOutlined, CodeOutlined, SearchOutlined, FileTextOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { parseMessageContent } from '@/utils/messageParser';
import { ThinkingBlock } from '@/components/chat/ThinkingBlock';
import { PlanStepsCard } from '@/components/chat/PlanStepsCard';
import { WorkspaceFiles } from '@/components/chat/WorkspaceFiles';
import { ToolRenderer } from '@/components/chat/ToolRenderer';
import { ChatInputBox } from '@/components/chat/ChatInputBox';
import { normalizeHydratedMessages, type HydratedMessage, type HydratedToolCall } from '@/utils/sessionHydration';
import { colors, radius, fontSize, spacing } from '@/styles/tokens';

const { Text } = Typography;

const generateId = () => `msg-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = (path: string) => `${API_BASE_URL}${path}`;
const UPLOADED_WORKSPACE_PREFIX = 'Uploaded workspace files: ';
const UPLOADED_WORKSPACE_SUFFIX = ' Please continue with the current session.';

const buildUploadedWorkspacePrompt = (files: string[]) =>
  `${UPLOADED_WORKSPACE_PREFIX}${files.join(', ')}${UPLOADED_WORKSPACE_SUFFIX}`;

const parseUploadedWorkspacePrompt = (content: string) => {
  if (!content.includes(UPLOADED_WORKSPACE_PREFIX) || !content.endsWith(UPLOADED_WORKSPACE_SUFFIX)) {
    return null;
  }

  const start = content.lastIndexOf(UPLOADED_WORKSPACE_PREFIX);
  if (start < 0) return null;

  const filesStart = start + UPLOADED_WORKSPACE_PREFIX.length;
  const filesEnd = content.length - UPLOADED_WORKSPACE_SUFFIX.length;
  const files = content
    .slice(filesStart, filesEnd)
    .split(/\s*[,\uFF0C]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (files.length === 0) return null;

  const cleanContent = `${content.slice(0, start)}${content.slice(filesEnd + UPLOADED_WORKSPACE_SUFFIX.length)}`.trim();
  return { cleanContent, files };
};

type ToolCall = HydratedToolCall;

type Message = HydratedMessage;

interface Session {
  id: string;
  title: string;
  messages: Message[];
  active?: boolean;
}

type SessionSummary = Pick<Session, 'id' | 'title'>;

const withAssistantTail = (messages: Message[]) => {
  const nextMessages = [...messages];
  if (nextMessages.at(-1)?.role !== 'assistant') {
    nextMessages.push({ id: generateId(), role: 'assistant', content: '', streaming: true });
  }
  return nextMessages;
};

interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

interface ActionRequest {
  action_id: string;
  tool?: string;
  required_mode?: string;
  message?: string;
}

export default function ChatPage() {
  const [token, setToken] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionReq, setActionReq] = useState<ActionRequest | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const streamingSessionRef = useRef<string | null>(null);
  const { message } = AntdApp.useApp();

  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [activeToolSummary, setActiveToolSummary] = useState<string | null>(null);

  // Workspace files for right sidebar
  interface WorkspaceFile {
    name: string;
    path: string;
    is_dir: boolean;
    size: number;
  }
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [workspaceFilesLoading, setWorkspaceFilesLoading] = useState(false);
  const [workspaceSubPath, setWorkspaceSubPath] = useState<string>('');

  // Plan / Execute mode
  const [agentMode, setAgentMode] = useState<'plan' | 'execute'>('execute');

  // Settings & Plugins
  const [showSettings, setShowSettings] = useState(false);
  const [plugins, setPlugins] = useState([
    { id: '1', name: 'Postgres DB', command: 'npx', args: '-y @modelcontextprotocol/server-postgres', active: true },
    { id: '2', name: 'GitHub Repo', command: 'npx', args: '-y @modelcontextprotocol/server-github', active: false },
  ]);

  const [showSkillsModal, setShowSkillsModal] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillSearch, setSkillSearch] = useState('');
  const [leftExpand, setLeftExpand] = useState(true);
  const [rightExpand, setRightExpand] = useState(true);

  const loadSkills = async () => {
    setSkillsLoading(true);
    try {
      const res = await fetch(apiUrl('/v1/skills'));
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === 'success') setSkills(data.data);
    } catch (err) {
      console.error('Failed to load skills:', err);
    } finally {
      setSkillsLoading(false);
    }
  };

  const loadWorkspaceFiles = async (subPath?: string) => {
    if (!activeSessionId) {
      setWorkspaceFiles([]);
      return;
    }
    setWorkspaceFilesLoading(true);
    try {
      const token = localStorage.getItem('claw_token');
      const params = new URLSearchParams({ session_id: activeSessionId });
      if (subPath) params.set('path', subPath);
      const res = await fetch(apiUrl(`/v1/sandbox/files?${params}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setWorkspaceFiles(data.files || []);
      }
    } catch (err) {
      console.error('Failed to load workspace files:', err);
    } finally {
      setWorkspaceFilesLoading(false);
    }
  };

  const downloadWorkspaceFileFromSidebar = async (filePath: string) => {
    if (!activeSessionId) return;
    try {
      const token = localStorage.getItem('claw_token');
      const params = new URLSearchParams({ session_id: activeSessionId, path: filePath });
      const res = await fetch(apiUrl(`/v1/sandbox/download?${params}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filePath.split('/').pop() || 'download';
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Failed to download file:', err);
      message.error('Download failed');
    }
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);

  const setConversationLoading = (value: boolean) => {
    loadingRef.current = value;
    setLoading(value);
  };

  function handleLogout() {
    localStorage.removeItem('claw_token');
    setToken(null);
    setSessions([]);
    setActiveSessionId('');
    setShowLogin(true);
  }

  function createNewSession() {
    const newSession: Session = {
      id: generateId(),
      title: 'New Chat',
      messages: []
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
  }

  useEffect(() => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      // Only auto-scroll if we are near the bottom (within 150px)
      if (scrollHeight - scrollTop - clientHeight < 150) {
        scrollRef.current.scrollTop = scrollHeight;
      }
    }
  }, [activeSession?.messages]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      message.error('File is too large. Upload a file smaller than 10MB.');
      return;
    }

    message.loading({ content: 'Uploading file to the current workspace...', key: 'upload' });
    const formData = new FormData();
    formData.append('file', file);

    try {
      if (!activeSessionId) {
        message.error({ content: 'Please create or select a session before uploading files.', key: 'upload' });
        return;
      }
      const params = new URLSearchParams({ session_id: activeSessionId });
      const res = await fetch(apiUrl(`/v1/sandbox/upload?${params.toString()}`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('claw_token')}`
        },
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const nextFiles = Array.isArray(data.files) ? data.files.filter(Boolean) : [];
        message.success({
          content: `Uploaded to workspace: ${nextFiles[0] ?? file.name}`,
          key: 'upload',
        });
        setUploadedFiles((prev) => Array.from(new Set([...prev, ...nextFiles])));
      } else {
        message.error({ content: 'Upload failed: ' + (data.error || 'Unknown error'), key: 'upload' });
      }
    } catch {
      message.error({ content: 'Network error while uploading workspace file', key: 'upload' });
    }
    e.target.value = '';
  };

  const downloadWorkspaceFile = async (filepath?: string | React.MouseEvent) => {
    let filename = '';
    if (typeof filepath === 'string') {
      filename = filepath;
    } else {
      const input = prompt('Enter a workspace-relative file path, for example result.txt or reports/result.pdf');
      if (!input) return;
      filename = input;
    }
    if (!filename) return;
    
    message.loading({ content: 'Reading file from the current workspace...', key: 'download' });
    try {
      if (!activeSessionId) {
        message.error({ content: 'Please create or select a session before downloading files.', key: 'download' });
        return;
      }
      const params = new URLSearchParams({ path: filename, session_id: activeSessionId });
      const res = await fetch(apiUrl(`/v1/sandbox/download?${params.toString()}`), {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('claw_token')}` }
      });
      if (!res.ok) {
        message.error({ content: 'File not found or unreadable', key: 'download' });
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.split('/').pop() || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      message.success({ content: 'Download complete', key: 'download' });
    } catch {
      message.error({ content: 'Failed to download workspace file', key: 'download' });
    }
  };

  const loadSessions = async (authToken: string) => {
    try {
      const res = await fetch(apiUrl('/v1/sessions'), {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!res.ok) {
        if (res.status === 401) handleLogout();
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
  };

  const loadSessionDetail = async (id: string, authToken: string, sessionList: SessionSummary[]) => {
    try {
      const res = await fetch(apiUrl(`/v1/sessions/${id}`), {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (res.ok) {
        const state = await res.json();
        // Hydrate session messages into UI-friendly messages and tool calls.
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
                // Find the latest running tool call with this name
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
          messages: loadedMessages,
          active: isActiveTurn,
        };

        setSessions(prev => {
          const list = prev.length > 0 ? prev : sessionList.map(s => ({ id: s.id, title: s.title, messages: [] }));
          if (!list.some(s => s.id === id)) {
            return [loadedSession, ...list];
          }
          return list.map(s => s.id === id ? loadedSession : s);
        });
        setActiveSessionId(id);
        if (streamingSessionRef.current !== id) {
          setConversationLoading(isActiveTurn);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (skills.length !== 0) return;
    queueMicrotask(() => {
      void loadSkills();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills.length]);

  // Load workspace files when active session changes
  useEffect(() => {
    if (activeSessionId) {
      void loadWorkspaceFiles(workspaceSubPath || undefined);
    } else {
      setWorkspaceFiles([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  // Initialize auth state
  useEffect(() => {
    queueMicrotask(() => {
      const searchParams = new URLSearchParams(window.location.search);
      const isShared = searchParams.get('share') === 'true';
      const sharedSessionId = searchParams.get('session');

      if (isShared && sharedSessionId) {
        setShowLogin(false);
        // Shared link view uses a public session id without auth.
        void loadSessionDetail(sharedSessionId, '', []);
        return;
      }

      const savedToken = localStorage.getItem('claw_token');
      if (savedToken) {
        setToken(savedToken);
        setShowLogin(false);
        void loadSessions(savedToken);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token || !activeSessionId || !loading) return;
    if (streamingSessionRef.current === activeSessionId) return;

    const timer = window.setInterval(() => {
      void loadSessionDetail(activeSessionId, token, sessions);
    }, 2000);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, loading, sessions, token]);

  const handleLogin = async () => {
    if (!email || !password) return message.warning('Enter email and password');
    setLoginLoading(true);
    try {
      const res = await fetch(apiUrl('/v1/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem('claw_token', data.token);
        setToken(data.token);
        setShowLogin(false);
        message.success(`Signed in as ${data.full_name}`);
        loadSessions(data.token);
      } else {
        message.error(data.message || 'Login failed. Check your credentials.');
      }
    } catch {
      message.error('Network error');
    } finally {
      setLoginLoading(false);
    }
  };

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
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
  };

  const updateSessionMessages = (sessionId: string, newMessages: Message[]) => {
    setSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        const title = (s.title === 'New Chat' && newMessages.length > 0) 
            ? newMessages[0].content.substring(0, 15) + '...'
            : s.title;
        return { ...s, messages: newMessages, title };
      }
      return s;
    }));
  };

  const handleResolveAction = async (allow: boolean) => {
    if (!actionReq || !token) return;
    try {
      await fetch(apiUrl('/v1/chat/resolve_action'), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({
          action_id: actionReq.action_id,
          allow,
          reason: allow ? undefined : "User denied request",
        }),
      });
      setActionReq(null);
    } catch (e) {
      console.error(e);
    }
  };

  const sendMessage = async () => {
    if ((!input.trim() && uploadedFiles.length === 0) || loadingRef.current || !activeSession || !token) return;

    const sessionId = activeSessionId;
    let finalInput = input;
    if (uploadedFiles.length > 0) {
      finalInput += (finalInput ? '\n\n' : '') + buildUploadedWorkspacePrompt(uploadedFiles);
    }
    const userMsg: Message = { id: generateId(), role: 'user', content: finalInput };
    setUploadedFiles([]);
    
    const messagesAfterUser = normalizeHydratedMessages([...activeSession.messages, userMsg]);
    updateSessionMessages(sessionId, messagesAfterUser);
    
    setInput('');
    streamingSessionRef.current = sessionId;
    setConversationLoading(true);

    const assistantMsg: Message = { id: generateId(), role: 'assistant', content: '' };
    updateSessionMessages(sessionId, [...messagesAfterUser, assistantMsg]);

    const ctrl = new AbortController();
    let streamCompleted = false;

    try {
      await fetchEventSource(apiUrl('/v1/chat/completions'), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          session_id: sessionId,
          title: activeSession.title,
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
            // Reload session to get final persisted state
            void loadSessionDetail(sessionId, token, sessions);
            // Refresh workspace files to show any new output files
            void loadWorkspaceFiles(workspaceSubPath || undefined);
            return;
          }
          if (ev.event === 'session_created') {
            try {
              const data = JSON.parse(ev.data);
              if (data.session_id && data.session_id !== sessionId) {
                // Backend generated a different session_id - update frontend state
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
            message.error(ev.data || 'The agent run failed.');
            return;
          }
          if (ev.event === 'message') {
            try {
              const data = JSON.parse(ev.data);
              const chunkText = data.choices?.[0]?.delta?.content || '';
              setSessions(prev => prev.map(s => {
                if (s.id === sessionId) {
                  const nextMsgs = withAssistantTail(s.messages);
                  nextMsgs[nextMsgs.length - 1] = { 
                    ...nextMsgs[nextMsgs.length - 1], 
                    content: nextMsgs[nextMsgs.length - 1].content + chunkText 
                  };
                  return { ...s, messages: nextMsgs };
                }
                return s;
              }));
            } catch(e) {
              console.warn('Failed to parse message chunk:', e);
            }
          } else if (ev.event === 'tool_call_start') {
            try {
              const data = JSON.parse(ev.data);
              setActiveToolName(data.tool);
              // Extract summary from input
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
                  const newToolCall: ToolCall = {
                    id: generateId(),
                    name: data.tool,
                    input: inputStr,
                    status: 'running'
                  };
                  nextMsgs[nextMsgs.length - 1] = { 
                    ...lastMsg, 
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
            // Refresh workspace files after any tool execution
            void loadWorkspaceFiles(workspaceSubPath || undefined);
          } else if (ev.event === 'action_required') {
            try {
              const data = JSON.parse(ev.data);
              setActionReq(data);
            } catch(e) {
              console.warn('Failed to parse action_required:', e);
            }
          }
        },
        onclose() {
          if (!streamCompleted) {
            throw new Error('SSE connection closed before completion');
          }
          streamingSessionRef.current = null;
          setConversationLoading(false);
        },
        onerror(err) {
          if (!streamCompleted) {
            console.error('SSE Error:', err);
          }
          streamingSessionRef.current = null;
          setConversationLoading(false);
          throw err;
        },
      });
    } catch (err) {
      if (!streamCompleted) {
        console.error('SSE connection error:', err);
        message.error('Connection failed. Please check your network and try again.');
      }
      streamingSessionRef.current = null;
      setConversationLoading(false);
    }
  };

  return (
    <div style={{ height: '100vh', display: 'flex', backgroundColor: colors.bgPrimary }}>
      
      {/* Login modal */}
      <Modal
        title={<Typography.Title level={4} style={{ margin: 0, textAlign: 'center' }}>Welcome to Claw Agent</Typography.Title>}
        open={showLogin}
        closable={false}
        keyboard={false}
        mask={{ closable: false }}
        footer={null}
        width={360}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 }}>
          <Input 
            size="large" 
            prefix={<UserOutlined />} 
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <Input.Password 
            size="large" 
            prefix={<LockOutlined />} 
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onPressEnter={handleLogin}
          />
          <Button type="primary" size="large" block loading={loginLoading} onClick={handleLogin}>
            Sign in
          </Button>
          <Text type="secondary" style={{ textAlign: 'center', fontSize: 12 }}>
            Use your workspace account to continue.
          </Text>
        </div>
      </Modal>



      {/* 1 & 2. Unified Left Sidebar */}
      <DraggablePanel
        placement="left"
        minWidth={200}
        maxWidth={400}
        defaultSize={{ width: 260 }}
        expand={leftExpand}
        onExpandChange={setLeftExpand}
        expandable
        style={{ background: colors.bgSecondary, borderRight: `1px solid ${colors.borderMedium}` }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Space>
            <Avatar shape="square" size={28} style={{ background: colors.accent, color: '#fff', borderRadius: 8 }} icon={<RobotOutlined />} />
            <Text strong style={{ fontSize: 16 }}>Agent Workspace</Text>
          </Space>
          <Button type="text" size="small" icon={<MenuFoldOutlined />} style={{ opacity: 0.4 }} onClick={() => setLeftExpand(false)} />
        </div>

        <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
          <Button block style={{ textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, height: 40, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 12 }} onClick={createNewSession}>
            <PlusOutlined style={{ opacity: 0.6 }} /> New Chat
          </Button>
        </div>

        <div style={{ padding: '8px 16px' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Recent sessions</Text>
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {sessions.map(item => {
              const isActive = item.id === activeSessionId;
              return (
                <div 
                  key={item.id}
                  onClick={() => {
                    setActiveSessionId(item.id);
                    if (item.messages.length === 0 && item.title !== 'New Chat') {
                       loadSessionDetail(item.id, token!, sessions);
                    }
                  }}
                  style={{
                    padding: '8px 12px',
                    margin: '2px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: isActive ? colors.bgActive : 'transparent',
                    borderLeft: isActive ? `3px solid ${colors.accent}` : '3px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = colors.bgHover }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                >
                  <Space style={{ overflow: 'hidden', flex: 1 }}>
                    <Text type="secondary" style={{ color: isActive ? colors.accent : colors.textTertiary }}>#</Text>
                    <Text ellipsis style={{ width: 140, color: isActive ? '#000' : '#666', fontWeight: isActive ? 600 : 400 }}>
                      {item.title}
                    </Text>
                  </Space>
                  <Popconfirm
                    title="Delete this session?"
                    onConfirm={(e) => deleteSession(item.id, e as React.MouseEvent)}
                    onCancel={(e) => e?.stopPropagation()}
                    okText="Delete"
                    cancelText="Cancel"
                  >
                    <Button 
                      type="text" 
                      danger 
                      icon={<DeleteOutlined />} 
                      size="small" 
                      onClick={e => e.stopPropagation()}
                      style={{ opacity: isActive ? 1 : 0.4 }}
                    />
                  </Popconfirm>
                </div>
              );
            })}
          </div>
        </div>
        </div>
      </DraggablePanel>

      {/* 3. Main Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', background: colors.bgPrimary }}>
        {/* Header */}
        <Header 
          logo={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
              <Text strong style={{ fontSize: 16 }}>{activeSession?.title || 'Hello'}</Text>
            </div>
          }
          actions={
            <Space style={{ whiteSpace: 'nowrap' }}>
              <Popconfirm
                title="Clear all messages?"
                description="This cannot be undone."
                onConfirm={() => {
                  if (activeSessionId) {
                    updateSessionMessages(activeSessionId, []);
                  }
                }}
                okText="Clear"
                cancelText="Cancel"
              >
                <ActionIcon icon={DeleteOutlined} title="Clear chat" />
              </Popconfirm>
              <ActionIcon
                icon={ThunderboltOutlined}
                title="Skills"
                onClick={() => setShowSkillsModal(true)}
              />
              <ActionIcon
                icon={SettingOutlined}
                title="Settings"
                onClick={() => setShowSettings(true)}
              />
              <ActionIcon
                icon={ShareAltOutlined}
                title="Copy share link"
                onClick={async () => {
                  try {
                    const shareUrl = `${window.location.origin}/?session=${activeSession?.id}&share=true`;
                    await navigator.clipboard.writeText(shareUrl);
                    message.success('Share link copied to clipboard.');
                  } catch {
                    message.error('Failed to copy share link');
                  }
                }}
              />
            </Space>
          }
        />

        {/* Chat Area */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {(!activeSession || activeSession.messages.length === 0) && (
               <div style={{ textAlign: 'center', marginTop: 60 }}>
                 <RobotOutlined style={{ fontSize: 48, color: colors.accent, marginBottom: 16 }} />
                 <Typography.Title level={3} style={{ color: '#333', marginBottom: 4 }}>Claw Agent</Typography.Title>
                 <Text type="secondary" style={{ display: 'block', marginBottom: 40, fontSize: 14 }}>
                   I can write code, run commands, analyze files, and more. Try a prompt below to get started.
                 </Text>
                 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 520, margin: '0 auto' }}>
                   {[
                     { icon: <CodeOutlined />, title: 'Write Code', desc: 'Generate functions, scripts, or full modules', prompt: 'Help me write a Python script that reads a CSV file and computes summary statistics.' },
                     { icon: <SearchOutlined />, title: 'Analyze Code', desc: 'Understand architecture, find bugs, review PRs', prompt: 'Analyze the current project structure and explain the main entry points and data flow.' },
                     { icon: <FileTextOutlined />, title: 'Process Files', desc: 'Parse, transform, and generate documents', prompt: 'Read the README.md in the current directory and create a concise summary.' },
                     { icon: <ThunderboltOutlined />, title: 'Run Commands', desc: 'Execute shell commands and automate tasks', prompt: 'List all running processes and check disk usage on this machine.' },
                   ].map((item, idx) => (
                     <div
                       key={idx}
                       onClick={() => { setInput(item.prompt); }}
                       style={{
                         display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8,
                         padding: '16px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                         background: '#fafafa', border: '1px solid #f0f0f0',
                         transition: 'all 0.2s ease',
                       }}
                       onMouseEnter={e => { e.currentTarget.style.borderColor = colors.accent; e.currentTarget.style.background = colors.bgPrimary; }}
                       onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.background = colors.bgTertiary; }}
                     >
                       <span style={{ fontSize: 20, color: colors.accent }}>{item.icon}</span>
                       <Text strong style={{ fontSize: 14 }}>{item.title}</Text>
                       <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.4 }}>{item.desc}</Text>
                     </div>
                   ))}
                 </div>
               </div>
            )}
            
            {activeSession && activeSession.messages.length > 0 && (
              <ChatList
                data={activeSession.messages.map(msg => {
                  const parsed = parseMessageContent(msg.content || '');
                  return {
                    id: msg.id,
                    role: msg.role === 'user' ? 'user' : 'assistant',
                    content: msg.content || ' ',
                    meta: msg.role === 'user' ? {
                      title: '',
                      avatar: <></>,
                    } : {
                      avatar: <RobotOutlined />,
                      title: 'Agent',
                      backgroundColor: colors.accent,
                    },
                    extra: {
                      toolCalls: msg.toolCalls,
                      parsed
                    }
                  } as unknown as NonNullable<React.ComponentProps<typeof ChatList>['data']>[number]
                })}
                renderMessages={{
                  user: ({ content }) => {
                    const uploadedFilesPrompt = parseUploadedWorkspacePrompt(content);

                    const handleCopy = () => {
                      navigator.clipboard.writeText(content).then(() => {
                        message.success('Copied to clipboard');
                      }).catch(() => {
                        message.error('Copy failed');
                      });
                    };

                    if (uploadedFilesPrompt) {
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                          {uploadedFilesPrompt.cleanContent && (
                            <div style={{ whiteSpace: 'pre-wrap' }}>{uploadedFilesPrompt.cleanContent}</div>
                          )}
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            {uploadedFilesPrompt.files.map((filePath) => {
                              const displayName = filePath.split('/').pop() || filePath;

                              return (
                                <div
                                  key={filePath}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    padding: '8px 12px',
                                    background: 'rgba(0,0,0,0.04)',
                                    borderRadius: 8,
                                  }}
                                >
                                  <PaperClipOutlined style={{ color: colors.info, fontSize: 16 }} />
                                  <Text strong style={{ fontSize: 13 }}>
                                    {displayName}
                                  </Text>
                                </div>
                              );
                            })}
                          </div>
                          <Button
                            type="text"
                            size="small"
                            icon={<CopyOutlined />}
                            onClick={handleCopy}
                            style={{ opacity: 0.5 }}
                          />
                        </div>
                      );
                    }
                    return (
                      <div style={{ position: 'relative' }}>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
                        <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopy} style={{ position: 'absolute', top: 4, right: 4, opacity: 0.3 }} />
                      </div>
                    );
                  },
                  assistant: ({ extra, content }) => {
                    const parsed = extra?.parsed;
                    const handleCopyAssistant = () => {
                      const text = parsed?.cleanContent || content || '';
                      navigator.clipboard.writeText(text).then(() => {
                        message.success('Copied to clipboard');
                      }).catch(() => {
                        message.error('Copy failed');
                      });
                    };
                    return (
                      <div style={{ wordBreak: 'break-word', lineHeight: 1.6, position: 'relative' }}>
                        <ThinkingBlock content={parsed?.thinkingBlock} />
                        <Markdown>{parsed?.cleanContent || ''}</Markdown>
                        <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopyAssistant} style={{ position: 'absolute', top: 4, right: 4, opacity: 0.3 }} />
                      </div>
                    );
                  }
                }}
                renderMessagesExtra={{
                  assistant: ({ extra }) => {
                    const parsed = extra?.parsed;
                    const tools = extra?.toolCalls;
                    if (!parsed && !tools) return null;
                    return (
                      <div style={{ marginTop: 8 }}>
                        <PlanStepsCard 
                          steps={parsed?.planSteps || []} 
                          onExecuteStep={(fullBlock) => {
                            setInput(`Please execute the following step:\n\n${fullBlock}`);
                            setAgentMode('execute');
                          }} 
                        />
                        <WorkspaceFiles 
                          files={parsed?.workspaceFiles || []} 
                          onDownload={downloadWorkspaceFile} 
                        />
                        {tools && tools.length > 0 && (
                          <ToolRenderer toolCalls={tools} />
                        )}
                      </div>
                    );
                  }
                }}
              />
            )}
            
            {loading && (
               <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 8 }}>
                  <LoadingDots size={4} variant="typing" />
                  {activeToolName ? (
                    <LobeText type="secondary" italic>
                      Running <Text strong style={{ fontWeight: 600 }}>{activeToolName}</Text>
                      {activeToolSummary && <span> — {activeToolSummary}</span>}
                    </LobeText>
                  ) : (
                    <LobeText type="secondary" italic>Agent is thinking...</LobeText>
                  )}
               </div>
            )}
          </div>
        </div>

        {/* Input Area */}
        <div style={{ padding: '0 24px 32px', background: 'transparent' }}>
          {uploadedFiles.length > 0 && (
            <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {uploadedFiles.map(f => (
                <LobeTag
                  key={f} 
                  closable 
                  onClose={() => setUploadedFiles(prev => prev.filter(p => p !== f))}
                  icon={<PaperClipOutlined />}
                  color="blue"
                  style={{ padding: '4px 10px', borderRadius: 16, fontSize: 13 }}
                >
                  {f.split('/').pop()}
                </LobeTag>
              ))}
            </div>
          )}
          <ChatInputBox 
            input={input}
            setInput={setInput}
            loading={loading}
            onSend={sendMessage}
            agentMode={agentMode}
            setAgentMode={setAgentMode}
            onFileUpload={handleFileUpload}
            skills={skills}
          />
        </div>
      </div>

      {/* 4. Right Sidebar: Workspace */}
      <DraggablePanel
        placement="right"
        minWidth={200}
        maxWidth={400}
        defaultSize={{ width: 300 }}
        expand={rightExpand}
        onExpandChange={setRightExpand}
        expandable
        style={{ background: colors.bgPrimary }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${colors.borderLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text strong style={{ fontSize: 15 }}>Workspace</Text>
          <Button type="text" size="small" icon={<MenuUnfoldOutlined />} style={{ opacity: 0.4 }} onClick={() => setRightExpand(false)} />
        </div>

        {/* Workspace Files Section */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: colors.bgTertiary }}>
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Files {workspaceSubPath && `/ ${workspaceSubPath}`}
            </Text>
            <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => loadWorkspaceFiles(workspaceSubPath || undefined)} loading={workspaceFilesLoading} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {workspaceSubPath && (
              <div
                style={{ padding: '6px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#1677ff' }}
                onClick={() => { setWorkspaceSubPath(''); void loadWorkspaceFiles(); }}
              >
                <FolderOutlined /> ..
              </div>
            )}
            {workspaceFiles.length === 0 && !workspaceFilesLoading ? (
              <div style={{ textAlign: 'center', padding: '24px 16px' }}>
                <FolderOutlined style={{ fontSize: 32, color: colors.border, marginBottom: 8 }} />
                <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                  {activeSessionId ? 'No files yet' : 'Select a session'}
                </Text>
              </div>
            ) : (
              workspaceFiles.map((file, idx) => (
                <Tooltip key={idx} title={file.is_dir ? 'Open folder' : 'Click to download'} placement="left">
                <div
                  style={{
                    padding: '6px 16px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    borderRadius: 4,
                    margin: '1px 4px',
                  }}
                  className="workspace-file-item"
                  onClick={() => {
                    if (file.is_dir) {
                      setWorkspaceSubPath(file.path);
                      void loadWorkspaceFiles(file.path);
                    } else {
                      downloadWorkspaceFileFromSidebar(file.path);
                    }
                  }}
                >
                  {file.is_dir ? (
                    <FolderOutlined style={{ color: colors.warning, fontSize: 14 }} />
                  ) : (
                    <FileOutlined style={{ color: colors.textSecondary, fontSize: 14 }} />
                  )}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.name}
                  </span>
                  {!file.is_dir && (
                    <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>
                      {file.size < 1024 ? `${file.size}B` : file.size < 1048576 ? `${(file.size / 1024).toFixed(1)}K` : `${(file.size / 1048576).toFixed(1)}M`}
                    </Text>
                  )}
                </div>
                </Tooltip>
              ))
            )}
          </div>
        </div>

        </div>
      </DraggablePanel>

      {/* Action Prompt Modal */}
      <Modal
        title={
          <Space><span style={{ fontSize: 20 }}>Permission Request</span></Space>
        }
        open={!!actionReq}
        closable={false}
        keyboard={false}
        mask={{ closable: false }}
        footer={null}
        width={500}
      >
        <p style={{ marginTop: 16 }}>The agent needs approval before running this action.</p>
        <div style={{ background: colors.bgTertiary, border: `1px solid ${colors.border}`, padding: 16, borderRadius: 8, marginBottom: 24, marginTop: 16 }}>
          <p style={{ margin: '0 0 8px' }}><strong>Tool:</strong> <Text code>{actionReq?.tool}</Text></p>
          <p style={{ margin: '0 0 8px' }}><strong>Required mode:</strong> <Text type="danger">{actionReq?.required_mode}</Text></p>
          <p style={{ margin: 0 }}><strong>Reason:</strong> <Text type="secondary">{actionReq?.message}</Text></p>
        </div>
        <Space style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
          <Button danger onClick={() => handleResolveAction(false)}>Reject</Button>
          <Button type="primary" onClick={() => handleResolveAction(true)}>Approve</Button>
        </Space>
      </Modal>

      {/* Settings Modal */}
      <Modal
        title={
          <Space><SettingOutlined /> <span>Settings</span></Space>
        }
        open={showSettings}
        onCancel={() => setShowSettings(false)}
        footer={null}
        width={700}
      >
        <div style={{ marginTop: 24 }}>
          <Typography.Title level={5}>MCP Servers</Typography.Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>Manage MCP server integrations for the agent.</Text>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {plugins.map(item => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: colors.bgTertiary, borderRadius: 8, border: `1px solid ${colors.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <ApiOutlined style={{ fontSize: 24, color: item.active ? colors.info : colors.textTertiary }} />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Text strong>{item.name}</Text>
                      {item.active && <Text type="success" style={{ fontSize: 12 }}><CheckCircleOutlined /> Active</Text>}
                    </div>
                    <Text code style={{ fontSize: 12, marginTop: 4, display: 'block' }}>{item.command} {item.args}</Text>
                  </div>
                </div>
                <Space>
                  <Button 
                    key="toggle" 
                    type={item.active ? 'default' : 'primary'} 
                    size="small"
                    onClick={() => setPlugins(prev => prev.map(p => p.id === item.id ? { ...p, active: !p.active } : p))}
                  >
                    {item.active ? 'Disable' : 'Enable'}
                  </Button>
                  <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => setPlugins(prev => prev.filter(p => p.id !== item.id))} />
                </Space>
              </div>
            ))}
          </div>
          <Button 
            type="dashed" 
            block 
            icon={<PlusOutlined />} 
            style={{ marginTop: 16 }}
            onClick={() => {
              const newPlugin = { id: generateId(), name: 'New MCP Server', command: 'npx', args: '', active: false };
              setPlugins([...plugins, newPlugin]);
            }}
          >
            Add MCP Server
          </Button>
        </div>
      </Modal>
      {/* Skills Modal */}
      <Modal
        title={
          <Space><ThunderboltOutlined /> <span>Agent Skills</span></Space>
        }
        open={showSkillsModal}
        onCancel={() => setShowSkillsModal(false)}
        footer={null}
        width={700}
      >
        <div style={{ marginTop: 24, maxHeight: '60vh', display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: 16 }}>
            <Input 
              placeholder="Search skills..."
              value={skillSearch}
              onChange={e => setSkillSearch(e.target.value)}
              allowClear
            />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {skillsLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">Loading skills...</Text></div>
            ) : skills.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">No skills available.</Text></div>
            ) : skills.filter(s => s.name.toLowerCase().includes(skillSearch.toLowerCase()) || s.description.toLowerCase().includes(skillSearch.toLowerCase())).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">No matching skills found.</Text></div>
            ) : skills.filter(s => s.name.toLowerCase().includes(skillSearch.toLowerCase()) || s.description.toLowerCase().includes(skillSearch.toLowerCase())).map(item => (
              <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: colors.bgCode, borderRadius: 12, border: `1px solid ${colors.borderLight}` }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flex: 1 }}>
                  <Avatar style={{ backgroundColor: colors.infoBg, color: colors.info }} icon={<RobotOutlined />} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Text strong style={{ fontSize: 15 }}>{item.name}</Text>
                    </div>
                    <Text type="secondary" style={{ fontSize: 13, marginTop: 8, display: 'block', wordBreak: 'break-word', lineHeight: 1.5 }}>{item.description}</Text>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>

    </div>
  );
}
