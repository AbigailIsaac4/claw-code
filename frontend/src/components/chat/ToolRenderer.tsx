import React from 'react';
import { Typography, theme, Collapse } from 'antd';
import { LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { Terminal, FileText, Edit3, Search, Folder, Zap, ListTodo, Wrench } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

const { Text } = Typography;
const { useToken } = theme;

export interface ToolCall {
  name: string;
  status: string;
  error?: string;
  input: string;
  result?: string;
}

interface Props {
  toolCalls: ToolCall[];
}

const toolIcon = (name: string) => {
  const n = name.toLowerCase();
  const props = { size: 14, style: { color: '#64748b' } };
  if (n === 'bash') return <Terminal {...props} />;
  if (n === 'read') return <FileText {...props} />;
  if (n === 'write' || n === 'edit') return <Edit3 {...props} />;
  if (n === 'grep') return <Search {...props} />;
  if (n === 'glob') return <Folder {...props} />;
  if (n === 'skill') return <Zap {...props} />;
  if (n === 'todowrite') return <ListTodo {...props} />;
  return <Wrench {...props} />;
};

const summarizeInput = (tool: ToolCall): string => {
  const n = tool.name.toLowerCase();
  try {
    const parsed = JSON.parse(tool.input);
    if (n === 'bash' && parsed.command) return (parsed.command as string).substring(0, 60) + ((parsed.command as string).length > 60 ? '...' : '');
    if ((n === 'read' || n === 'write' || n === 'edit') && parsed.file_path) return String(parsed.file_path).split('/').pop() || parsed.file_path;
    if (n === 'grep' && parsed.pattern) return String(parsed.pattern).substring(0, 50);
    if (n === 'glob' && parsed.pattern) return String(parsed.pattern);
    if (n === 'skill' && parsed.skill) return parsed.skill;
    if (n === 'todowrite' && parsed.todos) {
      const done = parsed.todos.filter((t: { status: string }) => t.status === 'completed').length;
      return `${done}/${parsed.todos.length} tasks`;
    }
  } catch {}
  return '';
};

const TodoWriteRenderer: React.FC<{ input: string }> = ({ input }) => {
  const { token } = useToken();
  let todos: { content: string; status: string }[] = [];
  try { todos = JSON.parse(input).todos || []; } catch {}
  if (todos.length === 0) return <Text type="secondary" style={{ fontSize: 12 }}>No tasks</Text>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {todos.map((todo, i) => {
        const icon = todo.status === 'completed' ? <CheckCircleOutlined style={{ color: token.colorSuccess, fontSize: 13 }} />
          : todo.status === 'in_progress' ? <LoadingOutlined style={{ color: token.colorPrimary, fontSize: 13 }} spin />
          : <MinusCircleOutlined style={{ color: token.colorTextQuaternary, fontSize: 13 }} />;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            {icon}
            <span style={{ textDecoration: todo.status === 'completed' ? 'line-through' : 'none', color: todo.status === 'completed' ? token.colorTextQuaternary : token.colorText, fontWeight: todo.status === 'in_progress' ? 600 : 400 }}>
              {todo.content}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const ToolDetailContent: React.FC<{ tool: ToolCall }> = ({ tool }) => {
  const { token } = useToken();
  const isBash = tool.name.toLowerCase() === 'bash';
  const isTodoWrite = tool.name.toLowerCase() === 'todowrite';

  let parsedCommand = tool.input;
  if (isBash) try { parsedCommand = JSON.parse(tool.input).command; } catch {}

  let parsedResult = tool.result || '';
  if (isBash && tool.result) {
    try { const r = JSON.parse(tool.result); parsedResult = (r.stdout || '') + (r.stderr ? '\n[stderr]\n' + r.stderr : ''); } catch {}
  }

  const codeBlockStyle: React.CSSProperties = { background: token.colorFillQuaternary, padding: 10, borderRadius: token.borderRadius, fontSize: 12, overflow: 'auto', margin: '0 0 10px' };
  const labelStyle: React.CSSProperties = { marginBottom: 6, color: token.colorTextSecondary, fontSize: 12 };

  if (isTodoWrite) return <TodoWriteRenderer input={tool.input} />;

  if (isBash) {
    return (
      <div style={{ fontSize: 13 }}>
        <div style={labelStyle}>Command</div>
        <pre style={codeBlockStyle}><code>{parsedCommand}</code></pre>
        {parsedResult && (
          <>
            <div style={labelStyle}>Output</div>
            <div style={{ maxHeight: 300, overflowY: 'auto', padding: '8px 12px', background: token.colorFillQuaternary, borderRadius: token.borderRadius, fontSize: 13 }}>
              <ReactMarkdown>{parsedResult}</ReactMarkdown>
            </div>
          </>
        )}
        {tool.error && <div style={{ color: token.colorError, whiteSpace: 'pre-wrap', marginTop: 8, fontSize: 12 }}>{tool.error}</div>}
      </div>
    );
  }

  return (
    <div style={{ fontSize: 13 }}>
      <div style={labelStyle}>Input</div>
      <pre style={codeBlockStyle}><code>{tool.input}</code></pre>
      {tool.result && (
        <>
          <div style={labelStyle}>Result</div>
          <div style={{ maxHeight: 400, overflowY: 'auto', padding: '8px 12px', background: token.colorFillQuaternary, borderRadius: token.borderRadius, fontSize: 13 }}>
            <ReactMarkdown>{tool.result}</ReactMarkdown>
          </div>
        </>
      )}
      {tool.error && <div style={{ color: token.colorError, marginTop: 8, fontSize: 12 }}>{tool.error}</div>}
    </div>
  );
};

export const ToolRenderer: React.FC<Props> = ({ toolCalls }) => {
  const { token } = useToken();
  if (!toolCalls?.length) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      {toolCalls.map((tool, idx) => {
        const isRunning = tool.status === 'running';
        const isError = tool.status === 'error';
        const isDone = tool.status === 'done';
        
        let statusIcon;
        if (isRunning) statusIcon = <LoadingOutlined style={{ color: token.colorPrimary, fontSize: 12 }} />;
        else if (isError) statusIcon = <CloseCircleOutlined style={{ color: token.colorError, fontSize: 12 }} />;
        else if (isDone) statusIcon = <CheckCircleOutlined style={{ color: token.colorSuccess, fontSize: 12 }} />;
        else statusIcon = <MinusCircleOutlined style={{ color: token.colorTextQuaternary, fontSize: 12 }} />;

        return (
          <Collapse
            key={idx}
            ghost
            expandIcon={() => null}
            style={{ marginBottom: 12 }}
            items={[
              {
                key: '1',
                label: (
                  <span style={{ fontSize: 13, color: token.colorTextSecondary, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {statusIcon}
                    <span style={{ fontWeight: 500, color: token.colorTextHeading }}>{tool.name}</span>
                    <span style={{ color: token.colorTextTertiary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '60%' }}>
                      {summarizeInput(tool)}
                    </span>
                  </span>
                ),
                children: (
                  <div style={{ paddingLeft: 12, borderLeft: `2px solid ${token.colorBorderSecondary}`, marginLeft: 6 }}>
                    <ToolDetailContent tool={tool} />
                  </div>
                )
              }
            ]}
          />
        );
      })}
      <style>{`
        .ant-collapse-ghost > .ant-collapse-item > .ant-collapse-header {
          padding: 4px 0 !important;
          align-items: center;
        }
        .ant-collapse-ghost > .ant-collapse-item > .ant-collapse-content > .ant-collapse-content-box {
          padding: 8px 0 0 0 !important;
        }
      `}</style>
    </div>
  );
};
