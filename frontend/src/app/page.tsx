'use client';

import { useState, useRef, useEffect, memo, createContext, useContext } from 'react';
import { Button, Input, Modal, Typography, Space, Avatar, App as AntdApp, Tooltip, Radio, Tag, theme, Flex, Popover } from 'antd';
import { Bubble, Conversations, Welcome, Sender, Think, ThoughtChain, Actions } from '@ant-design/x';
import type { BubbleListProps } from '@ant-design/x';
import {
  Trash2, CircleUser, Lock, Paperclip,
  Bot, Copy, Folder, FileText,
  RefreshCw, Globe, RefreshCcw, LayoutGrid,
  ChevronRight, Sparkles
} from 'lucide-react';
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
    background: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  `,
  sider: css`
    background: #f8fafc;
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
    padding-block: ${token.paddingLG}px;
    justify-content: space-between;
    .ant-bubble-content-updating {
      background-image: linear-gradient(90deg, ${token.colorPrimary} 0%, #7c3aed 50%, ${token.colorPrimary} 100%);
      background-size: 100% 2px;
      background-repeat: no-repeat;
      background-position: bottom;
    }
  `,
  chatList: css`
    flex: 1; overflow-y: auto;
    display: flex; flex-direction: column; align-items: center; width: 100%;
    background: #ffffff;
  `,
  placeholder: css`
    padding: ${token.paddingLG}px; box-sizing: border-box; width: 100%;
  `,
  sender: css`
    width: 100%; max-width: 768px; margin: 0 auto;
    box-shadow: 0 4px 24px rgba(0,0,0,0.06);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.85);
    backdrop-filter: blur(16px);
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
        { key: 'copy', actionRender: <Actions.Copy icon={<Copy size={14}/>} text={content} /> },
        { key: 'retry', icon: <RefreshCcw size={14} />, label: 'Retry', onItemClick: () => { if (id) ctx.onReload?.(id, {}); } },
      ]}
    />
  );
};

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
  const [loading, setLoading] = useState(false);
  const [isSharedView, setIsSharedView] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  const {
    sendMessage: sendMessageRaw,
    activeToolName,
    activeToolSummary,
    currentIteration,
  } = useChatStream({
    token: authToken, sessions, activeSessionId, activeSession,
    setSessions, setActiveSessionId,
    streamingSessionRef, loadingRef, setLoading,
    withAssistantTail, updateSessionMessages,
    loadSessionDetail, loadWorkspaceFiles,
    workspaceSubPath,
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
            <div className="msg-hover-copy" style={{ position: 'relative' }}>
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
              <Button type="text" size="small" icon={<Copy size={14} />} onClick={handleCopy} className="copy-btn" style={{ position: 'absolute', top: -4, right: -4, opacity: 0 }} />
            </div>
          );
        }
        return (
          <div className="msg-hover-copy" style={{ position: 'relative' }}>
            <div style={{ whiteSpace: 'pre-wrap', paddingRight: 28 }}>{content}</div>
            <Button type="text" size="small" icon={<Copy size={14} />} onClick={handleCopy} className="copy-btn" style={{ position: 'absolute', top: 0, right: 0, opacity: 0 }} />
          </div>
        );
      },
    },
    ai: {
      placement: 'start',
      typing: true,
      avatar: <Avatar icon={<Bot size={20} color="#fff" />} style={{ background: '#10a37f', flexShrink: 0 }} />,
      header: (_content: string, info) => {
        const cfg = STATUS_CONFIG[info.status as string];
        if (!cfg) return null;
        const isActive = info.status === 'loading' || info.status === 'updating';
        const iterPrefix = isActive && currentIteration > 1 ? `Step ${currentIteration} · ` : '';
        const toolLabel = isActive && activeToolName
          ? `${iterPrefix}${activeToolName}${activeToolSummary ? ': ' + activeToolSummary : ''}`
          : `${iterPrefix}${cfg.title}`;
        return (
          <ThoughtChain.Item
            style={{ marginBottom: 8 }}
            status={cfg.status as any}
            variant="solid"
            icon={<Globe size={14} />}
            title={toolLabel}
          />
        );
      },
      contentRender: (content: string, info) => {
        const parsed = parseMessageContent(content || '');
        const isStreaming = info.status === 'loading';
        const handleCopy = async () => { await copyToClipboard(parsed.cleanContent) ? message.success('Copied') : message.error('Failed'); };
        return (
          <MsgCtx.Provider value={{ status: info.status }}>
            <div className="msg-hover-copy" style={{ position: 'relative', lineHeight: 1.75 }}>
              <ThinkComponent content={parsed.thinkingBlock} isStreaming={isStreaming} status={info.status} />
              <div style={{ paddingRight: 28, color: '#334155', fontSize: '15px' }}>
                <ReactMarkdown>{parsed.cleanContent || ''}</ReactMarkdown>
              </div>
              <Button type="text" size="small" icon={<Copy size={14} />} onClick={handleCopy} className="copy-btn" style={{ position: 'absolute', top: 0, right: 0, opacity: 0 }} />
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
        <Avatar shape="square" size={30} style={{ background: '#10a37f', borderRadius: 8 }} icon={<Sparkles size={16} color="#fff" />} />
        <span style={{ color: '#1e293b' }}>Claw Agent</span>
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
        <Avatar size={24} style={{ background: '#334155' }} icon={<CircleUser size={14} color="#fff" />} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text strong style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1e293b' }}>{fullName}</Text>
        </div>
        <Tooltip title="Sign out">
          <Button type="text" size="small" onClick={handleLogout} icon={<CircleUser size={16} />} style={{ color: token.colorTextQuaternary }} />
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
              extraInfo: { toolCalls: msg.toolCalls },
            };
          })}
          styles={{ root: { maxWidth: 860, width: '100%', padding: '0 24px' } }}
          role={bubbleRole}
        />
        {/* Inline question indicator in chat stream */}
        {questionReq && (
          <div style={{
            maxWidth: 860, width: '100%', padding: '12px 24px', margin: '0 auto',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 18px', borderRadius: 12,
              background: 'linear-gradient(135deg, #f0fdf8 0%, #ecfdf5 100%)',
              border: '1px solid #a7f3d0',
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', background: '#10a37f', flexShrink: 0,
                animation: 'pulse 1.5s ease-in-out infinite',
              }} />
              <span style={{ fontSize: 13, color: '#065f46', fontWeight: 500 }}>
                Agent 正在等待您的回答，请在弹窗中回复…
              </span>
              <style>{`@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }`}</style>
            </div>
          </div>
        )}
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
      {/* Skill popup */}
      {skillPopupOpen && skillsFiltered.length > 0 && (
        <div style={{
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

      <Sender
        value={input}
        onChange={handleInputChange}
        onSubmit={(val) => { if (val.trim()) sendMessage(val); }}
        onCancel={() => {}}
        loading={loading}
        className={styles.sender}
        placeholder="Ask me anything... Type / to select a skill"
        header={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {uploadedFiles.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {uploadedFiles.map(f => (
                  <Tag key={f} closable onClose={() => setUploadedFiles(prev => prev.filter(x => x !== f))}
                    icon={<Paperclip size={12} />} style={{ margin: 0, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    {f.split('/').pop()}
                  </Tag>
                ))}
              </div>
            )}
          </div>
        }
        prefix={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tooltip title="Upload file">
              <Paperclip
                size={18}
                style={{ cursor: 'pointer', color: token.colorTextQuaternary }}
                onClick={() => document.getElementById('file-upload-input')?.click()}
              />
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
                <LayoutGrid
                  size={18}
                  style={{ cursor: 'pointer', color: token.colorTextQuaternary }}
                />
              </Tooltip>
            </Popover>
          </div>
        }
      />
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

  // --- Workspace sidebar ---
  const workspaceSider = !isSharedView && (
    <div style={{ width: 280, height: '100%', display: 'flex', flexDirection: 'column', background: '#f8fafc', borderLeft: '1px solid #e2e8f0' }}>
      <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text strong style={{ fontSize: 15, color: '#1e293b' }}>Workspace</Text>
        <Button type="text" size="small" icon={<RefreshCw size={14} />} onClick={() => loadWorkspaceFiles(workspaceSubPath || undefined)} loading={workspaceFilesLoading} />
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
            <Folder size={14} /> ..
          </div>
        )}
        {workspaceFiles.length === 0 && !workspaceFilesLoading ? (
          <div style={{ textAlign: 'center', padding: '32px 16px' }}>
            <Folder size={32} style={{ color: token.colorBorder, marginBottom: 8 }} />
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              {!activeSessionId ? 'Select a session' : workspaceSubPath === 'output' ? 'No result files' : 'No files here'}
            </Text>
          </div>
        ) : workspaceFiles.map((file, idx) => (
          <Tooltip key={idx} title={file.is_dir ? 'Open folder' : 'Download'} placement="left">
            <div className="workspace-file-item"
              style={{ padding: '6px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, borderRadius: 4, margin: '1px 4px' }}
              onClick={() => file.is_dir ? (setWorkspaceSubPath(file.path), void loadWorkspaceFiles(file.path)) : downloadWorkspaceFileFromSidebar(file.path)}>
              {file.is_dir ? <Folder size={14} style={{ color: token.colorWarning }} /> : <FileText size={14} style={{ color: token.colorTextQuaternary }} />}
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

      {/* Question Modal — Enterprise interactive dialog */}
      <Modal
        open={!!questionReq}
        closable={false}
        keyboard={false}
        mask={{ closable: false }}
        footer={null}
        width={520}
        styles={{ body: { padding: '28px 32px' } }}
      >
        {/* Header with icon */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'linear-gradient(135deg, #10a37f 0%, #0d8c6d 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Bot size={22} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a' }}>Agent 需要您的输入</div>
            <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>请回答以下问题以继续执行任务</div>
          </div>
        </div>

        {/* Question text */}
        <div style={{
          background: '#f8fafc', border: '1px solid #e8edf2', borderRadius: 10,
          padding: '16px 20px', marginBottom: 20, lineHeight: 1.7,
          fontSize: 15, color: '#334155',
        }}>
          {questionReq?.question}
        </div>

        {/* Options or free-text input */}
        {questionReq?.options?.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {questionReq.options.map((opt, i) => (
              <div
                key={i}
                onClick={() => setQuestionAnswer(opt)}
                style={{
                  padding: '12px 16px', borderRadius: 10, cursor: 'pointer',
                  border: questionAnswer === opt ? '2px solid #10a37f' : '1.5px solid #e2e8f0',
                  background: questionAnswer === opt ? '#f0fdf8' : '#fff',
                  transition: 'all 0.2s ease',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}
                onMouseEnter={e => {
                  if (questionAnswer !== opt) {
                    (e.currentTarget as HTMLElement).style.borderColor = '#94a3b8';
                    (e.currentTarget as HTMLElement).style.background = '#f8fafc';
                  }
                }}
                onMouseLeave={e => {
                  if (questionAnswer !== opt) {
                    (e.currentTarget as HTMLElement).style.borderColor = '#e2e8f0';
                    (e.currentTarget as HTMLElement).style.background = '#fff';
                  }
                }}
              >
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  border: questionAnswer === opt ? '6px solid #10a37f' : '2px solid #cbd5e1',
                  transition: 'all 0.2s ease',
                }} />
                <span style={{ fontSize: 14, color: '#334155', lineHeight: 1.5 }}>{opt}</span>
              </div>
            ))}
          </div>
        ) : (
          <Input.TextArea
            value={questionAnswer}
            onChange={e => setQuestionAnswer(e.target.value)}
            placeholder="输入您的回答..."
            rows={3}
            style={{
              marginBottom: 20, borderRadius: 10, fontSize: 14,
              border: '1.5px solid #e2e8f0', padding: '12px 16px',
            }}
            onPressEnter={e => {
              if (!e.shiftKey && questionAnswer.trim()) {
                e.preventDefault();
                handleResolveQuestion();
              }
            }}
          />
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button
            onClick={() => { setQuestionAnswer('skip'); setTimeout(handleResolveQuestion, 0); }}
            style={{ borderRadius: 8, height: 38, padding: '0 20px' }}
          >
            跳过
          </Button>
          <Button
            type="primary"
            disabled={!questionAnswer.trim()}
            onClick={handleResolveQuestion}
            style={{
              borderRadius: 8, height: 38, padding: '0 24px',
              background: questionAnswer.trim() ? '#10a37f' : undefined,
              borderColor: questionAnswer.trim() ? '#10a37f' : undefined,
            }}
          >
            提交回答
          </Button>
        </div>
      </Modal>
    </ChatCtx.Provider>
  );
}
