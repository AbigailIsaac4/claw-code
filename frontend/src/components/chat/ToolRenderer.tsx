import React from 'react';
import { Collapse, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';

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

export const ToolRenderer: React.FC<Props> = ({ toolCalls }) => {
  if (!toolCalls || toolCalls.length === 0) return null;

  const hasRunning = toolCalls.some(t => t.status === 'running');

  return (
    <Collapse
      size="small"
      ghost
      defaultActiveKey={hasRunning ? ['tools'] : []}
      items={[{
        key: 'tools',
        label: (
          <Text type="secondary" style={{ fontSize: 13 }}>
            <SettingOutlined /> {toolCalls.length} 个工具调用 {hasRunning ? '(执行中...)' : ''}
          </Text>
        ),
        children: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {toolCalls.map((tool, idx) => {
              const isBash = tool.name === 'Bash' || tool.name === 'bash';
              
              let parsedCommand = tool.input;
              if (isBash) {
                try { parsedCommand = JSON.parse(tool.input).command; } catch(e) {}
              }

              let parsedResult = tool.result || '';
              if (isBash && tool.result) {
                try {
                  const res = JSON.parse(tool.result);
                  parsedResult = (res.stdout || '') + (res.stderr ? '\n[stderr]\n' + res.stderr : '');
                } catch(e) {}
              }

              return (
                <div key={idx} style={{ border: '1px solid rgba(0,0,0,0.06)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
                  <div style={{ background: '#f8f9fa', padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text strong style={{ fontSize: 13, color: '#333', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <SettingOutlined style={{ color: '#888' }} /> {tool.name}{' '}
                      {tool.status === 'running' ? (
                        <span style={{ color: '#1677ff', fontWeight: 'normal', fontSize: 12 }}>(执行中...)</span>
                      ) : tool.error ? (
                        <span style={{ color: '#ff4d4f', fontWeight: 'normal', fontSize: 12 }}>(失败)</span>
                      ) : (
                        <span style={{ color: '#52c41a', fontWeight: 'normal', fontSize: 12 }}>(完成)</span>
                      )}
                    </Text>
                  </div>
                  
                  {isBash ? (
                    <div style={{ background: '#0d1117', padding: 16, fontFamily: 'ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,Liberation Mono,monospace', fontSize: 13, borderRadius: 0 }}>
                      <div style={{ color: '#3fb950', marginBottom: 8 }}>$ {parsedCommand}</div>
                      {parsedResult && (
                        <div style={{ color: '#ccc', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflowY: 'auto' }}>
                          {parsedResult}
                        </div>
                      )}
                      {tool.error && (
                        <div style={{ color: '#ff4d4f', whiteSpace: 'pre-wrap' }}>{tool.error}</div>
                      )}
                    </div>
                  ) : (
                    <div style={{ padding: 16, background: '#fff', fontSize: 13 }}>
                      <div style={{ color: '#888', marginBottom: 8 }}>输入参数:</div>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', background: '#f8f9fa', padding: 12, border: '1px solid rgba(0,0,0,0.04)', borderRadius: 8 }}>{tool.input}</pre>
                      {tool.result && (
                        <>
                          <div style={{ color: '#888', marginTop: 12, marginBottom: 8 }}>执行结果:</div>
                          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', background: '#f8f9fa', padding: 12, border: '1px solid rgba(0,0,0,0.04)', borderRadius: 8, maxHeight: 200, overflowY: 'auto' }}>
                            {tool.result.substring(0, 1000) + (tool.result.length > 1000 ? '\n...[已省略长输出]' : '')}
                          </pre>
                        </>
                      )}
                      {tool.error && <div style={{ color: '#ff4d4f', marginTop: 8 }}>{tool.error}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      }]}
      style={{ marginTop: 12, background: 'rgba(0,0,0,0.02)', borderRadius: 8 }}
    />
  );
};
