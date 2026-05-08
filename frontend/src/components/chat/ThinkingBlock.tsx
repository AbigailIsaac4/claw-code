import React from 'react';
import { Collapse, Typography } from 'antd';
import { BulbOutlined } from '@ant-design/icons';
import { colors } from '@/styles/tokens';

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
        children: <div style={{ color: colors.textSecondary, fontSize: 13, whiteSpace: 'pre-wrap', fontFamily: 'monospace', maxHeight: 300, overflowY: 'auto' }}>{content}</div>
      }]}
      style={{ marginBottom: 12, background: colors.shadow, borderRadius: 8 }}
    />
  );
};
