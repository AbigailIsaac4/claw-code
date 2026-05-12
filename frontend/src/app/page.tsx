'use client';

import { useState, useRef, useEffect, memo, createContext, useContext } from 'react';
import { Button, Input, Modal, Typography, Space, Avatar, App as AntdApp, Tooltip, Radio, Tag, theme, Flex } from 'antd';
import { Bubble, Conversations, Welcome, Prompts, Sender, Think, ThoughtChain, Actions } from '@ant-design/x';
import type { BubbleListProps } from '@ant-design/x';
import {
  PlusOutlined, DeleteOutlined, UserOutlined, LockOutlined, PaperClipOutlined,
  RobotOutlined, ShareAltOutlined, CopyOutlined, FolderOutlined, FileOutlined,
  ReloadOutlined, GlobalOutlined, SyncOutlined, CodeOutlined, ThunderboltOutlined,
  FileSearchOutlined, RocketOutlined,
} from '@ant-design/icons';
import { createStyles } from 'antd-style';
import { parseMessageContent } from '@/utils/messageParser';
import { PlanStepsCard } from '@/components/chat/PlanStepsCard';
import { WorkspaceFiles } from '@/components/chat/WorkspaceFiles';
import { ToolRenderer } from '@/components/chat/ToolRenderer';
import { useAuth } from '@/hooks/useAuth';
import { useSessions } from '@/hooks/useSessions';
import { useChatStream } from '@/hooks/useChatStream';
import { useWorkspace } from '@/hooks/useWorkspace';
import ReactMarkdown from 'react-markdown';

const { Text } = Typography;
const { useToken } = theme;

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

const copyToClipboard = async (text: string): Promise<boolean> => {
  try { if (navigator.clipboard) { await navigator.clipboard.writeText(text); return true; } } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    return true;
  } catch { return false; }
};

const UPLOADED_WORKSPACE_PREFIX = 'Uploaded workspace files: ';
const UPLOADED_WORKSPACE_SUFFIX = ' Please continue with the current session.';
const buildUploadedWorkspacePrompt = (files: string[]) => `${UPLOADED_WORKSPACE_PREFIX}${files.join(', ')}${UPLOADED_WORKSPACE_SUFFIX}`;
const parseUploadedWorkspacePrompt = (content: string) => {
  if (!content.includes(UPLOADED_WORKSPACE_PREFIX) || !content.endsWith(UPLOADED_WORKSPACE_SUFFIX)) return null;
  const start = content.lastIndexOf(UPLOADED_WORKSPACE_PREFIX);
  if (start < 0) return null;
  const filesStart = start + UPLOADED_WORKSPACE_PREFIX.length;
  const filesEnd = content.length - UPLOADED_WORKSPACE_SUFFIX.length;
  const files = content.slice(filesStart, filesEnd).split(/\s*[,，]\s*/).map(i => i.trim()).filter(Boolean);
  if (!files.length) return null;
  const cleanContent = `${content.slice(0, start)}${content.slice(filesEnd + UPLOADED_WORKSPACE_SUFFIX.length)}`.trim();
  return { cleanContent, files };
};

interface SkillInfo { name: string; description: string; path: string; }
interface ActionRequest { action_id: string; tool?: string; required_mode?: string; message?: string; }

