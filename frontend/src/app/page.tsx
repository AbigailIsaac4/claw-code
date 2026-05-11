'use client';

import { useState, useRef, useEffect } from 'react';
import { Button, Input, Modal, Typography, Space, Popconfirm, Avatar, App as AntdApp, Tooltip, Radio } from 'antd';
import { Markdown, DraggablePanel, ActionIcon, Header, Tag as LobeTag, Text as LobeText } from '@lobehub/ui';
import { ChatList, LoadingDots } from '@lobehub/ui/chat';
import { PlusOutlined, DeleteOutlined, UserOutlined, LockOutlined, PaperClipOutlined, RobotOutlined, ShareAltOutlined, CopyOutlined, MenuFoldOutlined, MenuUnfoldOutlined, FolderOutlined, FileOutlined, ReloadOutlined } from '@ant-design/icons';
import { parseMessageContent } from '@/utils/messageParser';
import { ThinkingBlock } from '@/components/chat/ThinkingBlock';
import { PlanStepsCard } from '@/components/chat/PlanStepsCard';
import { WorkspaceFiles } from '@/components/chat/WorkspaceFiles';
import { ToolRenderer } from '@/components/chat/ToolRenderer';
import { ChatInputBox } from '@/components/chat/ChatInputBox';
import { colors } from '@/styles/tokens';
import { useAuth } from '@/hooks/useAuth';
import { useSessions } from '@/hooks/useSessions';
import { useChatStream } from '@/hooks/useChatStream';
import { useWorkspace } from '@/hooks/useWorkspace';

const { Text } = Typography;

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

  // Wrap loadSessions to pass token automatically
  const loadSessions = (authToken: string) => loadSessionsRaw(authToken);

  const {
    workspaceFiles, workspaceFilesLoading,
    workspaceSubPath, setWorkspaceSubPath,
    loadWorkspaceFiles, downloadWorkspaceFileFromSidebar, downloadWorkspaceFile,
  } = useWorkspace(activeSessionId);

  // --- Local UI state (declared before useChatStream to avoid used-before-declaration) ---
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
    // Resolve /skill_name placeholders to actual skill invocations
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

  // Initialize auth state (including shared session support)
  useEffect(() => {
    queueMicrotask(() => {
      const searchParams = new URLSearchParams(window.location.search);
      const isShared = searchParams.get('share') === 'true';
      const sharedSessionId = searchParams.get('session');

      if (isShared && sharedSessionId) {
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

  // Poll session detail while loading (for non-streaming active turns)
  useEffect(() => {
    if (!token || !activeSessionId || !loading) return;
    if (streamingSessionRef.current === activeSessionId) return;

    const timer = window.setInterval(() => {
      void loadSessionDetail(activeSessionId, token, sessions);
    }, 2000);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, loading, sessions, token]);

  // --- Render ---
  return (
    <div style={{ height: '100vh', display: 'flex', backgroundColor: colors.bgPrimary }}>

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
                        void loadSessionDetail(item.id, token!, sessions);
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
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      size="small"
                      onClick={e => { e.stopPropagation(); deleteSession(item.id, e as React.MouseEvent); }}
                      style={{ opacity: isActive ? 1 : 0.4 }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* User profile bar */}
          <div style={{ padding: '12px 16px', borderTop: `1px solid ${colors.borderLight}`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar size={32} style={{ background: `linear-gradient(135deg, ${colors.info}, #7c3aed)` }} icon={<UserOutlined />} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text strong style={{ fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fullName}</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>{email || 'Signed in'}</Text>
            </div>
            <Tooltip title="Sign out" placement="top">
              <Button type="text" size="small" onClick={() => { handleLogout(); }} style={{ fontSize: 16, color: colors.textTertiary, padding: '0 4px' }}>
                <Text type="secondary" style={{ fontSize: 16 }}>⏻</Text>
              </Button>
            </Tooltip>
          </div>
        </div>
      </DraggablePanel>

      {/* Main Chat Area */}
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
              <div style={{ textAlign: 'center', marginTop: 120 }}>
                <RobotOutlined style={{ fontSize: 48, color: colors.accent, marginBottom: 16 }} />
                <Typography.Title level={3} style={{ color: '#333', marginBottom: 4 }}>Claw Agent</Typography.Title>
                <Text type="secondary" style={{ display: 'block', fontSize: 14 }}>
                  I can write code, run commands, analyze files, and more.
                </Text>
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
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '8px 12px', background: 'rgba(0,0,0,0.04)', borderRadius: 8,
                                  }}
                                >
                                  <PaperClipOutlined style={{ color: colors.info, fontSize: 16 }} />
                                  <Text strong style={{ fontSize: 13 }}>{displayName}</Text>
                                </div>
                              );
                            })}
                          </div>
                          <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopy} style={{ opacity: 0.5 }} />
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
                      <div className="msg-hover-copy" style={{ wordBreak: 'break-word', lineHeight: 1.6, position: 'relative' }}>
                        <ThinkingBlock content={parsed?.thinkingBlock} />
                        <div style={{ paddingRight: 28 }}>
                          <Markdown>{parsed?.cleanContent || ''}</Markdown>
                        </div>
                        <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopyAssistant} className="copy-btn" style={{ position: 'absolute', top: 0, right: 0, opacity: 0, transition: 'opacity 0.15s' }} />
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

      {/* Right Sidebar: Workspace */}
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
      </DraggablePanel>

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


    </div>
  );
}
