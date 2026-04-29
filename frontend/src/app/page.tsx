'use client';

import { useState, useRef, useEffect } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { Button, Input, Modal, Typography, Card, Space, Popconfirm, message, Avatar, Tooltip, Segmented, Popover, Collapse } from 'antd';
import { Markdown, DraggablePanel, SideNav, ActionIcon, Header } from '@lobehub/ui';
import { ChatList } from '@lobehub/ui/chat';
import { SendOutlined, PlusOutlined, MessageOutlined, DeleteOutlined, UserOutlined, LockOutlined, SettingOutlined, ApiOutlined, CheckCircleOutlined, PaperClipOutlined, RobotOutlined, ThunderboltOutlined, BulbOutlined, PlayCircleOutlined, ShareAltOutlined } from '@ant-design/icons';
import { parseMessageContent } from '@/utils/messageParser';
import { ThinkingBlock } from '@/components/chat/ThinkingBlock';
import { PlanStepsCard } from '@/components/chat/PlanStepsCard';
import { WorkspaceFiles } from '@/components/chat/WorkspaceFiles';
import { ToolRenderer } from '@/components/chat/ToolRenderer';
import { ChatInputBox } from '@/components/chat/ChatInputBox';

const { TextArea } = Input;
const { Text } = Typography;

interface ToolCall {
  id: string;
  name: string;
  input: string;
  result?: string;
  error?: string;
  status: 'running' | 'done' | 'error';
}

interface Todo {
  content: string;
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed';
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
}

interface Session {
  id: string;
  title: string;
  messages: Message[];
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
  const [actionReq, setActionReq] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [todos, setTodos] = useState<Todo[]>([]);

  // Plan / Execute 模式切换
  const [agentMode, setAgentMode] = useState<'plan' | 'execute'>('execute');

  // Settings & Plugins
  const [showSettings, setShowSettings] = useState(false);
  const [plugins, setPlugins] = useState([
    { id: '1', name: 'Postgres DB', command: 'npx', args: '-y @modelcontextprotocol/server-postgres', active: true },
    { id: '2', name: 'GitHub Repo', command: 'npx', args: '-y @modelcontextprotocol/server-github', active: false },
  ]);

  const [showSkillsModal, setShowSkillsModal] = useState(false);
  const [skills, setSkills] = useState<{name: string, description: string, path: string}[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillSearch, setSkillSearch] = useState('');