// ==================== Styles ====================
const useStyle = createStyles(({ token, css }) => ({
  layout: css`
    width: 100%; height: 100vh; display: flex;
    background: ${token.colorBgContainer};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  `,
  sider: css`
    background: ${token.colorBgLayout}80;
    width: 280px; height: 100%;
    display: flex; flex-direction: column;
    padding: 0 12px; box-sizing: border-box;
    border-right: 1px solid ${token.colorBorderSecondary};
  `,
  logo: css`
    display: flex; align-items: center; justify-content: start;
    padding: 0 12px; box-sizing: border-box; gap: 10px;
    margin: 20px 0 12px;
    span { font-weight: bold; color: ${token.colorText}; font-size: 15px; }
  `,
  conversations: css`
    flex: 1; overflow-y: auto; margin-top: 8px; padding: 0;
    .ant-conversations-list { padding-inline-start: 0; }
  `,
  sideFooter: css`
    border-top: 1px solid ${token.colorBorderSecondary};
    padding: 12px 4px; margin-top: auto;
    display: flex; align-items: center; gap: 10px;
  `,
  chat: css`
    height: 100%; flex: 1; box-sizing: border-box;
    display: flex; flex-direction: column;
    padding-block: ${token.paddingLG}px;
    justify-content: space-between;
    .ant-bubble-content-updating {
      background-image: linear-gradient(90deg, ${token.colorPrimary} 0%, #7c3aed 50%, ${token.colorPrimary} 100%);
      background-size: 100% 2px;
      background-repeat: no-repeat;
      background-position: bottom;
    }
  `,
  chatPrompt: css`
    .ant-prompts-label { color: ${token.colorText} !important; }
    .ant-prompts-desc { color: ${token.colorTextSecondary} !important; width: 100%; }
    .ant-prompts-icon { color: ${token.colorTextSecondary} !important; }
  `,
  chatList: css`
    flex: 1; overflow-y: auto;
    display: flex; flex-direction: column; align-items: center; width: 100%;
  `,
  placeholder: css`
    padding: ${token.paddingLG}px; box-sizing: border-box; width: 100%;
  `,
  sender: css`
    width: 100%; max-width: 840px; margin: 0 auto;
  `,
  senderPrompt: css`
    width: 100%; max-width: 840px; margin: 0 auto; color: ${token.colorText};
  `,
}));

// ==================== Contexts ====================
const ChatCtx = createContext<{ onReload?: (id: string | number, params: any) => void }>({});
const MsgCtx = createContext<{ status?: string }>({});

// ==================== Think Component ====================
const ThinkComponent = memo(({ content, isStreaming, status }: { content?: string; isStreaming?: boolean; status?: string }) => {
  const [title, setTitle] = useState('Thinking...');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isStreaming) { setTitle('Thinking completed'); setLoading(false); }
    else if (status === 'abort') { setTitle('Thinking aborted'); setLoading(false); }
    else if (status === 'error') { setTitle('Thinking error'); setLoading(false); }
  }, [isStreaming, status]);

  if (!content) return null;
  return (
    <Think title={title} loading={loading} blink={isStreaming} style={{ marginBottom: 8 }}>
      <div style={{ maxHeight: 300, overflowY: 'auto', fontSize: 13, lineHeight: 1.7 }}>
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </Think>
  );
});

// ==================== Footer Actions ====================
const MessageFooter: React.FC<{ content: string; status?: string; id?: string | number }> = ({ content, status, id }) => {
  const ctx = useContext(ChatCtx);
  if (status === 'updating' || status === 'loading') return null;

  return (
    <Actions
      items={[
        { key: 'copy', actionRender: <Actions.Copy text={content} /> },
        { key: 'retry', icon: <SyncOutlined />, label: 'Retry', onItemClick: () => { if (id) ctx.onReload?.(id, {}); } },
      ]}
    />
  );
};

// ==================== Status Header ====================
const STATUS_CONFIG: Record<string, { title: string; status: string }> = {
  loading: { title: 'Running...', status: 'loading' },
  updating: { title: 'Running...', status: 'loading' },
  success: { title: 'Done', status: 'success' },
  error: { title: 'Failed', status: 'error' },
  abort: { title: 'Aborted', status: 'abort' },
};

