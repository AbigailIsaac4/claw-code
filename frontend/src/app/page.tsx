'use client';

import { useState, useRef, useEffect } from 'react';
import { EventStreamContentType, fetchEventSource } from '@microsoft/fetch-event-source';
import { Button, Input, Modal, Typography, Space, Popconfirm, Avatar, App as AntdApp } from 'antd';
import { Markdown, DraggablePanel, ActionIcon, Header, Tag as LobeTag, Text as LobeText } from '@lobehub/ui';
import { ChatList, LoadingDots } from '@lobehub/ui/chat';
import { PlusOutlined, DeleteOutlined, UserOutlined, LockOutlined, SettingOutlined, ApiOutlined, CheckCircleOutlined, PaperClipOutlined, RobotOutlined, ThunderboltOutlined, ShareAltOutlined, CopyOutlined, MenuFoldOutlined, MenuUnfoldOutlined, QuestionCircleOutlined, FileTextOutlined } from '@ant-design/icons';
import { parseMessageContent } from '@/utils/messageParser';
import { ThinkingBlock } from '@/components/chat/ThinkingBlock';
import { PlanStepsCard } from '@/components/chat/PlanStepsCard';
import { WorkspaceFiles } from '@/components/chat/WorkspaceFiles';
import { ToolRenderer } from '@/components/chat/ToolRenderer';
import { ChatInputBox } from '@/components/chat/ChatInputBox';
import { normalizeHydratedMessages, type HydratedMessage, type HydratedToolCall } from '@/utils/sessionHydration';

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
    .split(/\s*[，,]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (files.length === 0) return null;

  const cleanContent = `${content.slice(0, start)}${content.slice(filesEnd + UPLOADED_WORKSPACE_SUFFIX.length)}`.trim();
  return { cleanContent, files };
};

type ToolCall = HydratedToolCall;

