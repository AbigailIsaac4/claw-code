import React from 'react';
import { DownloadOutlined, PaperClipOutlined } from '@ant-design/icons';
import { Button, Tag, Typography } from 'antd';
import { colors } from '@/styles/tokens';

const { Text } = Typography;

interface Props {
  files: string[];
  onDownload: (file: string) => void;
}

export const WorkspaceFiles: React.FC<Props> = ({ files, onDownload }) => {
  if (!files || files.length === 0) return null;

  const uniqueFiles = Array.from(new Set(files));

  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>工作区文件</Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {uniqueFiles.map((file) => (
          <div
            key={file}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 8px',
              border: `1px solid ${colors.borderDark}`,
              borderRadius: 10,
              background: colors.bgPrimary,
            }}
          >
            <Tag
              icon={<PaperClipOutlined />}
              style={{ marginInlineEnd: 0, cursor: 'pointer' }}
              onClick={() => onDownload(file)}
            >
              {file.split('/').pop() || file}
            </Tag>
            <Button
              type="text"
              size="small"
              icon={<DownloadOutlined />}
              onClick={() => onDownload(file)}
              title={`下载 ${file}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
