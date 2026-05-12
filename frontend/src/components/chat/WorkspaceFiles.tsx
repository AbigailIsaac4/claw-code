import React from 'react';
import { DownloadOutlined, PaperClipOutlined } from '@ant-design/icons';
import { Button, Tag, Typography, theme } from 'antd';

const { Text } = Typography;
const { useToken } = theme;

interface Props {
  files: string[];
  onDownload: (file: string) => void;
}

export const WorkspaceFiles: React.FC<Props> = ({ files, onDownload }) => {
  const { token } = useToken();
  if (!files?.length) return null;

  const uniqueFiles = Array.from(new Set(files));

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>Workspace files</Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {uniqueFiles.map((file) => (
          <div key={file} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadius, background: token.colorBgContainer }}>
            <Tag icon={<PaperClipOutlined />} style={{ marginInlineEnd: 0, cursor: 'pointer' }} onClick={() => onDownload(file)}>
              {file.split('/').pop() || file}
            </Tag>
            <Button type="text" size="small" icon={<DownloadOutlined />} onClick={() => onDownload(file)} />
          </div>
        ))}
      </div>
    </div>
  );
};