  const loadSkills = async () => {
    setSkillsLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:18008/v1/skills');
      const data = await res.json();
      if (data.status === 'success') setSkills(data.data);
    } catch (err) {
      console.error('Failed to load skills:', err);
      message.error('加载技能列表失败');
    } finally {
      setSkillsLoading(false);
    }
  };

  useEffect(() => {
    if (skills.length === 0) loadSkills();
  }, []);

  const activeSession = sessions.find(s => s.id === activeSessionId);

  const [mounted, setMounted] = useState(false);

  // 初始化检查登录状态
  useEffect(() => {
    setMounted(true);
    const searchParams = new URLSearchParams(window.location.search);
    const isShared = searchParams.get('share') === 'true';
    const sharedSessionId = searchParams.get('session');
    
    if (isShared && sharedSessionId) {
      setShowLogin(false);
      // 直接匿名请求该 session
      loadSessionDetail(sharedSessionId, '', []);
      return;
    }

    const savedToken = localStorage.getItem('claw_token');
    if (savedToken) {
      setToken(savedToken);
      setShowLogin(false);
      loadSessions(savedToken);
    }
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeSession?.messages]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      message.error('文件过大，请上传小于10MB的文件');
      return;
    }

    message.loading({ content: '正在安全传输至沙箱...', key: 'upload' });
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('http://127.0.0.1:18008/v1/sandbox/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('claw_token')}`
        },
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        message.success({ content: `文件已安全存储至沙箱: ${data.files[0]}`, key: 'upload' });
        setInput(prev => prev + `\n\n我已上传文件至沙箱路径：${data.files[0]}，请分析。\n`);
      } else {
        message.error({ content: '上传失败: ' + (data.error || '未知错误'), key: 'upload' });
      }
    } catch (err) {
      message.error({ content: '网络错误，无法连接沙箱', key: 'upload' });
    }
    e.target.value = '';
  };

  const downloadSandboxFile = async (filepath?: string | React.MouseEvent) => {
    let filename = '';
    if (typeof filepath === 'string') {
      filename = filepath;
    } else {
      const input = prompt('请输入沙箱中的完整文件路径 (例如: /workspace/result.txt)');
      if (!input) return;
      filename = input;
    }
    if (!filename) return;
    
    message.loading({ content: '正在从沙箱拉取文件...', key: 'download' });
    try {
      const res = await fetch(`http://127.0.0.1:18008/v1/sandbox/download?path=${filename}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('claw_token')}` }
      });
      if (!res.ok) {
        message.error({ content: '文件不存在或读取失败', key: 'download' });
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
      message.success({ content: '下载成功', key: 'download' });
    } catch (err) {
      message.error({ content: '下载出错', key: 'download' });
    }
  };

  const loadSessions = async (authToken: string) => {
    try {
      const res = await fetch('http://127.0.0.1:18008/v1/sessions', {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!res.ok) {
        if (res.status === 401) handleLogout();
        return;
      }
      const data = await res.json();
      if (data && data.length > 0) {
        // 加载最新会话详情
        loadSessionDetail(data[0].id, authToken, data);
      } else {
        createNewSession();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadSessionDetail = async (id: string, authToken: string, sessionList: any[]) => {
    try {
      const res = await fetch(`http://127.0.0.1:18008/v1/sessions/${id}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (res.ok) {
        const state = await res.json();
        // 解析后端的 state.messages，将连续的 assistant/tool 块合并为一个 assistant bubble
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
            messages.push({ id: Math.random().toString(), role: 'user', content });
          } else if (role === 'assistant') {
            if (!currentAssistant) {
              currentAssistant = { id: Math.random().toString(), role: 'assistant', content: '', toolCalls: [] };
            }
            for (const block of msg.blocks || []) {
              if (block.type === 'text') {
                currentAssistant.content += block.text;
              } else if (block.type === 'tool_use') {
                if (block.name === 'TodoWrite') {
                  try {
                    const inputArgs = typeof block.input === 'string' ? JSON.parse(block.input) : block.input;
                    if (inputArgs.todos) sessionTodos = inputArgs.todos;
                  } catch(e) {}
                }
                currentAssistant.toolCalls!.push({
                  id: block.id || Math.random().toString(),
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
        
        const loadedSession = {
          id,
          title: sessionList.find(s => s.id === id)?.title || '历史会话',
          messages
        };
        
        setTodos(sessionTodos);
        
        setSessions(prev => {
          const list = prev.length > 0 ? prev : sessionList.map(s => ({ id: s.id, title: s.title, messages: [] }));
          const next = list.map(s => s.id === id ? loadedSession : s);
          return next;
        });
        setActiveSessionId(id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogin = async () => {
    if (!email || !password) return message.warning('请输入邮箱和密码');
    setLoginLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:18008/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem('claw_token', data.token);
        setToken(data.token);
        setShowLogin(false);
        message.success(`欢迎回来, ${data.full_name}`);
        loadSessions(data.token);
      } else {
        message.error(data.message || '登录失败，请检查账号密码');
      }
    } catch (e) {
      message.error('网络错误');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('claw_token');
    setToken(null);
    setSessions([]);
    setActiveSessionId('');
    setShowLogin(true);
  };

  const createNewSession = () => {
    const newSession: Session = {
      id: Date.now().toString(),
      title: '新的对话',
      messages: []
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
  };

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`http://127.0.0.1:18008/v1/sessions/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('claw_token')}` }
      });
    } catch(err) {
      console.error(err);
    }
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (next.length === 0) {
        const fresh = { id: Date.now().toString(), title: '新的对话', messages: [] };
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
        const title = (s.title === '新的对话' && newMessages.length > 0) 
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
      await fetch('http://127.0.0.1:18008/v1/chat/resolve_action', {
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
    if (!input.trim() || loading || !activeSession || !token) return;

    const sessionId = activeSessionId;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input };
    const messagesAfterUser = [...activeSession.messages, userMsg];
    updateSessionMessages(sessionId, messagesAfterUser);
    setInput('');
    setLoading(true);

    const assistantMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: '' };
    updateSessionMessages(sessionId, [...messagesAfterUser, assistantMsg]);

    const ctrl = new AbortController();

    try {
      await fetchEventSource('http://127.0.0.1:18008/v1/chat/completions', {
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
        onmessage(ev) {
          if (ev.event === 'done' || ev.data === '[DONE]') {
            setLoading(false);
            ctrl.abort();
            return;
          }
          if (ev.event === 'message') {
            setSessions(prev => prev.map(s => {
              if (s.id === sessionId) {
                const nextMsgs = [...s.messages];
                nextMsgs[nextMsgs.length - 1] = { 
                  ...nextMsgs[nextMsgs.length - 1], 
                  content: nextMsgs[nextMsgs.length - 1].content + ev.data 
                };
                return { ...s, messages: nextMsgs };
              }
              return s;
            }));
          } else if (ev.event === 'tool_call_start') {
            const data = JSON.parse(ev.data);
            if (data.tool === 'TodoWrite') {
              try {
                const inputArgs = JSON.parse(data.input);
                if (inputArgs.todos) setTodos(inputArgs.todos);
              } catch(e) {}
            }
            setSessions(prev => prev.map(s => {
              if (s.id === sessionId) {
                const nextMsgs = [...s.messages];
                const lastMsg = nextMsgs[nextMsgs.length - 1];
                const newToolCall: ToolCall = {
                  id: Math.random().toString(),
                  name: data.tool,
                  input: data.input,
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
          } else if (ev.event === 'tool_call_result') {
            const data = JSON.parse(ev.data);
            setSessions(prev => prev.map(s => {
              if (s.id === sessionId) {
                const nextMsgs = [...s.messages];
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
          } else if (ev.event === 'action_required') {
            const data = JSON.parse(ev.data);
            setActionReq(data);
          }
        },
        onerror(err) {
          console.error('SSE Error:', err);
          setLoading(false);
          ctrl.abort();
          throw err;
        },
      });
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  if (!mounted) return null;

  return (
    <div style={{ height: '100vh', display: 'flex', backgroundColor: '#fff' }}>
      
      {/* 登录弹窗 */}
      <Modal
        title={<Typography.Title level={4} style={{ margin: 0, textAlign: 'center' }}>登录 Claw Agent</Typography.Title>}
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
            placeholder="登录邮箱" 
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <Input.Password 
            size="large" 
            prefix={<LockOutlined />} 
            placeholder="密码" 
            value={password}
            onChange={e => setPassword(e.target.value)}
            onPressEnter={handleLogin}
          />
          <Button type="primary" size="large" block loading={loginLoading} onClick={handleLogin}>
            进入平台
          </Button>
          <Text type="secondary" style={{ textAlign: 'center', fontSize: 12 }}>
            注: 本平台仅限授权用户登录使用，注册请联系管理员。
          </Text>
        </div>
      </Modal>

      {/* 1. Global SideNav */}
      <SideNav
        avatar={<Avatar size={40} style={{ background: '#1677ff', color: '#fff' }}>U</Avatar>}
        topActions={
          <>
            <ActionIcon icon={MessageOutlined} title="会话" active placement="right" />
          </>
        }
        bottomActions={
          <>
            <ActionIcon icon={PlusOutlined} title="新会话" onClick={createNewSession} placement="right" />
            <ActionIcon icon={RobotOutlined} title="技能库中心" onClick={() => setShowSkillsModal(true)} placement="right" />
            <ActionIcon icon={SettingOutlined} title="系统设置" onClick={() => setShowSettings(true)} placement="right" />
            <ActionIcon icon={UserOutlined} title="退出" onClick={handleLogout} placement="right" />
          </>
        }
        style={{ borderRight: '1px solid rgba(0,0,0,0.06)', zIndex: 100 }}
      />

      {/* 2. Session List Panel */}
      <DraggablePanel
        placement="left"
        minWidth={200}
        maxWidth={400}
        defaultSize={{ width: 280 }}
        expandable
        style={{ background: '#f8f9fa', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ padding: '20px 16px 8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Typography.Title level={4} style={{ margin: 0 }}>会话列表</Typography.Title>
            <Button type="dashed" icon={<PlusOutlined />} size="small" onClick={createNewSession}>新建</Button>
          </div>
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
                    if (item.messages.length === 0 && item.title !== '新的对话') {
                       loadSessionDetail(item.id, token!, sessions);
                    }
                  }}
                  style={{
                    padding: '12px 16px',
                    margin: '6px 12px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    background: isActive ? '#fff' : 'transparent',
                    boxShadow: isActive ? '0 2px 8px rgba(0,0,0,0.04)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'all 0.3s ease',
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(0,0,0,0.03)' }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                >
                  <Space style={{ overflow: 'hidden', flex: 1 }}>
                    <MessageOutlined style={{ color: isActive ? '#000' : '#888' }} />
                    <Text ellipsis style={{ width: 140, color: isActive ? '#000' : 'inherit', fontWeight: isActive ? 600 : 400 }}>
                      {item.title}
                    </Text>
                  </Space>
                  <Popconfirm
                    title="确认删除该会话？"
                    onConfirm={(e) => deleteSession(item.id, e as React.MouseEvent)}
                    onCancel={(e) => e?.stopPropagation()}
                    okText="删除"
                    cancelText="取消"
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
      </DraggablePanel>

      {/* 3. Main Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', background: '#fff' }}>
        {/* Header */}
        <div style={{ padding: '16px 24px', background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', whiteSpace: 'nowrap' }}>
            <Text strong style={{ fontSize: 16 }}>{activeSession?.title}</Text>
            <Text type="secondary" style={{ marginLeft: 16, fontSize: 12 }}>
              {activeSession?.messages.length || 0} 条消息
            </Text>
          </div>
          <Space style={{ whiteSpace: 'nowrap' }}>
            <Tooltip title="分享会话">
              <ActionIcon 
                icon={ShareAltOutlined} 
                onClick={async () => {
                  try {
                    const shareUrl = `${window.location.origin}/?session=${activeSession?.id}&share=true`;
                    await navigator.clipboard.writeText(shareUrl);
                    message.success('分享链接已复制到剪贴板，他人可通过只读模式查看！');
                  } catch (e) {
                    message.error('复制失败');
                  }
                }} 
              />
            </Tooltip>
          </Space>
        </div>

        {/* Chat Area */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {(!activeSession || activeSession.messages.length === 0) && (
               <div style={{ textAlign: 'center', marginTop: 100 }}>
                 <Typography.Title level={3} style={{ color: '#ccc' }}>有什么我可以帮您的？</Typography.Title>
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
                    createAt: Date.now(),
                    meta: {
                      avatar: msg.role === 'user' ? '🧑‍💻' : '🤖',
                      title: msg.role === 'user' ? 'You' : 'Claw Agent',
                    },
                    extra: {
                      toolCalls: msg.toolCalls,
                      parsed
                    }
                  } as any
                })}
                renderMessages={{
                  user: ({ content }) => {
                    const uploadRegex = /我已上传文件至沙箱路径：([^\s，]+)，请分析。/;
                    const match = content.match(uploadRegex);
                    
                    if (match) {
                      const cleanContent = content.replace(uploadRegex, '').trim();
                      const filePath = match[1];
                      const fileName = filePath.split('/').pop() || filePath;
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                          {cleanContent && <div style={{ whiteSpace: 'pre-wrap' }}>{cleanContent}</div>}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(0,0,0,0.04)', borderRadius: 8 }}>
                            <PaperClipOutlined style={{ color: '#1677ff', fontSize: 16 }} />
                            <Text strong style={{ fontSize: 13 }}>{fileName}</Text>
                          </div>
                        </div>
                      );
                    }
                    return <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>;
                  },
                  assistant: ({ content, extra }) => {
                    const parsed = extra?.parsed;
                    return (
                      <div style={{ wordBreak: 'break-word', lineHeight: 1.6 }}>
                        <ThinkingBlock content={parsed?.thinkingBlock} />
                        <Markdown>{parsed?.cleanContent || ''}</Markdown>
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
                            setInput(`请执行以下步骤：\n${fullBlock}`);
                            setAgentMode('execute');
                          }} 
                        />
                        <WorkspaceFiles 
                          files={parsed?.workspaceFiles || []} 
                          onDownload={downloadSandboxFile} 
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
               <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <Text type="secondary" style={{ fontStyle: 'italic' }}>Agent 正在处理...</Text>
               </div>
            )}
          </div>
        </div>

        {/* Input Area */}
        <div style={{ padding: '0 24px 32px', background: 'transparent' }}>
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
        expandable
        style={{ background: '#f8f9fa', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid rgba(0,0,0,0.04)', background: 'transparent' }}>
          <Typography.Title level={5} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <BulbOutlined style={{ color: '#faad14' }} /> 当前计划 (Todos)
          </Typography.Title>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {todos.length === 0 ? (
            <div style={{ textAlign: 'center', marginTop: 40 }}>
              <Text type="secondary" style={{ fontSize: 13 }}>暂无计划，你可以让 Agent 帮你生成执行计划。</Text>
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
      </DraggablePanel>

      {/* Action Prompt Modal */}
      <Modal
        title={
          <Space><span style={{ fontSize: 20 }}>⚠️</span> <span>安全拦截：工具调用授权</span></Space>
        }
        open={!!actionReq}
        closable={false}
        keyboard={false}
        mask={{ closable: false }}
        footer={null}
        width={500}
      >
        <p style={{ marginTop: 16 }}>Agent 正在尝试执行敏感操作，环境已被自动挂起，等待您的授权指令。</p>
        <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', padding: 16, borderRadius: 8, marginBottom: 24, marginTop: 16 }}>
          <p style={{ margin: '0 0 8px' }}><strong>工具名称：</strong> <Text code>{actionReq?.tool}</Text></p>
          <p style={{ margin: '0 0 8px' }}><strong>防护级别：</strong> <Text type="danger">{actionReq?.required_mode}</Text></p>
          <p style={{ margin: 0 }}><strong>拦截原因：</strong> <Text type="secondary">{actionReq?.message}</Text></p>
        </div>
        <Space style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
          <Button danger onClick={() => handleResolveAction(false)}>拒绝并中止任务</Button>
          <Button type="primary" onClick={() => handleResolveAction(true)}>允许单次执行</Button>
        </Space>
      </Modal>

      {/* Settings Modal */}
      <Modal
        title={
          <Space><SettingOutlined /> <span>系统设置 & 插件管理</span></Space>
        }
        open={showSettings}
        onCancel={() => setShowSettings(false)}
        footer={null}
        width={700}
      >
        <div style={{ marginTop: 24 }}>
          <Typography.Title level={5}>已配置的 MCP 服务器 (内部安全插件)</Typography.Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            此处配置的插件将原生运行在受信任的主机环境中，通过标准输入输出 (stdio) 与大模型交互。
          </Text>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {plugins.map(item => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: '#f9f9f9', borderRadius: 8, border: '1px solid #eee' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <ApiOutlined style={{ fontSize: 24, color: item.active ? '#1677ff' : '#ccc' }} />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Text strong>{item.name}</Text>
                      {item.active && <Text type="success" style={{ fontSize: 12 }}><CheckCircleOutlined /> 运行中</Text>}
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
                    {item.active ? '禁用' : '启用'}
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
              const newPlugin = { id: Date.now().toString(), name: '新插件 (配置中)', command: 'npx', args: '', active: false };
              setPlugins([...plugins, newPlugin]);
            }}
          >
            添加新 MCP 插件
          </Button>
        </div>
      </Modal>
      {/* Skills Modal */}
      <Modal
        title={
          <Space><ApiOutlined /> <span>Agent 技能库中心 (预览)</span></Space>
        }
        open={showSkillsModal}
        onCancel={() => setShowSkillsModal(false)}
        footer={null}
        width={700}
      >
        <div style={{ marginTop: 24, maxHeight: '60vh', display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: 16 }}>
            <Input 
              placeholder="搜索技能名称或描述..." 
              value={skillSearch}
              onChange={e => setSkillSearch(e.target.value)}
              allowClear
            />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {skillsLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">加载中...</Text></div>
            ) : skills.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">暂无可用技能</Text></div>
            ) : skills.filter(s => s.name.toLowerCase().includes(skillSearch.toLowerCase()) || s.description.toLowerCase().includes(skillSearch.toLowerCase())).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">未搜索到相关技能</Text></div>
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
