import React from 'react';
import { Think } from '@ant-design/x';
import ReactMarkdown from 'react-markdown';

interface Props {
  content?: string;
  isStreaming?: boolean;
}

export const ThinkingBlock: React.FC<Props> = ({ content, isStreaming }) => {
  if (!content) return null;

  return (
    <Think
      title="Thinking"
      loading={isStreaming}
      blink={isStreaming}
      style={{ marginBottom: 12 }}
    >
      <div style={{ maxHeight: 300, overflowY: 'auto', fontSize: 13, lineHeight: 1.7 }}>
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </Think>
  );
};