// ==================== Main Component ====================
export default function ChatPage() {
  const { message } = AntdApp.useApp();
  const { token } = useToken();
  const { styles } = useStyle();

  // --- Hooks ---
  const {
    token: authToken, setToken, showLogin, setShowLogin,
    email, setEmail, password, setPassword,
    loginLoading, fullName, handleLogin, handleLogout,
  } = useAuth({
    onLoginSuccess: (t, fn) => { message.success(`Signed in as ${fn}`); loadSessions(t); },
    onLogout: () => { setSessions([]); setActiveSessionId(''); },
    onError: (msg) => message.error(msg),
  });

  const {
    sessions, setSessions, activeSessionId, setActiveSessionId, activeSession,
    loadingRef, streamingSessionRef,
    withAssistantTail, updateSessionMessages,
    createNewSession, deleteSession,
    loadSessionDetail, loadSessions: loadSessionsRaw,
  } = useSessions(authToken, handleLogout);

  const loadSessions = (t: string) => loadSessionsRaw(t);

  const {
    workspaceFiles, workspaceFilesLoading,
    workspaceSubPath, setWorkspaceSubPath,
    loadWorkspaceFiles, downloadWorkspaceFileFromSidebar, downloadWorkspaceFile,
  } = useWorkspace(activeSessionId);

  const [input, setInput] = useState('');
  const [actionReq, setActionReq] = useState<ActionRequest | null>(null);
  const [questionReq, setQuestionReq] = useState<{ question_id: string; question: string; options?: string[] } | null>(null);
  const [questionAnswer, setQuestionAnswer] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [agentMode] = useState<'plan' | 'execute'>('execute');
  const [loading, setLoading] = useState(false);
  const [isSharedView, setIsSharedView] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  const {
    activeToolName, activeToolSummary, sendMessage: sendMessageRaw,
  } = useChatStream({
    token: authToken, sessions, activeSessionId, activeSession,
    setSessions, setActiveSessionId,
    streamingSessionRef, loadingRef, setLoading,
    withAssistantTail, updateSessionMessages,
    loadSessionDetail, loadWorkspaceFiles,
    workspaceSubPath, agentMode,
    onError: (msg) => message.error(msg),
    onActionRequired: (data) => setActionReq(data),
    onQuestionRequired: (data) => { setQuestionReq(data); setQuestionAnswer(''); },
  });

  // --- Functions ---
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
      const res = await fetch(apiUrl(`/v1/sandbox/upload?${new URLSearchParams({ session_id: activeSessionId })}`), {
        method: 'POST', headers: { 'Authorization': `Bearer ${localStorage.getItem('claw_token')}` }, body: formData,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const nf = Array.isArray(data.files) ? data.files.filter(Boolean) : [];
        message.success({ content: `Uploaded: ${nf[0] ?? file.name}`, key: 'upload' });
        setUploadedFiles(prev => Array.from(new Set([...prev, ...nf])));
      } else message.error({ content: 'Upload failed: ' + (data.error || 'Unknown'), key: 'upload' });
    } catch { message.error({ content: 'Network error', key: 'upload' }); }
    e.target.value = '';
  };

  const handleResolveAction = async (allow: boolean) => {
    if (!actionReq || !authToken) return;
    try {
      await fetch(apiUrl('/v1/chat/resolve_action'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ action_id: actionReq.action_id, allow, reason: allow ? undefined : 'User denied' }),
      });
      setActionReq(null);
    } catch {}
  };

  const handleResolveQuestion = async () => {
    if (!questionReq || !authToken || !questionAnswer.trim()) return;
    try {
      await fetch(apiUrl('/v1/chat/resolve_question'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ question_id: questionReq.question_id, answer: questionAnswer.trim() }),
      });
      setQuestionReq(null); setQuestionAnswer('');
    } catch {}
  };

  const sendMessage = (msg?: string) => {
    const rawInput = msg ?? input;
    if ((!rawInput.trim() && !uploadedFiles.length) || loadingRef.current || !activeSession || !authToken) return;
    let finalInput = rawInput;
    for (const skill of skills) {
      const sn = skill.name.includes('/') ? skill.name.split('/').pop()! : skill.name;
      finalInput = finalInput.replace(new RegExp(`/${sn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'g'), `请使用 ${skill.name} 技能$1`);
    }
    if (uploadedFiles.length) finalInput += (finalInput ? '\n\n' : '') + buildUploadedWorkspacePrompt(uploadedFiles);
    setUploadedFiles([]); setInput('');
    void sendMessageRaw(finalInput);
  };

  // --- Effects ---
  useEffect(() => {
    if (listRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = listRef.current;
      if (scrollHeight - scrollTop - clientHeight < 150) listRef.current.scrollTop = scrollHeight;
    }
  }, [activeSession?.messages]);

  useEffect(() => { if (!skills.length) queueMicrotask(() => void loadSkills()); }, [skills.length]);
  useEffect(() => { if (activeSessionId) void loadWorkspaceFiles(workspaceSubPath || undefined); }, [activeSessionId]);

  useEffect(() => {
    queueMicrotask(() => {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('share') === 'true' && sp.get('session')) {
        setIsSharedView(true); setShowLogin(false);
        void loadSessionDetail(sp.get('session')!, '', []);
        return;
      }
      const saved = localStorage.getItem('claw_token');
      if (saved) { setToken(saved); setShowLogin(false); void loadSessions(saved); }
    });
  }, []);

  useEffect(() => {
    if (!authToken || !activeSessionId || !loading) return;
    if (streamingSessionRef.current === activeSessionId) return;
    const t = window.setInterval(() => void loadSessionDetail(activeSessionId, authToken, sessions), 2000);
    return () => window.clearInterval(t);
  }, [activeSessionId, loading, sessions, authToken]);

  // --- Conversations ---
  const conversationItems = sessions.map(s => ({ key: s.id, label: s.title }));

  // --- Prompt items ---
  const PROMPT_ITEMS = [
    { key: '1', description: 'Write & review code', icon: <CodeOutlined /> },
    { key: '2', description: 'Debug & fix errors', icon: <ThunderboltOutlined /> },
    { key: '3', description: 'Analyze workspace files', icon: <FileSearchOutlined /> },
    { key: '4', description: 'Run shell commands', icon: <RocketOutlined /> },
  ];

  const WELCOME_PROMPTS = [
    {
      key: '1', label: 'Quick Start',
      children: [
        { key: '1-1', description: 'What can you do?', icon: <span style={{ color: token.colorPrimary, fontWeight: 700 }}>1</span> },
        { key: '1-2', description: 'Help me write a script', icon: <span style={{ color: '#ff6565', fontWeight: 700 }}>2</span> },
      ],
    },
    {
      key: '2', label: 'Capabilities',
      children: [
        { key: '2-1', icon: <CodeOutlined />, label: 'Code', description: 'Generate, refactor, and review code' },
        { key: '2-2', icon: <RocketOutlined />, label: 'Execute', description: 'Run commands and scripts' },
      ],
    },
  ];

  // --- Bubble role config ---
  const bubbleRole: BubbleListProps['role'] = {
    user: {
      placement: 'end',
      variant: 'filled',
      contentRender: (content: string) => {
        const up = parseUploadedWorkspacePrompt(content);
        const handleCopy = async () => { await copyToClipboard(content) ? message.success('Copied') : message.error('Failed'); };
        if (up) {
          return (
            <div className="msg-hover-copy" style={{ position: 'relative' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                {up.cleanContent && <div style={{ whiteSpace: 'pre-wrap' }}>{up.cleanContent}</div>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {up.files.map(fp => (
                    <div key={fp} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: token.colorFillQuaternary, borderRadius: token.borderRadius }}>
                      <PaperClipOutlined style={{ color: token.colorPrimary }} />
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
      avatar: <Avatar icon={<RobotOutlined />} style={{ background: token.colorPrimary }} />,
      header: (_content: string, info) => {
        const cfg = STATUS_CONFIG[info.status as string];
        if (!cfg) return null;
        return (
          <ThoughtChain.Item
            style={{ marginBottom: 8 }}
            status={cfg.status as any}
            variant="solid"
            icon={<GlobalOutlined />}
            title={cfg.title}
          />
        );
      },
      contentRender: (content: string, info) => {
        const parsed = parseMessageContent(content || '');
        const isStreaming = info.status === 'loading' || info.status === 'updating';
        const handleCopy = async () => { await copyToClipboard(parsed.cleanContent) ? message.success('Copied') : message.error('Failed'); };
        return (
          <MsgCtx.Provider value={{ status: info.status }}>
            <div className="msg-hover-copy" style={{ position: 'relative', lineHeight: 1.7 }}>
              <ThinkComponent content={parsed.thinkingBlock} isStreaming={isStreaming} status={info.status} />
              <div style={{ paddingRight: 28 }}>
                <ReactMarkdown>{parsed.cleanContent || ''}</ReactMarkdown>
              </div>
              <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopy} className="copy-btn" style={{ position: 'absolute', top: 0, right: 0, opacity: 0 }} />
            </div>
          </MsgCtx.Provider>
        );
      },
      footer: (content: string, info) => {
        const toolCalls = info.extraInfo?.toolCalls;
        const parsed = parseMessageContent(content || '');
        const hasPlanSteps = parsed.planSteps.length >= 2;
        const hasFiles = parsed.workspaceFiles.length > 0;
        const hasTools = Array.isArray(toolCalls) && toolCalls.length > 0;
        return (
          <div>
            {hasPlanSteps && <PlanStepsCard steps={parsed.planSteps} onExecuteStep={(fb) => setInput(`Please execute:\n\n${fb}`)} />}
            {hasFiles && <WorkspaceFiles files={parsed.workspaceFiles} onDownload={downloadWorkspaceFile} />}
            {hasTools && <ToolRenderer toolCalls={toolCalls} />}
            <MessageFooter content={parsed.cleanContent} status={info.status} id={info.key} />
          </div>
        );
      },
    },
  };

  // --- Sidebar ---
  const sider = !isSharedView && (
    <div className={styles.sider}>
      <div className={styles.logo}>
        <Avatar shape="square" size={28} style={{ background: token.colorPrimary, borderRadius: 6 }} icon={<RobotOutlined />} />
        <span>Claw Agent</span>
      </div>
      <Conversations
        creation={{ onClick: createNewSession, label: 'New Chat' }}
        items={conversationItems}
        className={styles.conversations}
        activeKey={activeSessionId}
        onActiveChange={(key) => {
          setActiveSessionId(key);
          const session = sessions.find(s => s.id === key);
          if (session && session.messages.length === 0 && session.title !== 'New Chat') void loadSessionDetail(key, authToken!, sessions);
        }}
        groupable
        styles={{ item: { padding: '0 8px', borderRadius: token.borderRadius } }}
        menu={(item) => ({
          items: [{ label: '删除', key: 'delete', icon: <DeleteOutlined />, danger: true }],
          onClick: ({ key }: { key: string }) => { if (key === 'delete') deleteSession(item.key, {} as React.MouseEvent); },
        })}
      />
      <div className={styles.sideFooter}>
        <Avatar size={24} style={{ background: `linear-gradient(135deg, ${token.colorPrimary}, #7c3aed)` }} icon={<UserOutlined />} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text strong style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fullName}</Text>
        </div>
        <Tooltip title="Sign out">
          <Button type="text" size="small" onClick={handleLogout} icon={<UserOutlined />} style={{ color: token.colorTextQuaternary }} />
        </Tooltip>
      </div>
    </div>
  );

  // --- Chat list ---
  const chatList = (
    <div className={styles.chatList} ref={listRef}>
      {activeSession?.messages.length ? (
        <Bubble.List
          autoScroll
          items={activeSession.messages.map(msg => ({
            key: msg.id,
            role: msg.role === 'user' ? 'user' : 'ai',
            content: msg.content || ' ',
            loading: loading && activeSession.messages[activeSession.messages.length - 1]?.id === msg.id,
            extraInfo: { toolCalls: msg.toolCalls },
          }))}
          styles={{ root: { maxWidth: 860, width: '100%', padding: '0 24px' } }}
          role={bubbleRole}
        />
      ) : (
        <Flex vertical style={{ maxWidth: 840 }} gap={16} align="center" className={styles.placeholder}>
          <Welcome
            variant="borderless"
            icon={<RobotOutlined style={{ fontSize: 48, color: token.colorPrimary }} />}
            title="Hello, I'm Claw Agent"
            description="I can write code, run commands, analyze files, and more. Start a conversation below."
          />
          <Flex gap={16}>
            <Prompts
              items={[WELCOME_PROMPTS[0]]}
              styles={{
                list: { height: '100%' },
                item: { flex: 1, backgroundImage: `linear-gradient(123deg, ${token.colorPrimaryBg} 0%, #efe7ff 100%)`, borderRadius: 12, border: 'none' },
                subItem: { padding: 0, background: 'transparent' },
              }}
              onItemClick={(info) => { if (info.data.description) sendMessage(info.data.description as string); }}
              className={styles.chatPrompt}
            />
            <Prompts
              items={[WELCOME_PROMPTS[1]]}
              styles={{
                item: { flex: 1, backgroundImage: `linear-gradient(123deg, ${token.colorPrimaryBg} 0%, #efe7ff 100%)`, borderRadius: 12, border: 'none' },
                subItem: { background: token.colorBgContainer },
              }}
              onItemClick={(info) => { if (info.data.description) sendMessage(info.data.description as string); }}
              className={styles.chatPrompt}
            />
          </Flex>
        </Flex>
      )}
    </div>
  );

  // --- Sender ---
  const chatSender = !isSharedView && (
    <Flex vertical gap={12} justify="center" style={{ marginInline: 24 }}>
      <Prompts
        items={PROMPT_ITEMS}
        onItemClick={(info) => { setInput(info.data.description as string); }}
        styles={{ item: { padding: '6px 12px' } }}
        className={styles.senderPrompt}
      />
      <Sender
        value={input}
        onChange={setInput}
        onSubmit={(val) => { if (val.trim()) sendMessage(val); }}
        onCancel={() => {}}
        loading={loading}
        className={styles.sender}
        placeholder="Ask me anything..."
        prefix={
          <PaperClipOutlined
            style={{ fontSize: 18, cursor: 'pointer', color: token.colorTextQuaternary }}
            onClick={() => document.getElementById('file-upload-input')?.click()}
          />
        }
      />
      <input type="file" id="file-upload-input" style={{ display: 'none' }} onChange={handleFileUpload} />
    </Flex>
  );

  // --- Shared view CTA ---
  const sharedCTA = isSharedView && (
    <div style={{ padding: '24px 32px', textAlign: 'center', borderTop: `1px solid ${token.colorBorderSecondary}` }}>
      <Space style={{ marginBottom: 12 }}>
        <RobotOutlined style={{ color: token.colorPrimary }} />
        <Text type="secondary">Want to try it out?</Text>
      </Space>
      <div><Button type="primary" onClick={() => { window.location.href = '/'; }}>Sign in to get started</Button></div>
    </div>
  );

  // --- Workspace sidebar ---
  const workspaceSider = !isSharedView && (
    <div style={{ width: 280, height: '100%', display: 'flex', flexDirection: 'column', background: token.colorBgContainer, borderLeft: `1px solid ${token.colorBorderSecondary}` }}>
      <div style={{ padding: '16px', borderBottom: `1px solid ${token.colorBorderSecondary}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text strong style={{ fontSize: 15 }}>Workspace</Text>
        <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => loadWorkspaceFiles(workspaceSubPath || undefined)} loading={workspaceFilesLoading} />
      </div>
      <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: token.colorFillQuaternary }}>
        <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Files {workspaceSubPath && `/ ${workspaceSubPath}`}
        </Text>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {workspaceSubPath && (
          <div style={{ padding: '6px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: token.colorPrimary }}
            onClick={() => { setWorkspaceSubPath(''); void loadWorkspaceFiles(); }}>
            <FolderOutlined /> ..
          </div>
        )}
        {workspaceFiles.length === 0 && !workspaceFilesLoading ? (
          <div style={{ textAlign: 'center', padding: '32px 16px' }}>
            <FolderOutlined style={{ fontSize: 32, color: token.colorBorder, marginBottom: 8 }} />
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              {!activeSessionId ? 'Select a session' : workspaceSubPath === 'output' ? 'No result files' : 'No files here'}
            </Text>
          </div>
        ) : workspaceFiles.map((file, idx) => (
          <Tooltip key={idx} title={file.is_dir ? 'Open folder' : 'Download'} placement="left">
            <div className="workspace-file-item"
              style={{ padding: '6px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, borderRadius: 4, margin: '1px 4px' }}
              onClick={() => file.is_dir ? (setWorkspaceSubPath(file.path), void loadWorkspaceFiles(file.path)) : downloadWorkspaceFileFromSidebar(file.path)}>
              {file.is_dir ? <FolderOutlined style={{ color: token.colorWarning, fontSize: 14 }} /> : <FileOutlined style={{ color: token.colorTextQuaternary, fontSize: 14 }} />}
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
              {!file.is_dir && <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{file.size < 1024 ? `${file.size}B` : file.size < 1048576 ? `${(file.size/1024).toFixed(1)}K` : `${(file.size/1048576).toFixed(1)}M`}</Text>}
            </div>
          </Tooltip>
        ))}
      </div>
    </div>
  );

  // --- Render ---
  return (
    <ChatCtx.Provider value={{ onReload: undefined }}>
      {/* Login modal */}
      <Modal open={showLogin} closable={false} keyboard={false} mask={{ closable: false }} footer={null} width={400} styles={{ body: { padding: '32px 32px 28px' } }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <Avatar size={56} style={{ background: `linear-gradient(135deg, ${token.colorPrimary}, #7c3aed)`, borderRadius: 14, marginBottom: 16 }} icon={<RobotOutlined />} />
          <Typography.Title level={3} style={{ margin: '0 0 8px' }}>Claw Agent</Typography.Title>
          <Text type="secondary">Sign in to start building</Text>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input size="large" prefix={<UserOutlined style={{ color: token.colorTextQuaternary }} />} placeholder="Work email" value={email} onChange={e => setEmail(e.target.value)} allowClear />
          <Input.Password size="large" prefix={<LockOutlined style={{ color: token.colorTextQuaternary }} />} placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onPressEnter={handleLogin} allowClear />
          <Button type="primary" size="large" block loading={loginLoading} onClick={handleLogin} style={{ height: 44, fontWeight: 600, marginTop: 4 }}>Sign in</Button>
        </div>
        <div style={{ marginTop: 20, padding: '12px 16px', background: token.colorFillQuaternary, borderRadius: token.borderRadius }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontSize: 14 }}>💡</span>
            <div>
              <Text style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Default account</Text>
              <Text type="secondary" style={{ fontSize: 11, display: 'block', lineHeight: 1.6 }}>
                Email: your work email<br />Password: <Text code style={{ fontSize: 11, background: token.colorFillSecondary, padding: '1px 4px', borderRadius: 3 }}>Abc123456!</Text>
              </Text>
            </div>
          </div>
        </div>
      </Modal>

      <div className={styles.layout}>
        {sider}
        <div className={styles.chat}>
          {chatList}
          {chatSender}
          {sharedCTA}
        </div>
        {workspaceSider}
      </div>

      {/* Action Modal */}
      <Modal title={<span style={{ fontSize: 18 }}>Permission Request</span>} open={!!actionReq} closable={false} keyboard={false} mask={{ closable: false }} footer={null} width={480}>
        <p style={{ marginTop: 16, color: token.colorTextSecondary }}>The agent needs approval before running this action.</p>
        <div style={{ background: token.colorFillQuaternary, border: `1px solid ${token.colorBorderSecondary}`, padding: 16, borderRadius: token.borderRadius, margin: '16px 0 24px' }}>
          <p style={{ margin: '0 0 8px' }}><strong>Tool:</strong> <Text code>{actionReq?.tool}</Text></p>
          <p style={{ margin: '0 0 8px' }}><strong>Mode:</strong> <Text type="danger">{actionReq?.required_mode}</Text></p>
          <p style={{ margin: 0 }}><strong>Reason:</strong> <Text type="secondary">{actionReq?.message}</Text></p>
        </div>
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button danger onClick={() => handleResolveAction(false)}>Reject</Button>
          <Button type="primary" onClick={() => handleResolveAction(true)}>Approve</Button>
        </Space>
      </Modal>

      {/* Question Modal */}
      <Modal title={<span style={{ fontSize: 18 }}>Agent Question</span>} open={!!questionReq} closable={false} keyboard={false} mask={{ closable: false }} footer={null} width={480}>
        <p style={{ marginTop: 16 }}>{questionReq?.question}</p>
        {questionReq?.options?.length ? (
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
    </ChatCtx.Provider>
  );
}
