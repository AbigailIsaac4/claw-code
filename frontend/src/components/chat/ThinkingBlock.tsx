import React from 'react';
import { Collapse, theme } from 'antd';
import ReactMarkdown from 'react-markdown';
import { Sparkles } from 'lucide-react';

const { useToken } = theme;

interface Props {
  content?: string;
  isStreaming?: boolean;
}

export const ThinkingBlock: React.FC<Props> = ({ content, isStreaming }) => {
  const { token } = useToken();
  if (!content) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <Collapse
        ghost
        expandIconPosition="end"
        items={[
          {
            key: '1',
            label: (
              <span style={{ fontSize: 13, color: token.colorTextSecondary }}>
                <Sparkles size={12} style={{ marginRight: 6 }} />
                Thought process
              </span>
            ),
            children: (
              <div style={{ paddingLeft: 8, borderLeft: `2px solid ${token.colorBorderSecondary}`, marginLeft: 4, maxHeight: 300, overflowY: 'auto', fontSize: 13, lineHeight: 1.7, opacity: 0.85 }}>
                <ReactMarkdown>{content}</ReactMarkdown>
              </div>
            )
          }
        ]}
      />
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
