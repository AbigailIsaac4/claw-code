'use client';

import { useState, useRef, useEffect } from 'react';
import { Button, Input, Modal, Typography, Space, Avatar, App as AntdApp, Tooltip, Radio, Layout, Tag } from 'antd';
import { Bubble, Conversations } from '@ant-design/x';
import { PlusOutlined, DeleteOutlined, UserOutlined, LockOutlined, PaperClipOutlined, RobotOutlined, ShareAltOutlined, CopyOutlined, MenuFoldOutlined, MenuUnfoldOutlined, FolderOutlined, FileOutlined, ReloadOutlined } from '@ant-design/icons';
import { parseMessageContent } from '@/utils/messageParser';
import { ThinkingBlock } from '@/components/chat/ThinkingBlock';
import { PlanStepsCard } from '@/components/chat/PlanStepsCard';
import { WorkspaceFiles } from '@/components/chat/WorkspaceFiles';
import { ChatInputBox } from '@/components/chat/ChatInputBox';
import { colors } from '@/styles/tokens';
import { useAuth } from '@/hooks/useAuth';
import { useSessions } from '@/hooks/useSessions';
import { useChatStream } from '@/hooks/useChatStream';
import { useWorkspace } from '@/hooks/useWorkspace';
import ReactMarkdown from 'react-markdown';

