'use client';

import { useState, useRef, useEffect } from 'react';
import { Button, Input, Modal, Typography, Space, Avatar, App as AntdApp, Tooltip, Radio, Layout, Tag, theme } from 'antd';
import { Bubble, Conversations, Welcome, Prompts, Sender } from '@ant-design/x';
import { PlusOutlined, DeleteOutlined, UserOutlined, LockOutlined, PaperClipOutlined, RobotOutlined, ShareAltOutlined, CopyOutlined, MenuFoldOutlined, MenuUnfoldOutlined, FolderOutlined, FileOutlined, ReloadOutlined, ThunderboltOutlined, CodeOutlined, FileSearchOutlined, RocketOutlined } from '@ant-design/icons';
import { parseMessageContent } from '@/utils/messageParser';
import { ThinkingBlock } from '@/components/chat/ThinkingBlock';
import { PlanStepsCard } from '@/components/chat/PlanStepsCard';
import { WorkspaceFiles } from '@/components/chat/WorkspaceFiles';
import { ToolRenderer } from '@/components/chat/ToolRenderer';
import { useAuth } from '@/hooks/useAuth';
import { useSessions } from '@/hooks/useSessions';
import { useChatStream } from '@/hooks/useChatStream';
import { useWorkspace } from '@/hooks/useWorkspace';
import ReactMarkdown from 'react-markdown';

const { Text } = Typography;
const { Sider, Header, Content } = Layout;
const { useToken } = theme;

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return true;
  } catch {
    return false;
  }
};

const UPLOADED_WORKSPACE_PREFIX = 'Uploaded workspace files: ';
const UPLOADED_WORKSPACE_SUFFIX = ' Please continue with the current session.';

const buildUploadedWorkspacePrompt = (files: string[]) =>
  `${UPLOADED_WORKSPACE_PREFIX}${files.join(', ')}${UPLOADED_WORKSPACE_SUFFIX}`;

const parseUploadedWorkspacePrompt = (content: string) => {
  if (!content.includes(UPLOADED_WORKSPACE_PREFIX) || !content.endsWith(UPLOADED_WORKSPACE_SUFFIX)) return null;
  const start = content.lastIndexOf(UPLOADED_WORKSPACE_PREFIX);
  if (start < 0) return null;
  const filesStart = start + UPLOADED_WORKSPACE_PREFIX.length;
  const filesEnd = content.length - UPLOADED_WORKSPACE_SUFFIX.length;
  const files = content.slice(filesStart, filesEnd).split(/\s*[,，]\s*/).map(i => i.trim()).filter(Boolean);
  if (files.length === 0) return null;
  const cleanContent = `${content.slice(0, start)}${content.slice(filesEnd + UPLOADED_WORKSPACE_SUFFIX.length)}`.trim();
  return { cleanContent, files };
};

interface SkillInfo { name: string; description: string; path: string; }
interface ActionRequest { action_id: string; tool?: string; required_mode?: string; message?: string; }

