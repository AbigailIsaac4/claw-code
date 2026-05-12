import React from 'react';
import { ThoughtChain } from '@ant-design/x';
import { Typography, theme } from 'antd';
import { LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined, MinusCircleOutlined } from '@ant-design/icons';
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
  if (n === 'bash') return '>_';
  if (n === 'read') return '📄';
  if (n === 'write' || n === 'edit') return '✏️';
  if (n === 'grep') return '🔍';
  if (n === 'glob') return '📂';
  if (n === 'skill') return '⚡';
  if (n === 'todowrite') return '📋';
  return '🔧';
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

const mapStatus = (s: string): 'loading' | 'success' | 'error' | 'abort' | undefined =>
  s === 'running' ? 'loading' : s === 'error' ? 'error' : s === 'done' ? 'success' : undefined;

export const ToolRenderer: React.FC<Props> = ({ toolCalls }) => {
  if (!toolCalls?.length) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <ThoughtChain
        items={toolCalls.map((tool, idx) => ({
          key: String(idx),
          title: `${toolIcon(tool.name)} ${tool.name}`,
          description: summarizeInput(tool) || undefined,
          status: mapStatus(tool.status),
          content: <ToolDetailContent tool={tool} />,
          collapsible: true,
        }))}
      />
    </div>
  );
};
