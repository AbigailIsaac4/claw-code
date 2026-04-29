import React from 'react';
import { Typography } from 'antd';
import { PaperClipOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface Props {
  files: string[];
  onDownload: (file: string) => void;
}

export const WorkspaceFiles: React.FC<Props> = ({ files, onDownload }) => {
  if (!files || files.length === 0) return null;

  return (
    <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {files.map(file => (
        <div 
          key={file}
          onClick={(e) => { e.preventDefault(); onDownload(file); }}
          style={{ padding: '8px 12px', background: '#fff', border: '1px solid #e3e3e8', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 2px 4px rgba(0,0,0,0.02)', transition: 'all 0.2s' }}
          onMouseEnter={e => e.currentTarget.style.borderColor = '#1677ff'}
          onMouseLeave={e => e.currentTarget.style.borderColor = '#e3e3e8'}
        >
          <PaperClipOutlined style={{ color: '#1677ff' }} />
          <Text style={{ fontSize: 13 }}>{file.split('/').pop()}</Text>
        </div>
      ))}
    </div>
  );
};