export default function ChatPage() {
  const { message } = AntdApp.useApp();
  const { token: themeToken } = useToken();

  // --- Hooks ---
  const {
    token, setToken, showLogin, setShowLogin,
    email, setEmail, password, setPassword,
    loginLoading, fullName, handleLogin, handleLogout,
  } = useAuth({
    onLoginSuccess: (t, fullName) => { message.success(`Signed in as ${fullName}`); loadSessions(t); },
    onLogout: () => { setSessions([]); setActiveSessionId(''); },
    onError: (msg) => message.error(msg),
  });

  const {
    sessions, setSessions, activeSessionId, setActiveSessionId, activeSession,
    loadingRef, streamingSessionRef,
    withAssistantTail, updateSessionMessages,
    createNewSession, deleteSession,
    loadSessionDetail, loadSessions: loadSessionsRaw,
  } = useSessions(token, handleLogout);

  const loadSessions = (authToken: string) => loadSessionsRaw(authToken);

  const {
    workspaceFiles, workspaceFilesLoading,
    workspaceSubPath, setWorkspaceSubPath,
    loadWorkspaceFiles, downloadWorkspaceFileFromSidebar, downloadWorkspaceFile,
  } = useWorkspace(activeSessionId);

  // --- Local UI state ---
  const [input, setInput] = useState('');
  const [actionReq, setActionReq] = useState<ActionRequest | null>(null);
  const [questionReq, setQuestionReq] = useState<{ question_id: string; question: string; options?: string[] } | null>(null);
  const [questionAnswer, setQuestionAnswer] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [agentMode] = useState<'plan' | 'execute'>('execute');
  const [loading, setLoading] = useState(false);
  const [isSharedView, setIsSharedView] = useState(false);
  const [leftExpand, setLeftExpand] = useState(true);
  const [rightExpand, setRightExpand] = useState(true);
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  const {
    activeToolName, activeToolSummary, sendMessage: sendMessageRaw,
  } = useChatStream({
    token, sessions, activeSessionId, activeSession,
    setSessions, setActiveSessionId,
    streamingSessionRef, loadingRef, setLoading,
    withAssistantTail, updateSessionMessages,
    loadSessionDetail, loadWorkspaceFiles,
    workspaceSubPath, agentMode,
    onError: (msg) => message.error(msg),
    onActionRequired: (data) => setActionReq(data),
    onQuestionRequired: (data) => { setQuestionReq(data); setQuestionAnswer(''); },
  });

  // --- Local functions ---
  const loadSkills = async () => {
    try {
      const res = await fetch(apiUrl('/v1/skills'));
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === 'success') setSkills(data.data);
    } catch {}
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { message.error('File too large (max 10MB).'); return; }
    message.loading({ content: 'Uploading...', key: 'upload' });
    const formData = new FormData();
    formData.append('file', file);
    try {
      if (!activeSessionId) { message.error({ content: 'Select a session first.', key: 'upload' }); return; }
      const params = new URLSearchParams({ session_id: activeSessionId });
      const res = await fetch(apiUrl(`/v1/sandbox/upload?${params}`), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('claw_token')}` },
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const nextFiles = Array.isArray(data.files) ? data.files.filter(Boolean) : [];
        message.success({ content: `Uploaded: ${nextFiles[0] ?? file.name}`, key: 'upload' });
        setUploadedFiles(prev => Array.from(new Set([...prev, ...nextFiles])));
      } else {
        message.error({ content: 'Upload failed: ' + (data.error || 'Unknown'), key: 'upload' });
      }
    } catch { message.error({ content: 'Network error', key: 'upload' }); }
    e.target.value = '';
  };

  const handleResolveAction = async (allow: boolean) => {
    if (!actionReq || !token) return;
    try {
      await fetch(apiUrl('/v1/chat/resolve_action'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action_id: actionReq.action_id, allow, reason: allow ? undefined : "User denied request" }),
      });
      setActionReq(null);
    } catch {}
  };

  const handleResolveQuestion = async () => {
    if (!questionReq || !token || !questionAnswer.trim()) return;
    try {
      await fetch(apiUrl('/v1/chat/resolve_question'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ question_id: questionReq.question_id, answer: questionAnswer.trim() }),
      });
      setQuestionReq(null); setQuestionAnswer('');
    } catch {}
  };

  const sendMessage = (msg?: string) => {
    const rawInput = msg ?? input;
    if ((!rawInput.trim() && uploadedFiles.length === 0) || loadingRef.current || !activeSession || !token) return;
    let finalInput = rawInput;
    for (const skill of skills) {
      const skillName = skill.name.includes('/') ? skill.name.split('/').pop()! : skill.name;
      finalInput = finalInput.replace(new RegExp(`/${skillName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'g'), `请使用 ${skill.name} 技能$1`);
    }
    if (uploadedFiles.length > 0) {
      finalInput += (finalInput ? '\n\n' : '') + buildUploadedWorkspacePrompt(uploadedFiles);
    }
    setUploadedFiles([]); setInput('');
    void sendMessageRaw(finalInput);
  };

  // --- Effects ---
  useEffect(() => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      if (scrollHeight - scrollTop - clientHeight < 150) scrollRef.current.scrollTop = scrollHeight;
    }
  }, [activeSession?.messages]);

  useEffect(() => { if (skills.length === 0) queueMicrotask(() => void loadSkills()); }, [skills.length]);
  useEffect(() => { if (activeSessionId) void loadWorkspaceFiles(workspaceSubPath || undefined); }, [activeSessionId]);

  useEffect(() => {
    queueMicrotask(() => {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('share') === 'true' && sp.get('session')) {
        setIsSharedView(true); setShowLogin(false);
        void loadSessionDetail(sp.get('session')!, '', []);
        return;
      }
      const savedToken = localStorage.getItem('claw_token');
      if (savedToken) { setToken(savedToken); setShowLogin(false); void loadSessions(savedToken); }
    });
  }, []);

  useEffect(() => {
    if (!token || !activeSessionId || !loading) return;
    if (streamingSessionRef.current === activeSessionId) return;
    const timer = window.setInterval(() => void loadSessionDetail(activeSessionId, token, sessions), 2000);
    return () => window.clearInterval(timer);
  }, [activeSessionId, loading, sessions, token]);

  // --- Conversations items ---
  const conversationItems = sessions.map(s => ({ key: s.id, label: s.title }));
  const handleConversationMenu = (item: { key: string }) => ({
    items: [{ key: 'delete', label: '删除', danger: true, icon: <DeleteOutlined /> }],
    onClick: ({ key }: { key: string }) => { if (key === 'delete') deleteSession(item.key, {} as React.MouseEvent); },
  });

  // --- Prompt suggestions for welcome screen ---
  const promptItems = [
    { key: 'code', icon: <CodeOutlined />, label: 'Write code', description: 'Generate, review, or refactor code' },
    { key: 'debug', icon: <ThunderboltOutlined />, label: 'Debug & fix', description: 'Find and fix bugs in your project' },
    { key: 'analyze', icon: <FileSearchOutlined />, label: 'Analyze files', description: 'Read and analyze workspace files' },
    { key: 'deploy', icon: <RocketOutlined />, label: 'Run commands', description: 'Execute shell commands and scripts' },
  ];

  // --- Styles (using theme tokens) ---
  const siderStyle: React.CSSProperties = {
    background: themeToken.colorBgContainer,
    borderRight: `1px solid ${themeToken.colorBorderSecondary}`,
  };
  const headerStyle: React.CSSProperties = {
    background: themeToken.colorBgContainer,
    borderBottom: `1px solid ${themeToken.colorBorderSecondary}`,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 24px', height: 56, lineHeight: '56px',
  };

  // --- Render ---
  return (
    <Layout style={{ height: '100vh', background: themeToken.colorBgLayout }}>

      {/* Login modal */}
      <Modal open={showLogin} closable={false} keyboard={false} mask={{ closable: false }} footer={null} width={400} styles={{ body: { padding: '32px 32px 28px' } }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ marginBottom: 16 }}>
            <Avatar size={56} style={{ background: `linear-gradient(135deg, ${themeToken.colorPrimary}, #7c3aed)`, borderRadius: 14 }} icon={<RobotOutlined />} />
          </div>
          <Typography.Title level={3} style={{ margin: '0 0 8px', fontSize: 22 }}>Claw Agent</Typography.Title>
          <Text type="secondary">Sign in to start building</Text>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input size="large" prefix={<UserOutlined style={{ color: themeToken.colorTextQuaternary }} />} placeholder="Work email" value={email} onChange={e => setEmail(e.target.value)} allowClear />
          <Input.Password size="large" prefix={<LockOutlined style={{ color: themeToken.colorTextQuaternary }} />} placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onPressEnter={handleLogin} allowClear />
          <Button type="primary" size="large" block loading={loginLoading} onClick={handleLogin} style={{ height: 44, fontWeight: 600, marginTop: 4 }}>Sign in</Button>
        </div>
        <div style={{ marginTop: 20, padding: '12px 16px', background: themeToken.colorFillQuaternary, borderRadius: themeToken.borderRadius }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>💡</span>
            <div>
              <Text style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Default account</Text>
              <Text type="secondary" style={{ fontSize: 11, display: 'block', lineHeight: 1.6 }}>
                Email: your work email<br />
                Password: <Text code style={{ fontSize: 11, background: themeToken.colorFillSecondary, padding: '1px 4px', borderRadius: 3 }}>Abc123456!</Text>
              </Text>
            </div>
          </div>
        </div>
      </Modal>

      {/* Left Sidebar */}
      {!isSharedView && (
        <Sider width={280} collapsed={!leftExpand} collapsedWidth={0} theme="light" style={siderStyle} trigger={null}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Brand header */}
            <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Space size={10}>
                <Avatar shape="square" size={30} style={{ background: themeToken.colorPrimary, borderRadius: 8 }} icon={<RobotOutlined />} />
                <Text strong style={{ fontSize: 15 }}>Claw Agent</Text>
              </Space>
              <Button type="text" size="small" icon={<MenuFoldOutlined />} onClick={() => setLeftExpand(false)} style={{ color: themeToken.colorTextQuaternary }} />
            </div>

            {/* New Chat button */}
            <div style={{ padding: '4px 12px 12px' }}>
              <Button block icon={<PlusOutlined />} onClick={createNewSession} style={{ height: 38, borderRadius: themeToken.borderRadiusLG }}>
                New Chat
              </Button>
            </div>

            {/* Session list */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <Conversations
                items={conversationItems}
                activeKey={activeSessionId}
                onActiveChange={(key) => {
                  setActiveSessionId(key);
                  const session = sessions.find(s => s.id === key);
                  if (session && session.messages.length === 0 && session.title !== 'New Chat') void loadSessionDetail(key, token!, sessions);
                }}
                menu={handleConversationMenu}
              />
            </div>

            {/* User profile bar */}
            <div style={{ padding: '12px 16px', borderTop: `1px solid ${themeToken.colorBorderSecondary}`, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar size={32} style={{ background: `linear-gradient(135deg, ${themeToken.colorPrimary}, #7c3aed)` }} icon={<UserOutlined />} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text strong style={{ fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fullName}</Text>
                <Text type="secondary" style={{ fontSize: 11 }}>{email || 'Signed in'}</Text>
              </div>
              <Tooltip title="Sign out">
                <Button type="text" size="small" onClick={handleLogout} style={{ color: themeToken.colorTextQuaternary }}>⏻</Button>
              </Tooltip>
            </div>
          </div>
        </Sider>
      )}

      {/* Main Area */}
      <Layout style={{ background: themeToken.colorBgContainer }}>
        {/* Header */}
        <Header style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {!leftExpand && !isSharedView && (
              <Button type="text" icon={<MenuUnfoldOutlined />} onClick={() => setLeftExpand(true)} />
            )}
            {!leftExpand && (
              <Avatar shape="square" size={28} style={{ background: themeToken.colorPrimary, borderRadius: 6 }} icon={<RobotOutlined />} />
            )}
            <Text strong style={{ fontSize: 15 }}>{isSharedView ? 'Claw Agent' : (activeSession?.title || 'Claw Agent')}</Text>
          </div>
          {isSharedView ? (
            <Button type="primary" size="small" onClick={() => { window.location.href = '/'; }}>Sign in</Button>
          ) : (
            <Space>
              <Tooltip title="Share link">
                <Button type="text" icon={<ShareAltOutlined />} onClick={async () => {
                  const shareUrl = `${window.location.origin}/?session=${activeSession?.id}&share=true`;
                  if (await copyToClipboard(shareUrl)) message.success('Share link copied'); else message.error('Copy failed');
                }} />
              </Tooltip>
              {!rightExpand && (
                <Tooltip title="Workspace">
                  <Button type="text" icon={<FolderOutlined />} onClick={() => setRightExpand(true)} />
                </Tooltip>
              )}
            </Space>
          )}
        </Header>

        {/* Chat Content */}
        <Content style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '24px 0' }}>
            <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 24px' }}>

              {/* Empty state */}
              {(!activeSession || activeSession.messages.length === 0) && (
                <div style={{ paddingTop: 80 }}>
                  <Welcome
                    icon={<RobotOutlined />}
                    title="Hello, I'm Claw Agent"
                    description="I can write code, run commands, analyze files, and more. Start a conversation below."
                    variant="borderless"
                    style={{ marginBottom: 32 }}
                  />
                  <Prompts
                    items={promptItems}
                    onItemClick={({ data }) => setInput(`Help me with: ${data.label}`)}
                    wrap
                  />
                </div>
              )}

              {/* Messages */}
              {activeSession && activeSession.messages.length > 0 && (
                <Bubble.List
                  autoScroll
                  role={{
                    user: {
                      placement: 'end',
                      variant: 'filled',
                      contentRender: (content: string) => {
                        const uploadedPrompt = parseUploadedWorkspacePrompt(content);
                        const handleCopy = async () => { await copyToClipboard(content) ? message.success('Copied') : message.error('Failed'); };
                        if (uploadedPrompt) {
                          return (
                            <div className="msg-hover-copy" style={{ position: 'relative' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                                {uploadedPrompt.cleanContent && <div style={{ whiteSpace: 'pre-wrap' }}>{uploadedPrompt.cleanContent}</div>}
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                  {uploadedPrompt.files.map(fp => (
                                    <div key={fp} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: themeToken.colorFillQuaternary, borderRadius: themeToken.borderRadius }}>
                                      <PaperClipOutlined style={{ color: themeToken.colorPrimary }} />
                                      <Text style={{ fontSize: 13 }}>{fp.split('/').pop()}</Text>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopy} className="copy-btn" style={{ position: 'absolute', top: -4, right: -4, opacity: 0 }} />
                            </div>
                          );
                        }
                        return (
                          <div className="msg-hover-copy" style={{ position: 'relative' }}>
                            <div style={{ whiteSpace: 'pre-wrap', paddingRight: 28 }}>{content}</div>
                            <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopy} className="copy-btn" style={{ position: 'absolute', top: 0, right: 0, opacity: 0 }} />
                          </div>
                        );
                      },
                    },
                    ai: {
                      placement: 'start',
                      avatar: <Avatar icon={<RobotOutlined />} style={{ background: themeToken.colorPrimary }} />,
                      typing: { effect: 'typing', step: 5, interval: 50 },
                      contentRender: (content: string, info) => {
                        const parsed = parseMessageContent(content || '');
                        const isStreaming = info.status === 'loading' || info.status === 'updating';
                        const handleCopy = async () => { await copyToClipboard(parsed.cleanContent) ? message.success('Copied') : message.error('Failed'); };
                        return (
                          <div className="msg-hover-copy" style={{ position: 'relative', lineHeight: 1.7 }}>
                            <ThinkingBlock content={parsed.thinkingBlock} isStreaming={isStreaming} />
                            <div style={{ paddingRight: 28 }}>
                              <ReactMarkdown>{parsed.cleanContent || ''}</ReactMarkdown>
                            </div>
                            <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopy} className="copy-btn" style={{ position: 'absolute', top: 0, right: 0, opacity: 0 }} />
                          </div>
                        );
                      },
                      footer: (_content: string, info) => {
                        const toolCalls = info.extraInfo?.toolCalls;
                        const parsed = parseMessageContent(_content || '');
                        const hasPlanSteps = parsed.planSteps.length >= 2;
                        const hasFiles = parsed.workspaceFiles.length > 0;
                        const hasTools = Array.isArray(toolCalls) && toolCalls.length > 0;
                        if (!hasPlanSteps && !hasFiles && !hasTools) return null;
                        return (
                          <div style={{ marginTop: 8 }}>
                            {hasPlanSteps && <PlanStepsCard steps={parsed.planSteps} onExecuteStep={(fb) => setInput(`Please execute:\n\n${fb}`)} />}
                            {hasFiles && <WorkspaceFiles files={parsed.workspaceFiles} onDownload={downloadWorkspaceFile} />}
                            {hasTools && <ToolRenderer toolCalls={toolCalls} />}
                          </div>
                        );
                      },
                    },
                  }}
                  items={activeSession.messages.map(msg => ({
                    key: msg.id,
                    role: msg.role === 'user' ? 'user' : 'ai',
                    content: msg.content || ' ',
                    loading: loading && activeSession.messages[activeSession.messages.length - 1]?.id === msg.id,
                    extraInfo: { toolCalls: msg.toolCalls },
                  }))}
                />
              )}

              {/* Loading indicator when no messages yet */}
              {loading && (!activeSession || activeSession.messages.length === 0) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0' }}>
                  <Bubble.List
                    items={[{ key: 'loading', role: 'ai', content: '', loading: true }]}
                    role={{ ai: { placement: 'start', avatar: <Avatar icon={<RobotOutlined />} style={{ background: themeToken.colorPrimary }} /> } }}
                  />
                  {activeToolName && (
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      Running <Text strong>{activeToolName}</Text>
                      {activeToolSummary && <span> — {activeToolSummary}</span>}
                    </Text>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Input Area */}
          {isSharedView ? (
            <div style={{ padding: '24px 32px', textAlign: 'center', borderTop: `1px solid ${themeToken.colorBorderSecondary}` }}>
              <Space style={{ marginBottom: 12 }}>
                <RobotOutlined style={{ color: themeToken.colorPrimary }} />
                <Text type="secondary">Want to try it out?</Text>
              </Space>
              <div><Button type="primary" onClick={() => { window.location.href = '/'; }}>Sign in to get started</Button></div>
            </div>
          ) : (
            <div style={{ padding: '0 24px 24px' }}>
              {uploadedFiles.length > 0 && (
                <div style={{ maxWidth: 860, margin: '0 auto', marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {uploadedFiles.map(f => (
                    <Tag key={f} closable onClose={() => setUploadedFiles(p => p.filter(x => x !== f))} icon={<PaperClipOutlined />} color="blue" style={{ padding: '4px 10px', borderRadius: 16, fontSize: 13 }}>
                      {f.split('/').pop()}
                    </Tag>
                  ))}
                </div>
              )}
              <Sender
                value={input}
                onChange={setInput}
                onSubmit={(val) => { if (val.trim()) sendMessage(val); }}
                onCancel={() => {}}
                loading={loading}
                placeholder="从任务或问题开始... 按 Shift + Enter 换行"
                style={{ maxWidth: 860, margin: '0 auto', borderRadius: themeToken.borderRadiusLG }}
                prefix={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <PaperClipOutlined
                      style={{ fontSize: 18, cursor: 'pointer', color: themeToken.colorTextQuaternary }}
                      title="Upload file"
                      onClick={() => document.getElementById('file-upload-input')?.click()}
                    />
                    <input type="file" id="file-upload-input" style={{ display: 'none' }} onChange={handleFileUpload} />
                  </div>
                }
              />
            </div>
          )}
        </Content>
      </Layout>

      {/* Right Sidebar: Workspace */}
      {!isSharedView && (
        <Sider width={280} collapsed={!rightExpand} collapsedWidth={0} theme="light" style={{ background: themeToken.colorBgContainer }} trigger={null}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '16px', borderBottom: `1px solid ${themeToken.colorBorderSecondary}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text strong style={{ fontSize: 15 }}>Workspace</Text>
              <Button type="text" size="small" icon={<MenuUnfoldOutlined />} onClick={() => setRightExpand(false)} style={{ color: themeToken.colorTextQuaternary }} />
            </div>
            <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: themeToken.colorFillQuaternary }}>
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Files {workspaceSubPath && `/ ${workspaceSubPath}`}
              </Text>
              <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => loadWorkspaceFiles(workspaceSubPath || undefined)} loading={workspaceFilesLoading} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
              {workspaceSubPath && (
                <div style={{ padding: '6px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: themeToken.colorPrimary }}
                  onClick={() => { setWorkspaceSubPath(''); void loadWorkspaceFiles(); }}>
                  <FolderOutlined /> ..
                </div>
              )}
              {workspaceFiles.length === 0 && !workspaceFilesLoading ? (
                <div style={{ textAlign: 'center', padding: '32px 16px' }}>
                  <FolderOutlined style={{ fontSize: 32, color: themeToken.colorBorder, marginBottom: 8 }} />
                  <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                    {!activeSessionId ? 'Select a session' : workspaceSubPath === 'output' ? 'No result files yet' : 'No files here'}
                  </Text>
                </div>
              ) : (
                workspaceFiles.map((file, idx) => (
                  <Tooltip key={idx} title={file.is_dir ? 'Open folder' : 'Download'} placement="left">
                    <div className="workspace-file-item"
                      style={{ padding: '6px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, borderRadius: 4, margin: '1px 4px' }}
                      onClick={() => { file.is_dir ? (setWorkspaceSubPath(file.path), void loadWorkspaceFiles(file.path)) : downloadWorkspaceFileFromSidebar(file.path); }}>
                      {file.is_dir ? <FolderOutlined style={{ color: themeToken.colorWarning, fontSize: 14 }} /> : <FileOutlined style={{ color: themeToken.colorTextQuaternary, fontSize: 14 }} />}
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                      {!file.is_dir && <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{file.size < 1024 ? `${file.size}B` : file.size < 1048576 ? `${(file.size/1024).toFixed(1)}K` : `${(file.size/1048576).toFixed(1)}M`}</Text>}
                    </div>
                  </Tooltip>
                ))
              )}
            </div>
          </div>
        </Sider>
      )}

      {/* Action Prompt Modal */}
      <Modal title={<span style={{ fontSize: 18 }}>Permission Request</span>} open={!!actionReq} closable={false} keyboard={false} mask={{ closable: false }} footer={null} width={480}>
        <p style={{ marginTop: 16, color: themeToken.colorTextSecondary }}>The agent needs approval before running this action.</p>
        <div style={{ background: themeToken.colorFillQuaternary, border: `1px solid ${themeToken.colorBorderSecondary}`, padding: 16, borderRadius: themeToken.borderRadius, margin: '16px 0 24px' }}>
          <p style={{ margin: '0 0 8px' }}><strong>Tool:</strong> <Text code>{actionReq?.tool}</Text></p>
          <p style={{ margin: '0 0 8px' }}><strong>Mode:</strong> <Text type="danger">{actionReq?.required_mode}</Text></p>
          <p style={{ margin: 0 }}><strong>Reason:</strong> <Text type="secondary">{actionReq?.message}</Text></p>
        </div>
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button danger onClick={() => handleResolveAction(false)}>Reject</Button>
          <Button type="primary" onClick={() => handleResolveAction(true)}>Approve</Button>
        </Space>
      </Modal>

      {/* Agent Question Modal */}
      <Modal title={<span style={{ fontSize: 18 }}>Agent Question</span>} open={!!questionReq} closable={false} keyboard={false} mask={{ closable: false }} footer={null} width={480}>
        <p style={{ marginTop: 16 }}>{questionReq?.question}</p>
        {questionReq?.options && questionReq.options.length > 0 ? (
          <Radio.Group value={questionAnswer} onChange={e => setQuestionAnswer(e.target.value)} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
            {questionReq.options.map((opt, i) => <Radio key={i} value={opt}>{opt}</Radio>)}
          </Radio.Group>
        ) : (
          <Input.TextArea value={questionAnswer} onChange={e => setQuestionAnswer(e.target.value)} placeholder="Type your answer..." rows={3} style={{ marginTop: 16 }} />
        )}
        <Space style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <Button type="primary" disabled={!questionAnswer.trim()} onClick={handleResolveQuestion}>Submit</Button>
        </Space>
      </Modal>
    </Layout>
  );
}
