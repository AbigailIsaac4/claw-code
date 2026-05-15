import React from 'react';
import { 
  DownloadOutlined, 
  FilePdfOutlined, 
  FileWordOutlined, 
  FileExcelOutlined, 
  FileZipOutlined, 
  FileImageOutlined, 
  FileTextOutlined, 
  FileOutlined 
} from '@ant-design/icons';
import { Button, Tag, Typography, theme } from 'antd';

const { Text } = Typography;
const { useToken } = theme;

interface Props {
  files: string[];
  onDownload: (file: string) => void;
}

export const getFileIcon = (filename: string) => {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return <FilePdfOutlined style={{ color: '#ef4444' }} />;
    case 'doc':
    case 'docx': return <FileWordOutlined style={{ color: '#2563eb' }} />;
    case 'xls':
    case 'xlsx':
    case 'csv': return <FileExcelOutlined style={{ color: '#16a34a' }} />;
    case 'zip':
    case 'rar':
    case 'tar':
    case 'gz': return <FileZipOutlined style={{ color: '#8b5cf6' }} />;
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'svg': return <FileImageOutlined style={{ color: '#f59e0b' }} />;
    case 'txt':
    case 'md':
    case 'json': return <FileTextOutlined style={{ color: '#64748b' }} />;
    default: return <FileOutlined style={{ color: '#64748b' }} />;
  }
};

export const WorkspaceFiles: React.FC<Props> = ({ files, onDownload }) => {
  const { token } = useToken();
  if (!files?.length) return null;

  const uniqueFiles = Array.from(new Set(files));

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>Workspace files</Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {uniqueFiles.map((file) => {
          const filename = file.split('/').pop() || file;
          return (
            <div key={file} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadius, background: token.colorBgContainer }}>
              <Tag icon={getFileIcon(filename)} style={{ marginInlineEnd: 0, cursor: 'pointer', background: 'transparent', border: 'none' }} onClick={() => onDownload(file)}>
                {filename}
              </Tag>
              <Button type="text" size="small" icon={<DownloadOutlined />} onClick={() => onDownload(file)} />
            </div>
          );
        })}
      </div>
    </div>
  );
};
