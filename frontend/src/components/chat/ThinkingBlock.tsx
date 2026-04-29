import React from 'react';
import { Collapse, Typography } from 'antd';
import { BulbOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface Props {
  content?: string;
}

export const ThinkingBlock: React.FC<Props> = ({ content }) => {
  if (!content) return null;

  return (
    <Collapse
      size="small"
      ghost
      items={[{
        key: '1',
        label: <Text type="secondary" style={{ fontSize: 13 }}><BulbOutlined /> 思考过程</Text>,
        children: <div style={{ color: '#888', fontSize: 13, whiteSpace: 'pre-wrap', fontFamily: 'monospace', maxHeight: 300, overflowY: 'auto' }}>{content}</div>
      }]}
      style={{ marginBottom: 12, background: 'rgba(0,0,0,0.02)', borderRadius: 8 }}
    />
  );
};
