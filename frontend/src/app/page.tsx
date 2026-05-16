'use client';

import { useState, useRef, useEffect, memo, createContext, useContext } from 'react';
import { Button, Input, Modal, Typography, Space, Avatar, App as AntdApp, Tooltip, Radio, Tag, theme, Flex, Popover, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { Bubble, Conversations, Welcome, Sender, Think, ThoughtChain, Actions } from '@ant-design/x';
import type { BubbleListProps } from '@ant-design/x';
import {
  Trash2, CircleUser, Lock, Paperclip,
  Bot, Copy, Folder, FileText,
  RefreshCw, Globe, RefreshCcw, LayoutGrid,
  ChevronRight, Sparkles, MoreHorizontal, Edit3, Info, LogOut
} from 'lucide-react';
import { ArrowUpOutlined, ShareAltOutlined, SettingOutlined } from '@ant-design/icons';
import { createStyles } from 'antd-style';
import { parseMessageContent, normalizeWorkspaceFile } from '@/utils/messageParser';
import { PlanStepsCard } from '@/components/chat/PlanStepsCard';
import { WorkspaceFiles, getFileIcon } from '@/components/chat/WorkspaceFiles';
import { ToolRenderer } from '@/components/chat/ToolRenderer';
import { useAuth } from '@/hooks/useAuth';
import { useSessions } from '@/hooks/useSessions';
import { useChatStream } from '@/hooks/useChatStream';
import { useWorkspace } from '@/hooks/useWorkspace';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

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
    background: #ffffff; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  `,
  sider: css`
    background: #f5f5f5;
    width: 260px; height: 100%;
    display: flex; flex-direction: column;
    padding: 0 12px; box-sizing: border-box;
    border-right: 1px solid #e2e8f0;
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
    padding-bottom: ${token.paddingLG}px;
    justify-content: space-between;
    position: relative;
    .ant-bubble-content-updating {
      background-image: linear-gradient(90deg, ${token.colorPrimary} 0%, #7c3aed 50%, ${token.colorPrimary} 100%);
      background-size: 100% 2px;
      background-repeat: no-repeat;
      background-position: bottom;
    }
  `,
  chatList: css`
    flex: 1; overflow-y: auto; overflow-x: hidden;
    display: flex; flex-direction: column; align-items: center; width: 100%;
    background: #ffffff;
    padding-top: ${token.paddingLG}px;
  `,
  placeholder: css`
    padding: ${token.paddingLG}px; box-sizing: border-box; width: 100%;
  `,
  sender: css`
    width: 100%; max-width: 768px; margin: 0 auto;
    box-shadow: 0 8px 32px rgba(0,0,0,0.06);
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(16px);
    border: 1px solid #e2e8f0;
    padding: 12px 16px;
    & .ant-btn-primary { display: none; }
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

// Removed MessageFooter
// ==================== Status Header ====================
const STATUS_CONFIG: Record<string, { title: string; status: string }> = {
  loading: { title: 'Generating...', status: 'loading' },
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
    loadingSessionsRef, streamingSessionsRef,
    withAssistantTail, updateSessionMessages,
    createNewSession, deleteSession, renameSession,
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
  const [loading, setLoading] = useState(false);
  const [isSharedView, setIsSharedView] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);

  const {
    sendMessage: sendMessageRaw,
    activeToolName,
    activeToolSummary,
    currentIteration,
    stopMessage,
  } = useChatStream({
    token: authToken, sessions, activeSessionId, activeSession,
    setSessions, setActiveSessionId,
    streamingSessionsRef, loadingSessionsRef, setLoading,
    withAssistantTail, updateSessionMessages,
    loadSessionDetail, loadWorkspaceFiles,
    workspaceSubPath,
    onError: (msg) => message.error(msg),
    onActionRequired: (data) => setActionReq(data),
    onQuestionRequired: (data) => { setQuestionReq(data); setQuestionAnswer(''); },
  });

  const handleMenuClick: MenuProps['onClick'] = (e) => {
    if (e.key === 'rename') {
      setRenameInput(activeSession?.title || '');
      setIsRenameModalOpen(true);
    } else if (e.key === 'details') {
      setIsDetailsModalOpen(true);
    } else if (e.key === 'delete') {
      Modal.confirm({
        title: '删除任务',
        content: '确定要删除这个任务吗？此操作不可恢复。',
        okText: '确定',
        cancelText: '取消',
        okType: 'danger',
        onOk: () => {
          if (activeSessionId) deleteSession(activeSessionId);
        }
      });
    }
  };

  const menuProps = {
    items: [
      { key: 'rename', label: '重命名', icon: <Edit3 size={14} /> },
      { key: 'details', label: '任务详情', icon: <Info size={14} /> },
      { key: 'delete', label: <span style={{ color: '#ff4d4f' }}>删除</span>, icon: <Trash2 size={14} color="#ff4d4f" /> },
    ],
    onClick: handleMenuClick,
  };



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
    if (file.size > 150 * 1024 * 1024) { message.error('File too large (max 150MB).'); return; }
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
    if ((!rawInput.trim() && !uploadedFiles.length) || loadingSessionsRef.current.has(activeSessionId) || !activeSession || !authToken) return;
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
  // Sync UI loading state when switching sessions
  useEffect(() => {
    if (activeSessionId) {
      setLoading(loadingSessionsRef.current.has(activeSessionId));
    }
  }, [activeSessionId]);

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
    if (streamingSessionsRef.current.has(activeSessionId)) return;
    const t = window.setInterval(() => void loadSessionDetail(activeSessionId, authToken, sessions), 2000);
    return () => window.clearInterval(t);
  }, [activeSessionId, loading, sessions, authToken]);

  // --- Conversations ---
  const conversationItems = sessions.map(s => ({ key: s.id, label: s.title }));

  // --- Skill selector state ---
  const [skillPopupOpen, setSkillPopupOpen] = useState(false);
  const [skillFilter, setSkillFilter] = useState('');
  const skillsFiltered = skillFilter
    ? skills.filter(s => {
        const sn = s.name.includes('/') ? s.name.split('/').pop()! : s.name;
        return sn.toLowerCase().includes(skillFilter.toLowerCase());
      })
    : skills;

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
            <div className="msg-hover-copy" style={{ position: 'relative', paddingBottom: 24 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                {up.cleanContent && <div style={{ whiteSpace: 'pre-wrap' }}>{up.cleanContent}</div>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {up.files.map(fp => (
                    <div key={fp} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: token.colorFillQuaternary, borderRadius: token.borderRadius }}>
                      <Paperclip size={14} style={{ color: token.colorPrimary }} />
                      <Text style={{ fontSize: 13 }}>{fp.split('/').pop()}</Text>
                    </div>
                  ))}
                </div>
              </div>
              <Button type="text" size="small" icon={<Copy size={14} />} onClick={handleCopy} className="copy-btn" style={{ position: 'absolute', bottom: 0, left: 0, opacity: 0 }} />
            </div>
          );
        }
        return (
          <div className="msg-hover-copy" style={{ position: 'relative', paddingBottom: 24 }}>
            <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
            <Button type="text" size="small" icon={<Copy size={14} />} onClick={handleCopy} className="copy-btn" style={{ position: 'absolute', bottom: 0, left: 0, opacity: 0 }} />
          </div>
        );
      },
    },
    ai: {
      placement: 'start',
      typing: true,
      variant: 'borderless',
      styles: { content: { padding: 0 } },
      header: null,
      contentRender: (content: string, info) => {
        const parsed = parseMessageContent(content || '');
        const isStreaming = info.status === 'loading';
        const toolCalls = info.extraInfo?.toolCalls || [];
        const hasPlanSteps = parsed.planSteps.length >= 2;
        const hasPlaceholders = parsed.cleanContent.includes('[TOOL_CALL:');
        
        const handleCopy = async () => { await copyToClipboard(parsed.cleanContent) ? message.success('Copied') : message.error('Failed'); };
        
        return (
          <MsgCtx.Provider value={{ status: info.status }}>
            <div className="msg-hover-copy" style={{ position: 'relative', lineHeight: 1.6, marginTop: 4, paddingBottom: 24 }}>
              <ThinkComponent content={parsed.thinkingBlock} isStreaming={isStreaming} status={info.status} />
              
              {hasPlanSteps && <PlanStepsCard steps={parsed.planSteps} isStreaming={isStreaming} />}
              
              {!hasPlaceholders && toolCalls.length > 0 && <ToolRenderer toolCalls={toolCalls} />}
              
              {parsed.cleanContent.split(/(\[TOOL_CALL:[^\]]+\])/).map((part, i) => {
                if (part.startsWith('[TOOL_CALL:') && part.endsWith(']')) {
                  const id = part.slice(11, -1);
                  const tool = toolCalls.find((t: any) => t.id === id);
                  if (tool) return <ToolRenderer key={i} toolCalls={[tool]} />;
                  return null;
                }
                if (!part.trim()) return null;
                return (
                  <div key={i} className="markdown-body" style={{ color: '#334155', fontSize: '15px', marginBottom: 8 }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{part}</ReactMarkdown>
                  </div>
                );
              })}
              
              <Button type="text" size="small" icon={<Copy size={14} />} onClick={handleCopy} className="copy-btn" style={{ position: 'absolute', bottom: 0, left: 0, opacity: 0 }} />
            </div>
          </MsgCtx.Provider>
        );
      },
      footer: (content: string, info) => {
        const parsed = parseMessageContent(content || '');
        // Combine regex-parsed files and fs-diff artifacts (filtered by extensions)
        const combined = new Set([
          ...parsed.workspaceFiles,
          ...((info.extraInfo?.artifacts || [])
              .map((f: string) => normalizeWorkspaceFile(f))
              .filter(Boolean) as string[])
        ]);

        // Filter out hallucinated or missing files by checking the current real workspace files
        const validFiles = isSharedView ? Array.from(combined) : Array.from(combined).filter(pf => 
          workspaceFiles.some(wf => wf.name === pf.split('/').pop() || wf.path === pf || wf.path.endsWith('/' + pf))
        );
        if (validFiles.length === 0) return null;
        return (
          <div>
            <WorkspaceFiles files={validFiles} onDownload={downloadWorkspaceFile} sessionId={activeSessionId} />
          </div>
        );
      },
    },
  };

  // --- Sidebar ---
  const sider = !isSharedView && (
    <div className={styles.sider}>
      <div className={styles.logo}>
        <Avatar shape="square" size={30} style={{ background: 'linear-gradient(135deg, #10b981 0%, #047857 100%)', borderRadius: 8, boxShadow: '0 2px 6px rgba(16, 163, 127, 0.2)' }} icon={<Sparkles size={16} color="#fff" />} />
        <span style={{ color: '#0f172a', fontSize: 16, fontWeight: 700, letterSpacing: '-0.3px' }}>Claw Agent</span>
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
          items: [{ label: 'Delete', key: 'delete', icon: <Trash2 size={14} />, danger: true }],
          onClick: ({ key }: { key: string }) => { if (key === 'delete') deleteSession(item.key); },
        })}
      />
      <div className={styles.sideFooter}>
        <Avatar size={28} style={{ background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)', color: '#fff', fontSize: 13, fontWeight: 600 }}>
          {fullName ? fullName.charAt(0).toUpperCase() : <CircleUser size={16} color="#fff" />}
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text strong style={{ fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1e293b' }}>{fullName || 'User'}</Text>
        </div>
        <Tooltip title="Sign out">
          <Button type="text" size="small" onClick={handleLogout} icon={<LogOut size={16} />} style={{ color: token.colorTextQuaternary }} />
        </Tooltip>
      </div>
    </div>
  );

  // --- Chat list ---
  const chatList = (
    <div className={styles.chatList} ref={listRef}>
      {activeSession?.messages.length ? (
        <>
        <Bubble.List
          autoScroll
          items={activeSession.messages.map(msg => {
            const isLastMsg = activeSession.messages[activeSession.messages.length - 1]?.id === msg.id;
            const isStreaming = loading && isLastMsg && msg.role === 'assistant';
            const isEmpty = !msg.content || !msg.content.trim();
            return {
              key: msg.id,
              role: msg.role === 'user' ? 'user' : 'ai',
              content: msg.content || ' ',
              loading: isStreaming && isEmpty,
              status: isStreaming ? 'loading' : undefined,
              extraInfo: { toolCalls: msg.toolCalls, artifacts: msg.artifacts },
            };
          })}
          styles={{ root: { maxWidth: 860, width: '100%', padding: '0 24px' } }}
          role={bubbleRole}
        />
        </>
      ) : (
        <Flex vertical style={{ maxWidth: 840, flex: 1, justifyContent: 'center' }} gap={16} align="center" className={styles.placeholder}>
          <Welcome
            variant="borderless"
            icon={<Avatar size={56} icon={<Sparkles size={28} color="#fff" />} style={{ background: '#10a37f' }} />}
            title="Hello, I'm Claw Agent"
            description="I can write code, run commands, analyze files, and more. Start a conversation below or type / to select a skill."
          />
        </Flex>
      )}
    </div>
  );

  // --- Sender ---
  const handleInputChange = (val: string) => {
    setInput(val);
    // Detect "/" to trigger skill autocomplete
    const lastSlashIdx = val.lastIndexOf('/');
    if (lastSlashIdx >= 0) {
      const afterSlash = val.slice(lastSlashIdx + 1);
      if (!afterSlash.includes(' ') && val.length > lastSlashIdx) {
        setSkillFilter(afterSlash);
        setSkillPopupOpen(true);
      } else {
        setSkillPopupOpen(false);
      }
    } else {
      setSkillPopupOpen(false);
    }
  };

  const selectSkill = (skill: SkillInfo) => {
    const sn = skill.name.includes('/') ? skill.name.split('/').pop()! : skill.name;
    const lastSlashIdx = input.lastIndexOf('/');
    const newInput = input.slice(0, lastSlashIdx) + `/${sn} `;
    setInput(newInput);
    setSkillPopupOpen(false);
    setSkillFilter('');
    // Focus back on sender input
    setTimeout(() => {
      const senderInput = document.querySelector('.ant-sender-input') as HTMLTextAreaElement;
      senderInput?.focus();
    }, 0);
  };

  const chatSender = !isSharedView && (
    <div style={{ marginInline: 24, maxWidth: 840, width: '100%', alignSelf: 'center' }}>
      {/* Inline question panel — floating above input */}
      {questionReq && (
        <div style={{
          marginBottom: 12, borderRadius: 14, overflow: 'hidden',
          border: '1px solid #d1fae5', background: '#ffffff',
          boxShadow: '0 4px 24px rgba(16, 163, 127, 0.10)',
        }}>
          {/* Header strip */}
          <div style={{
            padding: '10px 16px', background: 'linear-gradient(135deg, #ecfdf5 0%, #f0fdf8 100%)',
            display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #d1fae5',
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%', background: '#10a37f',
              animation: 'pulse 1.5s ease-in-out infinite', flexShrink: 0,
            }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#065f46' }}>Agent 需要您的输入</span>
            <style>{`@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }`}</style>
          </div>
          {/* Question text */}
          <div style={{ padding: '12px 16px', fontSize: 14, color: '#1e293b', lineHeight: 1.6 }}>
            {questionReq.question}
          </div>
          {/* Options or text input */}
          <div style={{ padding: '0 16px 14px' }}>
            {questionReq.options?.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {questionReq.options.map((opt, i) => (
                  <Button
                    key={i}
                    type={questionAnswer === opt ? 'primary' : 'default'}
                    onClick={() => {
                      setQuestionAnswer(opt);
                      // Auto-submit on click for option-based questions
                      setTimeout(() => {
                        if (!questionReq) return;
                        fetch(apiUrl('/v1/chat/resolve_question'), {
                          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                          body: JSON.stringify({ question_id: questionReq.question_id, answer: opt }),
                        }).then(() => { setQuestionReq(null); setQuestionAnswer(''); });
                      }, 0);
                    }}
                    style={{
                      borderRadius: 8, height: 34, fontSize: 13,
                      ...(questionAnswer === opt ? { background: '#10a37f', borderColor: '#10a37f' } : {}),
                    }}
                  >
                    {opt}
                  </Button>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <Input.TextArea
                  value={questionAnswer}
                  onChange={e => setQuestionAnswer(e.target.value)}
                  placeholder="输入您的回答..."
                  autoSize={{ minRows: 1, maxRows: 3 }}
                  style={{ borderRadius: 10, fontSize: 13, flex: 1 }}
                  onPressEnter={e => {
                    if (!e.shiftKey && questionAnswer.trim()) {
                      e.preventDefault();
                      handleResolveQuestion();
                    }
                  }}
                />
                <Button
                  type="primary"
                  disabled={!questionAnswer.trim()}
                  onClick={handleResolveQuestion}
                  style={{
                    borderRadius: 8, height: 34, flexShrink: 0,
                    background: questionAnswer.trim() ? '#10a37f' : undefined,
                    borderColor: questionAnswer.trim() ? '#10a37f' : undefined,
                  }}
                >
                  提交
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ position: 'relative' }}>
        {/* Skill popup */}
        {skillPopupOpen && skillsFiltered.length > 0 && (
          <div style={{
            position: 'absolute', bottom: '100%', left: 0, width: '100%', zIndex: 10,
            marginBottom: 8, padding: '6px 0', background: token.colorBgElevated,
            borderRadius: token.borderRadiusLG, boxShadow: token.boxShadowSecondary,
            maxHeight: 260, overflowY: 'auto', border: `1px solid ${token.colorBorderSecondary}`,
          }}>
            {skillsFiltered.map(skill => {
              const sn = skill.name.includes('/') ? skill.name.split('/').pop()! : skill.name;
              return (
                <div key={skill.name} onClick={() => selectSkill(skill)}
                  style={{
                    padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorBgContainer,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = token.colorFillQuaternary; }}
                  onMouseLeave={e => { e.currentTarget.style.background = token.colorBgContainer; }}
                >
                  <Bot size={16} style={{ color: token.colorPrimary, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>/{sn}</div>
                    <div style={{ fontSize: 11, color: token.colorTextTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skill.description}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className={styles.sender}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: uploadedFiles.length > 0 ? 8 : 0 }}>
            {uploadedFiles.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {uploadedFiles.map(f => {
                  const filename = f.split('/').pop() || f;
                  return (
                    <Tag key={f} closable onClose={() => setUploadedFiles(prev => prev.filter(x => x !== f))}
                      icon={<span style={{ marginRight: 4 }}>{getFileIcon(filename)}</span>} style={{ margin: 0, fontSize: 12, display: 'flex', alignItems: 'center' }}>
                      {filename}
                    </Tag>
                  );
                })}
              </div>
            )}
          </div>
          <Sender
            value={input}
            onChange={handleInputChange}
            onSubmit={(val) => { if (val.trim()) sendMessage(val); }}
            onCancel={stopMessage}
            loading={loading}
            placeholder="Ask me anything... Type / to select a skill"
            style={{ border: 'none', boxShadow: 'none', background: 'transparent', padding: 0 }}
            styles={{ input: { fontSize: 15 } }}
            suffix={false}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Tooltip title="Upload file">
                <div onClick={() => document.getElementById('file-upload-input')?.click()}
                  style={{ width: 32, height: 32, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748b', transition: 'all 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'}
                  onMouseLeave={e => e.currentTarget.style.background = '#f1f5f9'}
                >
                  <Paperclip size={16} />
                </div>
              </Tooltip>
              <Popover
                content={
                  <div style={{ maxHeight: 320, overflowY: 'auto', width: 280 }}>
                    {skills.length === 0 ? (
                      <div style={{ padding: 12, textAlign: 'center' }}><Text type="secondary" style={{ fontSize: 13 }}>No skills available</Text></div>
                    ) : skills.map(skill => {
                      const sn = skill.name.includes('/') ? skill.name.split('/').pop()! : skill.name;
                      return (
                        <div key={skill.name} onClick={() => {
                          setInput(prev => prev + (prev.trim() && !prev.endsWith(' ') ? ' ' : '') + `/${sn} `);
                        }}
                          style={{ padding: '8px 12px', cursor: 'pointer', borderRadius: token.borderRadius, marginBottom: 4 }}
                          onMouseEnter={e => { e.currentTarget.style.background = token.colorFillTertiary; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                        >
                          <div style={{ fontWeight: 500, color: token.colorPrimary, marginBottom: 4, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Bot size={14} /> {skill.name}
                          </div>
                          <div style={{ fontSize: 12, color: token.colorTextSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {skill.description}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                }
                trigger="click"
                placement="topLeft"
              >
                <Tooltip title="Select skill">
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748b', transition: 'all 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'}
                    onMouseLeave={e => e.currentTarget.style.background = '#f1f5f9'}
                  >
                    <LayoutGrid size={16} />
                  </div>
                </Tooltip>
              </Popover>
            </div>
            {loading ? (
              <Button
                type="default"
                shape="circle"
                onClick={stopMessage}
                style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderColor: '#1677ff' }}
                className="custom-send-btn"
                icon={<div style={{ width: 10, height: 10, background: '#1677ff', borderRadius: 2 }} />}
              />
            ) : (
              <Button
                type="primary"
                shape="circle"
                icon={<ArrowUpOutlined />}
                disabled={!input.trim() && uploadedFiles.length === 0}
                onClick={() => { if (input.trim() || uploadedFiles.length > 0) sendMessage(input); }}
                style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                className="custom-send-btn"
              />
            )}
          </div>
        </div>
      </div>
      <style>{`.custom-send-btn { display: flex !important; }`}</style>
      <input type="file" id="file-upload-input" style={{ display: 'none' }} onChange={handleFileUpload} />
    </div>
  );

  // --- Shared view CTA ---
  const sharedCTA = isSharedView && (
    <div style={{ padding: '24px 32px', textAlign: 'center', borderTop: `1px solid ${token.colorBorderSecondary}` }}>
      <Space style={{ marginBottom: 12 }}>
        <Sparkles size={16} style={{ color: token.colorPrimary }} />
        <Text type="secondary">Want to try it out?</Text>
      </Space>
      <div><Button type="primary" onClick={() => { window.location.href = '/'; }}>Sign in to get started</Button></div>
    </div>
  );

  // --- Render ---
  return (
    <ChatCtx.Provider value={{ onReload: undefined }}>
      {/* Login modal */}
      <Modal open={showLogin} closable={false} keyboard={false} mask={{ closable: false }} footer={null} width={400} styles={{ body: { padding: '32px 32px 28px' } }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <Avatar size={56} style={{ background: '#10a37f', borderRadius: 14, marginBottom: 16 }} icon={<Sparkles size={28} color="#fff" />} />
          <Typography.Title level={3} style={{ margin: '0 0 8px', color: '#1e293b' }}>Claw Agent</Typography.Title>
          <Text type="secondary">Sign in to start building</Text>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input size="large" prefix={<CircleUser size={16} style={{ color: token.colorTextQuaternary }} />} placeholder="Work email" value={email} onChange={e => setEmail(e.target.value)} allowClear />
          <Input.Password size="large" prefix={<Lock size={16} style={{ color: token.colorTextQuaternary }} />} placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onPressEnter={handleLogin} allowClear />
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

      <div className={styles.layout} style={{ filter: showLogin ? 'blur(4px)' : 'none', pointerEvents: showLogin ? 'none' : 'auto', userSelect: showLogin ? 'none' : 'auto' }}>
        {sider}
        <div className={styles.chat}>
          <div style={{ position: 'absolute', top: 16, right: 24, display: 'flex', gap: 12, zIndex: 10 }}>
            {isSharedView ? (
              <div style={{ padding: '4px 12px', background: '#f1f5f9', borderRadius: 16, color: '#64748b', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                <Sparkles size={14} style={{ color: token.colorPrimary }} /> 分享预览
              </div>
            ) : (
              <>
                <Button type="text" icon={<ShareAltOutlined />} style={{ color: '#64748b' }} onClick={() => {
                  const url = `${window.location.origin}${window.location.pathname}?share=true&session=${activeSessionId}`;
                  copyToClipboard(url).then((success) => {
                    if (success) message.success('分享链接已复制');
                    else message.error('复制失败，请手动复制链接');
                  });
                }}>分享</Button>
                <Dropdown menu={menuProps} placement="bottomRight" trigger={['click']}>
                  <Button type="text" icon={<MoreHorizontal size={18} />} style={{ color: '#64748b' }} />
                </Dropdown>
              </>
            )}
          </div>
          {chatList}
          {chatSender}
          {sharedCTA}
        </div>
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

      <Modal title="重命名" open={isRenameModalOpen} onOk={() => {
        if (activeSessionId && renameInput.trim() && authToken) {
          renameSession(activeSessionId, renameInput.trim(), authToken);
        }
        setIsRenameModalOpen(false);
      }} onCancel={() => setIsRenameModalOpen(false)}>
        <Input value={renameInput} onChange={e => setRenameInput(e.target.value)} />
      </Modal>

      <Modal title="任务详情" open={isDetailsModalOpen} footer={null} onCancel={() => setIsDetailsModalOpen(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div><strong>任务名：</strong>{activeSession?.title}</div>
          <div><strong>创建时间：</strong>{activeSession?.updated_at ? new Date(activeSession.updated_at.replace(' ', 'T') + (activeSession.updated_at.includes('Z') ? '' : 'Z')).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未知'}</div>
        </div>
      </Modal>

    </ChatCtx.Provider>
  );
}
