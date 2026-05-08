import React from 'react';
import { Collapse, Typography } from 'antd';
import { LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { Highlighter } from '@lobehub/ui';

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
  } catch {}
  return '';
};

const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  if (status === 'running') {
    return <LoadingOutlined style={{ color: '#1677ff', fontSize: 13 }} spin />;
  }
  if (status === 'error') {
    return <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 13 }} />;
  }
  return <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 13 }} />;
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
                {isBash ? (
                  <>
                    <div style={{ marginBottom: 6, color: '#888', fontSize: 12 }}>Command</div>
                    <Highlighter language="bash" style={{ marginBottom: 10 }}>{parsedCommand}</Highlighter>
                    {parsedResult && (
                      <>
                        <div style={{ marginBottom: 6, color: '#888', fontSize: 12 }}>Output</div>
                        <Highlighter language="bash" style={{ maxHeight: 300, overflowY: 'auto' }}>
                          {parsedResult}
                        </Highlighter>
                      </>
                    )}
                    {tool.error && (
                      <div style={{ color: '#ff4d4f', whiteSpace: 'pre-wrap', marginTop: 8, fontSize: 12 }}>{tool.error}</div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ marginBottom: 6, color: '#888', fontSize: 12 }}>Input</div>
                    <Highlighter language="json" style={{ marginBottom: 10 }}>{tool.input}</Highlighter>
                    {tool.result && (
                      <>
                        <div style={{ marginBottom: 6, color: '#888', fontSize: 12 }}>Result</div>
                        <Highlighter language="json" style={{ maxHeight: 200, overflowY: 'auto' }}>
                          {tool.result.substring(0, 1000) + (tool.result.length > 1000 ? '\n...[truncated]' : '')}
                        </Highlighter>
                      </>
                    )}
                    {tool.error && <div style={{ color: '#ff4d4f', marginTop: 8, fontSize: 12 }}>{tool.error}</div>}
                  </>
                )}
              </div>
            ),
          };
        })}
        style={{ background: 'rgba(0,0,0,0.015)', borderRadius: 8, border: '1px solid rgba(0,0,0,0.04)' }}
      />
    </div>
  );
};
