import React from 'react';
import { Collapse, Typography } from 'antd';
import { LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { Highlighter, Markdown } from '@lobehub/ui';
import { colors } from '@/styles/tokens';

const { Text } = Typography;

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
    if (n === 'bash' && parsed.command) {
      const cmd = parsed.command as string;
      return cmd.length > 60 ? cmd.substring(0, 60) + '...' : cmd;
    }
    if (n === 'read' && parsed.file_path) {
      return String(parsed.file_path).split('/').pop() || parsed.file_path;
    }
    if (n === 'write' && parsed.file_path) {
      return String(parsed.file_path).split('/').pop() || parsed.file_path;
    }
    if (n === 'edit' && parsed.file_path) {
      return String(parsed.file_path).split('/').pop() || parsed.file_path;
    }
    if (n === 'grep' && parsed.pattern) {
      return String(parsed.pattern).substring(0, 50);
    }
    if (n === 'glob' && parsed.pattern) {
      return String(parsed.pattern);
    }
    if (n === 'skill' && parsed.skill) {
      return parsed.skill;
    }
    if (n === 'todowrite' && parsed.todos) {
      const count = parsed.todos.length;
      const done = parsed.todos.filter((t: { status: string }) => t.status === 'completed').length;
      return `${done}/${count} tasks`;
    }
  } catch {}
  return '';
};

const TodoWriteRenderer: React.FC<{ input: string; status: string }> = ({ input, status }) => {
  let todos: { content: string; status: string; activeForm?: string }[] = [];
  try {
    const parsed = JSON.parse(input);
    todos = parsed.todos || [];
  } catch {}

  if (todos.length === 0) {
    return <Text type="secondary" style={{ fontSize: 12 }}>No tasks</Text>;
  }

  const statusIcon = (s: string) => {
    if (s === 'completed') return <CheckCircleOutlined style={{ color: colors.success, fontSize: 13 }} />;
    if (s === 'in_progress') return <LoadingOutlined style={{ color: colors.info, fontSize: 13 }} spin />;
    return <MinusCircleOutlined style={{ color: colors.textTertiary, fontSize: 13 }} />;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {todos.map((todo, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          {statusIcon(todo.status)}
          <span style={{
            textDecoration: todo.status === 'completed' ? 'line-through' : 'none',
            color: todo.status === 'completed' ? colors.textTertiary : '#000',
            fontWeight: todo.status === 'in_progress' ? 600 : 400,
          }}>
            {todo.content}
          </span>
        </div>
      ))}
    </div>
  );
};

const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  if (status === 'running') {
    return <LoadingOutlined style={{ color: colors.info, fontSize: 13 }} spin />;
  }
  if (status === 'error') {
    return <CloseCircleOutlined style={{ color: colors.error, fontSize: 13 }} />;
  }
  return <CheckCircleOutlined style={{ color: colors.success, fontSize: 13 }} />;
};

export const ToolRenderer: React.FC<Props> = ({ toolCalls }) => {
  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <Collapse
        size="small"
        ghost
        items={toolCalls.map((tool, idx) => {
          const summary = summarizeInput(tool);
          const isBash = tool.name.toLowerCase() === 'bash';

          let parsedCommand = tool.input;
          if (isBash) {
            try { parsedCommand = JSON.parse(tool.input).command; } catch {}
          }

          let parsedResult = tool.result || '';
          if (isBash && tool.result) {
            try {
              const res = JSON.parse(tool.result);
              parsedResult = (res.stdout || '') + (res.stderr ? '\n[stderr]\n' + res.stderr : '');
            } catch {}
          }

          const isTodoWrite = tool.name.toLowerCase() === 'todowrite';

          return {
            key: String(idx),
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <StatusIcon status={tool.status} />
                <span style={{ fontWeight: 500 }}>{toolIcon(tool.name)} {tool.name}</span>
                {summary && (
                  <Text type="secondary" ellipsis style={{ flex: 1, fontSize: 12, fontWeight: 400 }}>
                    {summary}
                  </Text>
                )}
              </div>
            ),
            children: (
              <div style={{ fontSize: 13 }}>
                {isTodoWrite ? (
                  <TodoWriteRenderer input={tool.input} status={tool.status} />
                ) : isBash ? (
                  <>
                    <div style={{ marginBottom: 6, color: colors.textSecondary, fontSize: 12 }}>Command</div>
                    <Highlighter language="bash" style={{ marginBottom: 10 }}>{parsedCommand}</Highlighter>
                    {parsedResult && (
                      <>
                        <div style={{ marginBottom: 6, color: colors.textSecondary, fontSize: 12 }}>Output</div>
                        <div style={{ maxHeight: 300, overflowY: 'auto', padding: '8px 12px', background: colors.bgTertiary, borderRadius: 6, fontSize: 13 }}>
                          <Markdown>{parsedResult}</Markdown>
                        </div>
                      </>
                    )}
                    {tool.error && (
                      <div style={{ color: colors.error, whiteSpace: 'pre-wrap', marginTop: 8, fontSize: 12 }}>{tool.error}</div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ marginBottom: 6, color: colors.textSecondary, fontSize: 12 }}>Input</div>
                    <Highlighter language="json" style={{ marginBottom: 10 }}>{tool.input}</Highlighter>
                    {tool.result && (
                      <>
                        <div style={{ marginBottom: 6, color: colors.textSecondary, fontSize: 12 }}>Result</div>
                        <div style={{ maxHeight: 400, overflowY: 'auto', padding: '8px 12px', background: colors.bgTertiary, borderRadius: 6, fontSize: 13 }}>
                          <Markdown>{tool.result}</Markdown>
                        </div>
                      </>
                    )}
                    {tool.error && <div style={{ color: colors.error, marginTop: 8, fontSize: 12 }}>{tool.error}</div>}
                  </>
                )}
              </div>
            ),
          };
        })}
        style={{ background: colors.shadow, borderRadius: 8, border: `1px solid ${colors.borderLight}` }}
      />
    </div>
  );
};