const { Text } = Typography;
const { Sider, Header, Content } = Layout;

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
  if (!content.includes(UPLOADED_WORKSPACE_PREFIX) || !content.endsWith(UPLOADED_WORKSPACE_SUFFIX)) {
    return null;
  }
  const start = content.lastIndexOf(UPLOADED_WORKSPACE_PREFIX);
  if (start < 0) return null;
  const filesStart = start + UPLOADED_WORKSPACE_PREFIX.length;
  const filesEnd = content.length - UPLOADED_WORKSPACE_SUFFIX.length;
  const files = content
    .slice(filesStart, filesEnd)
    .split(/\s*[,，]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (files.length === 0) return null;
  const cleanContent = `${content.slice(0, start)}${content.slice(filesEnd + UPLOADED_WORKSPACE_SUFFIX.length)}`.trim();
  return { cleanContent, files };
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
  const { message } = AntdApp.useApp();

  // --- Hooks ---
  const {
    token, setToken, showLogin, setShowLogin,
    email, setEmail, password, setPassword,
    loginLoading, fullName, handleLogin, handleLogout,
  } = useAuth({
    onLoginSuccess: (t, fullName) => {
      message.success(`Signed in as ${fullName}`);
      loadSessions(t);
    },
    onLogout: () => {
      setSessions([]);
      setActiveSessionId('');
    },
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
  const [questionReq, setQuestionReq] = useState<{
    question_id: string;
    question: string;
    options?: string[];
  } | null>(null);
  const [questionAnswer, setQuestionAnswer] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [agentMode, setAgentMode] = useState<'plan' | 'execute'>('execute');
  const [loading, setLoading] = useState(false);
  const [isSharedView, setIsSharedView] = useState(false);

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

  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [leftExpand, setLeftExpand] = useState(true);
  const [rightExpand, setRightExpand] = useState(true);

  // --- Local functions ---
  const loadSkills = async () => {
    try {
      const res = await fetch(apiUrl('/v1/skills'));
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === 'success') setSkills(data.data);
    } catch (err) {
      console.error('Failed to load skills:', err);
    }
  };

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
        headers: { 'Authorization': `Bearer ${localStorage.getItem('claw_token')}` },
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const nextFiles = Array.isArray(data.files) ? data.files.filter(Boolean) : [];
        message.success({ content: `Uploaded to workspace: ${nextFiles[0] ?? file.name}`, key: 'upload' });
        setUploadedFiles((prev) => Array.from(new Set([...prev, ...nextFiles])));
      } else {
        message.error({ content: 'Upload failed: ' + (data.error || 'Unknown error'), key: 'upload' });
      }
    } catch {
      message.error({ content: 'Network error while uploading workspace file', key: 'upload' });
    }
    e.target.value = '';
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

  const handleResolveQuestion = async () => {
    if (!questionReq || !token || !questionAnswer.trim()) return;
    try {
      await fetch(apiUrl('/v1/chat/resolve_question'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          question_id: questionReq.question_id,
          answer: questionAnswer.trim(),
        }),
      });
      setQuestionReq(null);
      setQuestionAnswer('');
    } catch (e) {
      console.error(e);
    }
  };

  const sendMessage = () => {
    if ((!input.trim() && uploadedFiles.length === 0) || loadingRef.current || !activeSession || !token) return;
    let finalInput = input;
    for (const skill of skills) {
      const skillName = skill.name.includes('/') ? skill.name.split('/').pop()! : skill.name;
      finalInput = finalInput.replace(new RegExp(`/${skillName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'g'), `请使用 ${skill.name} 技能$1`);
    }
    if (uploadedFiles.length > 0) {
      finalInput += (finalInput ? '\n\n' : '') + buildUploadedWorkspacePrompt(uploadedFiles);
    }
    setUploadedFiles([]);
    setInput('');
    void sendMessageRaw(finalInput);
  };

  // --- Effects ---
  useEffect(() => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      if (scrollHeight - scrollTop - clientHeight < 150) {
        scrollRef.current.scrollTop = scrollHeight;
      }
    }
  }, [activeSession?.messages]);

  useEffect(() => {
    if (skills.length !== 0) return;
    queueMicrotask(() => { void loadSkills(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills.length]);

  useEffect(() => {
    if (activeSessionId) {
      void loadWorkspaceFiles(workspaceSubPath || undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  useEffect(() => {
    queueMicrotask(() => {
      const searchParams = new URLSearchParams(window.location.search);
      const isShared = searchParams.get('share') === 'true';
      const sharedSessionId = searchParams.get('session');

      if (isShared && sharedSessionId) {
        setIsSharedView(true);
        setShowLogin(false);
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

  // --- Conversations items ---
  const conversationItems = sessions.map(s => ({
    key: s.id,
    label: s.title,
  }));

  const handleConversationMenu = (item: { key: string }) => ({
    items: [{ key: 'delete', label: '删除', danger: true, icon: <DeleteOutlined /> }],
    onClick: ({ key }: { key: string }) => {
      if (key === 'delete') {
        deleteSession(item.key, {} as React.MouseEvent);
      }
    },
  });

  // --- Render ---
  return (
    <Layout style={{ height: '100vh', background: colors.bgPrimary }}>

      {/* Login modal */}
      <Modal
        open={showLogin}
        closable={false}
        keyboard={false}
        mask={{ closable: false }}
        footer={null}
        width={400}
        styles={{ body: { padding: '24px 32px 32px' } }}
      >
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ marginBottom: 12 }}>
            <Avatar size={48} style={{ background: `linear-gradient(135deg, ${colors.accent}, #7c3aed)`, borderRadius: 12 }} icon={<RobotOutlined />} />
          </div>
          <Typography.Title level={3} style={{ margin: '0 0 4px', fontSize: 22 }}>Claw Agent</Typography.Title>
          <Text type="secondary" style={{ fontSize: 14 }}>Sign in to start building</Text>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input
            size="large"
            prefix={<UserOutlined style={{ color: colors.textTertiary }} />}
            placeholder="Work email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            allowClear
          />
          <Input.Password
            size="large"
            prefix={<LockOutlined style={{ color: colors.textTertiary }} />}
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onPressEnter={handleLogin}
            allowClear
          />
          <Button type="primary" size="large" block loading={loginLoading} onClick={handleLogin} style={{ height: 44, fontWeight: 600, marginTop: 4 }}>
            Sign in
          </Button>
        </div>

        <div style={{ marginTop: 20, padding: '12px 16px', background: colors.bgTertiary, borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>💡</span>
            <div>
              <Text style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Default account</Text>
              <Text type="secondary" style={{ fontSize: 11, display: 'block', lineHeight: 1.6 }}>
                Email: your work email<br />
                Password: <Text code style={{ fontSize: 11, background: 'rgba(0,0,0,0.06)', padding: '1px 4px', borderRadius: 3 }}>Abc123456!</Text>
              </Text>
            </div>
          </div>
        </div>
      </Modal>

      {/* Left Sidebar */}
      {!isSharedView && (
        <Sider
          width={260}
          collapsed={!leftExpand}
          collapsedWidth={0}
          theme="light"
          style={{
            background: colors.bgSecondary,
            borderRight: `1px solid ${colors.borderMedium}`,
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Space>
                <Avatar shape="square" size={28} style={{ background: colors.accent, color: '#fff', borderRadius: 8 }} icon={<RobotOutlined />} />
                <Text strong style={{ fontSize: 16 }}>Agent Workspace</Text>
              </Space>
              <Button type="text" size="small" icon={<MenuFoldOutlined />} style={{ opacity: 0.4 }} onClick={() => setLeftExpand(false)} />
            </div>

            <div style={{ padding: '0 12px', marginBottom: 16 }}>
              <Button
                block
                style={{
                  textAlign: 'center',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 8,
                  height: 40,
                  background: '#fff',
                  border: '1px solid rgba(0,0,0,0.06)',
                  borderRadius: 12,
                }}
                onClick={createNewSession}
              >
                <PlusOutlined style={{ opacity: 0.6 }} /> New Chat
              </Button>
            </div>

            <div style={{ padding: '8px 16px' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>Recent sessions</Text>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              <Conversations
                items={conversationItems}
                activeKey={activeSessionId}
                onActiveChange={(key) => {
                  setActiveSessionId(key);
                  const session = sessions.find(s => s.id === key);
                  if (session && session.messages.length === 0 && session.title !== 'New Chat') {
                    void loadSessionDetail(key, token!, sessions);
                  }
                }}
                menu={handleConversationMenu}
                styles={{ item: { borderRadius: 8, margin: '2px 12px' } }}
              />
            </div>

            {/* User profile bar */}
            <div style={{ padding: '12px 16px', borderTop: `1px solid ${colors.borderLight}`, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar size={32} style={{ background: `linear-gradient(135deg, ${colors.info}, #7c3aed)` }} icon={<UserOutlined />} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text strong style={{ fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fullName}</Text>
                <Text type="secondary" style={{ fontSize: 11 }}>{email || 'Signed in'}</Text>
              </div>
              <Tooltip title="Sign out" placement="top">
                <Button type="text" size="small" onClick={handleLogout} style={{ fontSize: 16, color: colors.textTertiary, padding: '0 4px' }}>
                  <Text type="secondary" style={{ fontSize: 16 }}>⏻</Text>
                </Button>
              </Tooltip>
            </div>
          </div>
        </Sider>
      )}

      {!isSharedView && !leftExpand && (
        <div style={{ position: 'absolute', left: 0, top: 0, zIndex: 10, padding: 16 }}>
          <Button type="text" icon={<MenuUnfoldOutlined />} onClick={() => setLeftExpand(true)} />
        </div>
      )}

      {/* Main Chat Area */}
      <Layout style={{ background: colors.bgPrimary }}>
        {/* Header */}
        <Header style={{
          background: colors.bgPrimary,
          borderBottom: `1px solid ${colors.borderLight}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          height: 56,
          lineHeight: '56px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
            {!leftExpand && !isSharedView && (
              <Button type="text" icon={<MenuUnfoldOutlined />} onClick={() => setLeftExpand(true)} style={{ marginRight: 4 }} />
            )}
            <Avatar shape="square" size={28} style={{ background: colors.accent, color: '#fff', borderRadius: 8 }} icon={<RobotOutlined />} />
            <Text strong style={{ fontSize: 16 }}>{isSharedView ? 'Claw Agent' : (activeSession?.title || 'Hello')}</Text>
          </div>
          {isSharedView ? (
            <Button type="primary" size="small" onClick={() => { window.location.href = '/'; }}>Sign in</Button>
          ) : (
            <Space style={{ whiteSpace: 'nowrap' }}>
              <Tooltip title="Copy share link">
                <Button
                  type="text"
                  icon={<ShareAltOutlined />}
                  onClick={async () => {
                    const shareUrl = `${window.location.origin}/?session=${activeSession?.id}&share=true`;
                    if (await copyToClipboard(shareUrl)) {
                      message.success('Share link copied to clipboard.');
                    } else {
                      message.error('Failed to copy share link');
                    }
                  }}
                />
              </Tooltip>
            </Space>
          )}
        </Header>

        {/* Chat Area */}
        <Content style={{ display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
            <div style={{ maxWidth: 800, margin: '0 auto' }}>
              {(!activeSession || activeSession.messages.length === 0) && (
                <div style={{ textAlign: 'center', marginTop: 120 }}>
                  <RobotOutlined style={{ fontSize: 48, color: colors.accent, marginBottom: 16 }} />
                  <Typography.Title level={3} style={{ color: '#333', marginBottom: 4 }}>Claw Agent</Typography.Title>
                  <Text type="secondary" style={{ display: 'block', fontSize: 14 }}>
                    I can write code, run commands, analyze files, and more.
                  </Text>
                </div>
              )}

              {activeSession && activeSession.messages.length > 0 && (
                <Bubble.List
                  autoScroll
                  role={{
                    user: {
                      placement: 'end',
                      variant: 'filled',
                      contentRender: (content: string) => {
                        const uploadedFilesPrompt = parseUploadedWorkspacePrompt(content);
                        const handleCopy = async () => {
                          if (await copyToClipboard(content)) {
                            message.success('Copied to clipboard');
                          } else {
                            message.error('Copy failed');
                          }
                        };
                        if (uploadedFilesPrompt) {
                          return (
                            <div className="msg-hover-copy" style={{ position: 'relative' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                                {uploadedFilesPrompt.cleanContent && (
                                  <div style={{ whiteSpace: 'pre-wrap' }}>{uploadedFilesPrompt.cleanContent}</div>
                                )}
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                  {uploadedFilesPrompt.files.map((filePath) => {
                                    const displayName = filePath.split('/').pop() || filePath;
                                    return (
                                      <div key={filePath} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(0,0,0,0.04)', borderRadius: 8 }}>
                                        <PaperClipOutlined style={{ color: colors.info, fontSize: 16 }} />
                                        <Text strong style={{ fontSize: 13 }}>{displayName}</Text>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                              <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopy} className="copy-btn" style={{ position: 'absolute', top: -8, right: -8, opacity: 0, transition: 'opacity 0.15s' }} />
                            </div>
                          );
                        }
                        return (
                          <div className="msg-hover-copy" style={{ position: 'relative' }}>
                            <div style={{ whiteSpace: 'pre-wrap', paddingRight: 28 }}>{content}</div>
                            <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopy} className="copy-btn" style={{ position: 'absolute', top: 0, right: 0, opacity: 0, transition: 'opacity 0.15s' }} />
                          </div>
                        );
                      },
                    },
                    ai: {
                      placement: 'start',
                      avatar: <Avatar icon={<RobotOutlined />} style={{ background: colors.accent }} />,
                      contentRender: (content: string, info) => {
                        const parsed = parseMessageContent(content || '');
                        const isStreaming = info.status === 'loading' || info.status === 'updating';
                        const handleCopy = async () => {
                          if (await copyToClipboard(parsed.cleanContent)) {
                            message.success('Copied to clipboard');
                          } else {
                            message.error('Copy failed');
                          }
                        };
                        return (
                          <div className="msg-hover-copy" style={{ wordBreak: 'break-word', lineHeight: 1.6, position: 'relative' }}>
                            <ThinkingBlock content={parsed.thinkingBlock} isStreaming={isStreaming} />
                            <div style={{ paddingRight: 28 }}>
                              <ReactMarkdown>{parsed.cleanContent || ''}</ReactMarkdown>
                            </div>
                            <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopy} className="copy-btn" style={{ position: 'absolute', top: 0, right: 0, opacity: 0, transition: 'opacity 0.15s' }} />
                          </div>
                        );
                      },
                      footer: (content: string) => {
                        const parsed = parseMessageContent(content || '');
                        if (parsed.planSteps.length < 2 && parsed.workspaceFiles.length === 0) return null;
                        return (
                          <div>
                            <PlanStepsCard
                              steps={parsed.planSteps}
                              onExecuteStep={(fullBlock) => {
                                setInput(`Please execute the following step:\n\n${fullBlock}`);
                                setAgentMode('execute');
                              }}
                            />
                            <WorkspaceFiles
                              files={parsed.workspaceFiles}
                              onDownload={downloadWorkspaceFile}
                            />
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
                  }))}
                />
              )}

              {/* Loading indicator for non-streaming loading */}
              {loading && (!activeSession || activeSession.messages.length === 0) && (
                <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: colors.accent, opacity: 0.6, animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite` }} />
                    ))}
                  </div>
                  {activeToolName ? (
                    <Text type="secondary" italic>
                      Running <Text strong style={{ fontWeight: 600 }}>{activeToolName}</Text>
                      {activeToolSummary && <span> — {activeToolSummary}</span>}
                    </Text>
                  ) : (
                    <Text type="secondary" italic>Agent is thinking...</Text>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Input Area / Shared View CTA */}
          {isSharedView ? (
            <div style={{ padding: '24px 32px', textAlign: 'center', borderTop: `1px solid ${colors.borderLight}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
                <RobotOutlined style={{ fontSize: 18, color: colors.accent }} />
                <Text type="secondary" style={{ fontSize: 14 }}>Want to try it out?</Text>
              </div>
              <Button type="primary" onClick={() => { window.location.href = '/'; }}>
                Sign in to get started
              </Button>
            </div>
          ) : (
            <div style={{ padding: '0 24px 32px', background: 'transparent' }}>
              {uploadedFiles.length > 0 && (
                <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {uploadedFiles.map(f => (
                    <Tag
                      key={f}
                      closable
                      onClose={() => setUploadedFiles(prev => prev.filter(p => p !== f))}
                      icon={<PaperClipOutlined />}
                      color="blue"
                      style={{ padding: '4px 10px', borderRadius: 16, fontSize: 13 }}
                    >
                      {f.split('/').pop()}
                    </Tag>
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
          )}
        </Content>
      </Layout>

      {/* Right Sidebar: Workspace */}
      {!isSharedView && (
        <Sider
          width={300}
          collapsed={!rightExpand}
          collapsedWidth={0}
          theme="light"
          style={{ background: colors.bgPrimary, overflow: 'hidden' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${colors.borderLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text strong style={{ fontSize: 15 }}>Workspace</Text>
              <Button type="text" size="small" icon={<MenuUnfoldOutlined />} style={{ opacity: 0.4 }} onClick={() => setRightExpand(false)} />
            </div>

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
                      {!activeSessionId ? 'Select a session' : workspaceSubPath === 'output' ? 'No result files yet' : 'No files in this folder'}
                    </Text>
                  </div>
                ) : (
                  workspaceFiles.map((file, idx) => (
                    <Tooltip key={idx} title={file.is_dir ? 'Open folder' : 'Click to download'} placement="left">
                      <div
                        style={{
                          padding: '6px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                          gap: 8, fontSize: 13, borderRadius: 4, margin: '1px 4px',
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
        </Sider>
      )}

      {!isSharedView && !rightExpand && (
        <div style={{ position: 'absolute', right: 0, top: 0, zIndex: 10, padding: 16 }}>
          <Button type="text" icon={<MenuFoldOutlined />} onClick={() => setRightExpand(true)} />
        </div>
      )}

      {/* Action Prompt Modal */}
      <Modal
        title={<Space><span style={{ fontSize: 20 }}>Permission Request</span></Space>}
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

      {/* Agent Question Modal */}
      <Modal
        title={<Space><span style={{ fontSize: 20 }}>Agent Question</span></Space>}
        open={!!questionReq}
        closable={false}
        keyboard={false}
        mask={{ closable: false }}
        footer={null}
        width={500}
      >
        <p style={{ marginTop: 16 }}>{questionReq?.question}</p>
        {questionReq?.options && questionReq.options.length > 0 ? (
          <Radio.Group
            value={questionAnswer}
            onChange={(e) => setQuestionAnswer(e.target.value)}
            style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}
          >
            {questionReq.options.map((opt, i) => (
              <Radio key={i} value={opt}>{opt}</Radio>
            ))}
          </Radio.Group>
        ) : (
          <Input.TextArea
            value={questionAnswer}
            onChange={(e) => setQuestionAnswer(e.target.value)}
            placeholder="Type your answer..."
            rows={3}
            style={{ marginTop: 16 }}
          />
        )}
        <Space style={{ display: 'flex', justifyContent: 'flex-end', width: '100%', marginTop: 16 }}>
          <Button
            type="primary"
            disabled={!questionAnswer.trim()}
            onClick={handleResolveQuestion}
          >
            Submit
          </Button>
        </Space>
      </Modal>

    </Layout>
  );
}