interface Todo {
  content: string;
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed';
}

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

  const [todos, setTodos] = useState<Todo[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);

  // Plan / Execute 婵犵數濮烽。钘壩ｉ崨鏉戝瀭妞ゅ繐鐗嗛悞鍨亜閹哄棗浜剧紒鍓ц檸閸樻儳鈽夐悽绋跨劦妞ゆ帒瀚埛鎴︽煕濞戞﹫宸ョ紒妤佸笚缁绘稓鎷犺閻ｉ亶鏌?
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
      const data = await res.json();
      if (data.status === 'success') setSkills(data.data);
    } catch (err) {
      console.error('Failed to load skills:', err);
      message.error('Failed to load skills');
    } finally {
      setSkillsLoading(false);
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
        // 闂傚倸鍊风粈渚€骞夐垾鎰佹綎缂備焦蓱閸欏繘鏌熼锝囦汗鐟滅増甯掗悙濠冦亜閹哄棗浜鹃柣搴㈣壘椤︾敻寮诲鍫闂佸憡鎸鹃崰搴敋閿濆鏁嗗〒姘功閻绻涙潏鍓хК婵炲拑缍侀幃浼村Ψ閳哄倻鍘介梺缁樏鑸靛緞閸曨厾纾奸悹鍥у级椤ャ垺銇勯姀陇澹橀柍钘夘樀婵偓闁绘鏁搁弳?        loadSessionDetail(data[0].id, authToken, data);
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
        // 闂傚倷娴囧畷鐢稿窗閹扮増鍋￠弶鍫氭櫅缁躲倕螖閿濆懎鏆為柛濠囨涧闇夐柣妯烘▕閸庡繘鎮峰▎娆戠暤妤犵偞鐗楀蹇涘礈瑜忔牎濠电偛顕崢褔宕愰崸妤€钃?state.messages闂傚倸鍊烽悞锔锯偓绗涘懐鐭欓柟杈鹃檮閸ゆ劖銇勯弽顐沪闁稿骸绉归弻鏇＄疀婵犲倸鈷夋繛瀛樺殠閸婃繈寮婚敐澶婄疀妞ゆ棁濮ゅВ鍕⒑鏉炴壆绐旂紒鐘崇墵瀵?assistant/tool 闂傚倸鍊烽懗鍫曪綖鐎ｎ喖绀嬮柛顭戝亞閺嗐儵姊绘担绛嬪殐闁哥姵鐗犻弻濠囨晲婢跺浠掑銈嗘磵閸嬫挾鈧鍠栭悘姘跺箯閸涙潙绀冩い蹇撶У鏁堝┑鐘垫暩閸嬬偤宕归崼鏇炵闁圭虎鍠栫壕濠氭煙閻愵剚鐏辨俊?assistant bubble
        const messages: Message[] = [];
        let currentAssistant: Message | null = null;
        let sessionTodos: Todo[] = [];

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
                if (block.name === 'TodoWrite') {
                  try {
                    const inputArgs = typeof block.input === 'string' ? JSON.parse(block.input) : block.input;
                    if (inputArgs.todos) sessionTodos = inputArgs.todos;
                  } catch {}
                }
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
        
        setTodos(sessionTodos);
        
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

  // Initialize auth state
  useEffect(() => {
    queueMicrotask(() => {
      const searchParams = new URLSearchParams(window.location.search);
      const isShared = searchParams.get('share') === 'true';
      const sharedSessionId = searchParams.get('session');

      if (isShared && sharedSessionId) {
        setShowLogin(false);
        // 闂傚倸鍊烽懗鍫曞磿閻㈢鐤炬繛鎴欏灪閸嬨倝鏌曟繛褍瀚▓浼存⒑閸︻叀妾搁柛鐘崇墱缁牆鐣濋崟顒傚幈濡炪値鍘介崹鐢稿几閻斿吋鐓曞┑鐘插暙閳绘洟鏌熼鑲╃Ш鐎规洖鐖奸、妤佹媴鐟欏嫭顔忛梻鍌欑劍濡炴寧绂嶅┑鍥╃彾闁糕剝绋戠粻?session
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
        message.success(`婵犵數濮烽弫鎼佸磻濞戞娑欐償閵娿儱鐎梺鍏肩ゴ閺呮粌鐣烽弻銉﹀€甸柨婵嗛閺嬫盯鏌ｉ幇顒婅含闁哄矉缍侀獮鍥敆閸屾稒鍠栭梻? ${data.full_name}`);
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
              if (data.tool === 'TodoWrite') {
                try {
                  const rawInput = typeof data.input === 'string' ? JSON.parse(data.input) : data.input;
                  if (rawInput.todos) setTodos(rawInput.todos);
                } catch {}
              }
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
          } else if (ev.event === 'action_required') {
            try {
              const data = JSON.parse(ev.data);
              setActionReq(data);
            } catch(e) {
              console.warn('Failed to parse action_required:', e);
            }
          } else if (ev.event === 'runtime_error') {
            if (ev.data.includes('\u5f53\u524d\u4f1a\u8bdd\u5df2\u6709\u4e00\u8f6e\u5bf9\u8bdd\u6b63\u5728\u5904\u7406\u4e2d\uff0c\u8bf7\u7b49\u5f85\u4e0a\u4e00\u8f6e\u7ed3\u675f\u540e\u518d\u53d1\u9001\u3002')) {
              streamCompleted = true;
              streamingSessionRef.current = null;
              void loadSessionDetail(sessionId, token, sessions);
              return;
            }
            streamCompleted = true;
            streamingSessionRef.current = null;
            setConversationLoading(false);
            message.error(ev.data || 'The agent run failed.');
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
        console.error(err);
      }
      streamingSessionRef.current = null;
      setConversationLoading(false);
    }
  };

  return (
    <div style={{ height: '100vh', display: 'flex', backgroundColor: '#fff' }}>
      
      {/* 闂傚倸鍊峰ù鍥儍椤愶箑骞㈤柍杞扮劍椤斿嫮绱撻崒姘偓鍝ョ矓鐎靛摜鐭撻柟缁㈠櫘閺佸鏌ㄥ┑鍡╂Ц闁圭鍩栭妵鍕箻鐠虹洅銏ゆ煟?*/}
      <Modal
        title={<Typography.Title level={4} style={{ margin: 0, textAlign: 'center' }}>闂傚倸鍊峰ù鍥儍椤愶箑骞㈤柍杞扮劍椤斿嫮绱?Claw Agent</Typography.Title>}
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
            闂傚倷绀侀幖顐λ囬锕€鐤炬繝濠傛噽閻瑩鏌熸潏鍓х暠闁活厽顨婇弻娑㈠焺閸愵亗鈧帞鈧鎸风欢姘跺蓟濞戙垹绠涙い鎾跺仧缁佺兘姊?
          </Button>
          <Text type="secondary" style={{ textAlign: 'center', fontSize: 12 }}>
            婵? 闂傚倸鍊风粈渚€骞栭锔藉亱婵犲﹤鐗嗙粈鍫熺箾閸℃ɑ灏伴柣鎾卞灲閺屽秹宕崟顒€娅ｉ梺娲诲幗椤ㄥ懓鐏嬫俊顐︻暒濞村洭宕楀畝鍕厽妞ゆ挾鍋熼悞鍛婃叏婵犲偆鐓肩€规洜鍠栭、妤呭焵椤掍焦鍙忛柛顐熸噰閸嬫捇宕烽褏鍔稿┑鐐茬毞閳ь剚鍓氶崵鏇㈡煕椤愶絾绀€缂佲偓閸愨斂浜滈煫鍥ㄦ尰閸ｇ儤绻涢崼娑樼伈婵﹨娅ｉ幉鎾礋椤掆偓閸炲顪冮妶鍐ㄥ姕闁瑰憡鎮傞崺銏狀吋婢跺á銊╂煏婵犲繒瀵兼慨瑙勵殜濮婃椽宕崟顒€顦╅梺鐓庣秺缁犳牠宕洪姀锝囩杸婵炴垶鐟ч崢浠嬫⒑闂堟稓绠氶柡鍛箞瀹曘垹顭ㄩ崨顖滐紲闁哄鐗勯崝搴ｇ不閹剧粯鐓冪紓浣股戦ˉ鍫濃攽閳╁啯鍊愬┑锛勫厴婵＄兘鏁傞懞銉у竼闂傚倷娴囧畷鍨叏閺夋嚚娲Ω閳轰浇鎽曟繝銏ｆ硾椤戝洭銆呴悜鑺ョ厱妞ゆ劗濮撮悘鈺呮倵閸偆鍙€闁哄被鍊栭幈銊╁箛椤戣棄浜鹃柕鍫濐槸鐟欙箓鏌嶈閸撶喎顫忓ú顏呭殥闁靛牆鎳嶇划璺衡攽閳藉棗浜濇い銊ワ躬閻涱喗寰勯幇顒傤唴闂佽姤锚閿?          </Text>
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
        style={{ background: '#f8f6f3', borderRight: '1px solid rgba(0,0,0,0.06)' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Space>
            <Avatar shape="square" size={28} style={{ background: '#eb6f4b', color: '#fff', borderRadius: 8 }} icon={<RobotOutlined />} />
            <Text strong style={{ fontSize: 16 }}>Agent Workspace</Text>
          </Space>
          <Button type="text" size="small" icon={<MenuFoldOutlined />} style={{ opacity: 0.4 }} onClick={() => setLeftExpand(false)} />
        </div>

        <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
          <Button block style={{ textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, height: 40, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 12 }} onClick={createNewSession}>
            <PlusOutlined style={{ opacity: 0.6 }} /> 闂備浇顕х€涒晠顢欓弽顓炵獥闁圭儤顨呯壕濠氭煙閸撗呭笡闁绘挻娲橀幈銊ノ熼悡搴′粯闂佽楠忕换婵嬪蓟閿涘嫪娌柡鍌樺€曟慨娑㈡⒑瑜版帩妫戝┑顔芥尦閸╃偤骞嬮悩顐壕闁挎繂鎳愭禒娑欐叏?
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
                    background: isActive ? 'rgba(0,0,0,0.03)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'all 0.3s ease',
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(0,0,0,0.03)' }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                >
                  <Space style={{ overflow: 'hidden', flex: 1 }}>
                    <Text type="secondary" style={{ color: isActive ? '#eb6f4b' : '#aaa' }}>#</Text>
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
        <div style={{ padding: '16px' }}>
          <Button type="text" size="small" icon={<QuestionCircleOutlined />} style={{ color: '#888' }} onClick={() => setShowSettings(true)} />
        </div>
        </div>
      </DraggablePanel>

      {/* 3. Main Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', background: '#fff' }}>
        {/* Header */}
        <Header 
          logo={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
              <Text strong style={{ fontSize: 16 }}>{activeSession?.title || 'Hello'}</Text>
            </div>
          }
          actions={
            <Space style={{ whiteSpace: 'nowrap' }}>
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
               <div style={{ textAlign: 'center', marginTop: 100 }}>
                 <Typography.Title level={3} style={{ color: '#ccc' }}>Start a new conversation</Typography.Title>
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
                      backgroundColor: '#eb6f4b',
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
                                  <PaperClipOutlined style={{ color: '#1677ff', fontSize: 16 }} />
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
                        <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopy} style={{ position: 'absolute', top: -4, right: -32, opacity: 0.35 }} />
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
                        <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopyAssistant} style={{ position: 'absolute', top: -4, right: -8, opacity: 0.35 }} />
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
                            setInput(`闂傚倷娴囧畷鍨叏閺夋嚚娲敇閵忕姷鍝楅柡澶婄墑閸斿秴鈻嶉悩缁樼厽闁挎繂鎳忓﹢浼存煕鐎ｎ偓鑰块柟顔斤耿閹瑩鎮滃鍫㈠惞缂傚倷闄嶉崝宥咁熆濮椻偓閸┿儲寰勯幇顒傤啋闂佸綊顣︾粈渚€宕滈崡鐑嗘富闁靛牆妫楃粭褔鏌涚€ｎ剙浠遍柕鍡楀暣婵＄兘鍩℃担鍕撳洨鍙撻柛銉ｅ妽缁€鍫ユ煟濞戣鲸鐝渘${fullBlock}`);
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
                  <LobeText type="secondary" italic>Agent 婵犵數濮甸鏍窗濡ゅ啯宕查柟閭﹀枛缁躲倝鏌﹀Ο渚闁肩増瀵ч妵鍕疀閹炬潙娅ｇ紓浣稿閸嬨倝寮诲☉銏犲嵆闁靛鍎辩粻娲⒑?..</LobeText>
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

      {/* 4. Right Sidebar: Workspace & Plan */}
      <DraggablePanel
        placement="right"
        minWidth={200}
        maxWidth={400}
        defaultSize={{ width: 280 }}
        expand={rightExpand}
        onExpandChange={setRightExpand}
        expandable
        style={{ background: '#ffffff' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text strong style={{ fontSize: 16 }}>Todos</Text>
          <Button type="text" size="small" icon={<MenuUnfoldOutlined />} style={{ opacity: 0.4 }} onClick={() => setRightExpand(false)} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {todos.length === 0 ? (
            <div style={{ textAlign: 'center', marginTop: 100, padding: '0 24px' }}>
              <FileTextOutlined style={{ fontSize: 48, color: '#f0f0f0', marginBottom: 16 }} />
              <Text type="secondary" style={{ fontSize: 13, display: 'block', lineHeight: 1.6 }}>Todo items from the agent will appear here when available.</Text>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {todos.map((todo, idx) => (
                <div key={idx} style={{ 
                  padding: '10px 12px', 
                  background: todo.status === 'completed' ? '#f6ffed' : (todo.status === 'in_progress' ? '#e6f4ff' : '#fafafa'),
                  border: '1px solid',
                  borderColor: todo.status === 'completed' ? '#b7eb8f' : (todo.status === 'in_progress' ? '#91caff' : '#f0f0f0'),
                  borderRadius: 8,
                  transition: 'all 0.3s'
                }}>
                   <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                     <div style={{ marginTop: 2 }}>
                       {todo.status === 'completed' && <CheckCircleOutlined style={{ color: '#52c41a' }} />}
                       {todo.status === 'in_progress' && <ThunderboltOutlined style={{ color: '#1677ff' }} />}
                       {todo.status === 'pending' && <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #d9d9d9' }} />}
                     </div>
                     <Text strong style={{ fontSize: 13, textDecoration: todo.status === 'completed' ? 'line-through' : 'none', color: todo.status === 'completed' ? '#888' : 'inherit', lineHeight: 1.4 }}>
                       {todo.content}
                     </Text>
                   </div>
                   {todo.activeForm && <Text type="secondary" style={{ fontSize: 12, display: 'block', marginLeft: 22 }}>{todo.activeForm}</Text>}
                </div>
              ))}
            </div>
          )}
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
        <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', padding: 16, borderRadius: 8, marginBottom: 24, marginTop: 16 }}>
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
          <Typography.Title level={5}>闂備浇顕уù鐑藉箠閹捐绠熼柨鐔哄У閸嬪倿鏌ㄩ悢鍝勑㈤柛灞诲姂閺屾洟宕煎┑鍥х獩缂佹儳澧介崑鎾诲Φ閸曨垰绫嶉柛灞剧煯婢规洟姊?MCP 闂傚倸鍊风粈渚€骞栭锔藉亱闁糕剝鐟ч惌鎾绘倵濞戞鎴﹀矗韫囨稒鐓熼柡鍐ㄥ€哥敮鍫曟⒒?(闂傚倸鍊风粈渚€骞夐敓鐘茬闁哄洢鍨圭粻鐘虫叏濡炶浜鹃悗瑙勬礃濞叉粓鍩€椤掑倹鏆╃痪顓炵埣瀹曟垿骞樼紒妯轰画闂備緡鍙忛梽鍕懅闂傚倷绀侀幉锟犳偡閵壯勫床婵せ鍋撻柣娑卞櫍楠炴鎷犻懠顒夊敽闁诲骸绠嶉崕鍗炍涢銏犵；?</Typography.Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            婵犵數濮甸鏍窗濡ゅ啰绱﹂柛褎顨呯壕褰掓煛閸ワ絾鍤嶉柛銉墮閻撴盯鏌涘☉鍗炴灓闁告ɑ鍔欓幃妤呯嵁閸喖濮庡┑鐐茬湴閸旀垵顕ｉ幖浣哥＜闁绘劕顕崢浠嬫⒑闂堟侗鐒鹃柛搴ㄤ憾椤㈡棃顢旈崱妯烘瀾闂佸搫顦悘婵嬪汲閻愮數纾奸柛灞剧☉缁椦囨煙閻熸澘顏柟鐓庢贡閹叉挳宕熼棃娑欐珡闂傚倸鍊风粈渚€骞夐敓鐘偓锕傚炊椤掆偓缁愭鏌熼幑鎰靛殭闁哄绶氶弻鐔煎箚瑜忛幗鐘裁瑰┃鍨偓婵嬪蓟閻斿吋鐒介柨鏇楀亾闁诲繘浜堕弻锟犲焵椤掍胶顩烽悗锝庡亞閸橀亶姊洪幐搴㈢叆闁圭⒈鍋呮穱濠囨嚃閳哄倸鏋戦梺鍝勵槼濞夋洘鏅跺☉姘辩＜鐎光偓閸曨亝鍠氶梺鎼炲姂缁犳牕鐣烽敐鍡楃窞濠电姴鍊婚崫搴ㄦ⒒閸屾瑧鍔嶉柣顏勭秺瀹曟繂鐣濋埀顒勫焵椤掍礁鍤ù婊呭仱閸┾偓妞ゆ帒瀚☉褔鏌ｉ鐐测偓鎼侇敋閿濆鍋ㄩ柛娑橈攻閸庮亪姊洪懡銈呮瀾濠㈢懓妫濋幃楣冩倷椤掑倻鐦堥梺鍐茬殱閸嬫捇鏌涢幇鈺佸婵炲牄鍔戝娲偂鎼达絼绮甸梺鎼炲妼濞尖€愁嚕椤愩埄鍚嬮柛娑卞灡濞堟洟姊洪崨濠冪８闁告柨鏈粋宥夋倷椤掍礁寮垮┑鈽嗗灥濞咃綁鏁嶅鍥╃＜闁绘ê纾晶鐢告煛鐏炵硶鍋撻幇浣告倯闂佸憡渚楅崰妤呭箖濞嗘挻鈷戦梻鍫氭櫇缁夌敻鏌涢妸銉ヨ埞妞ゎ厼娲╃粻娑樷槈濡⒈鍟嬮梻浣告啞閸旀牞銇愰崘銊愌囧蓟閵夛妇鍘告繝銏ｆ硾閿曪附鏅跺☉銏＄厵闁告稑锕ラ崐鎰偓?(stdio) 濠电姷鏁搁崑鐐哄垂閸洖绠伴柛娑橆煬濞堜粙鏌熼梻瀵割槮濡楀懘姊洪幖鐐插姶闁诲繑鐩幃銏ゆ偂鎼达絼绱滈柣搴ゎ潐濞叉牕煤閻樿纾婚柟鍓х帛閻撱儵鎮楅敐搴″⒒婵炲弶鎮傚娲濞戞艾顣洪柣搴㈠嚬閸ｏ絽螞閸曨偒鍚嬪璺侯儑閸?          </Text>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {plugins.map(item => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: '#f9f9f9', borderRadius: 8, border: '1px solid #eee' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <ApiOutlined style={{ fontSize: 24, color: item.active ? '#1677ff' : '#ccc' }} />
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
              const newPlugin = { id: generateId(), name: '闂傚倸鍊风粈渚€骞栭锕€纾圭紓浣股戝▍鐘充繆閵堝懎顏ュù婊冪秺閺屾盯骞囬妸锔界彇濡?(闂傚倸鍊搁崐鐑芥倿閿曗偓椤灝螣閼测晝鐓嬮梺鍓插亝濞叉﹢宕戦鍫熺厱闁斥晛鍠氶悞浠嬫煃?', command: 'npx', args: '', active: false };
              setPlugins([...plugins, newPlugin]);
            }}
          >
            婵犵數濮烽弫鎼佸磿閹寸姷绀婇柍褜鍓氶妵鍕即閸℃顏柛娆忕箻閺岋綁骞囬浣瑰創濠?MCP 闂傚倸鍊风粈浣革耿鏉堚晛鍨濇い鏍ㄧ矋閺嗘粌鈹戦悩鎻掆偓鐢稿几?
          </Button>
        </div>
      </Modal>
      {/* Skills Modal */}
      <Modal
        title={
          <Space><ApiOutlined /> <span>Agent 闂傚倸鍊烽懗鍫曞箠閹剧粯鍊堕柛顐犲劚绾惧鏌熼崜褏甯涢柣鎾跺█閹宕烽鐐愶絾銇勯妷銉Ш缂佽鲸甯℃俊鎼佸Ω閳轰焦鎳欑紓鍌欑椤戝懘藝閻㈡悶鈧礁顫滈埀顒勫箖濞嗘挻顥堟繛鎴ｉ哺閸?(濠电姷顣藉Σ鍛村磻閸涱収鐔嗘俊顖氱毞閸嬫挸顫濋悡搴ｄ桓闂?</span></Space>
        }
        open={showSkillsModal}
        onCancel={() => setShowSkillsModal(false)}
        footer={null}
        width={700}
      >
        <div style={{ marginTop: 24, maxHeight: '60vh', display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: 16 }}>
            <Input 
              placeholder="闂傚倸鍊烽懗鍫曞箠閹捐瑙﹂悗锝庡墮閸ㄦ繈骞栧ǎ顒€濡肩痪鎯с偢閺屾洘绻涢悙顒佺彅缂備胶濯崳锝夊蓟瀹ュ牜妾ㄩ梺鍛婃尵閸犳牠鐛繝鍋芥棃宕ㄩ鑲╂濠电姰鍨煎▔娑㈩敄閸涙潙鐒垫い鎺嗗亾缁剧虎鍘惧Σ鎰板箳閹惧磭绐為柣蹇曞仧閻℃棃寮抽銏♀拺闁硅偐鍋涙俊鎼佹煕閺冣偓閸ㄥ潡鎮伴鈧獮姗€宕烽鐘虫緫婵犳鍠楅敃鈺呭礈濞戞瑦娅?.." 
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
              <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: '#f8f9fa', borderRadius: 12, border: '1px solid rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flex: 1 }}>
                  <Avatar style={{ backgroundColor: '#e6f4ff', color: '#1677ff' }} icon={<RobotOutlined />} />
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
