import React, { useState, useEffect, useRef } from 'react';
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
import { Button, Typography, theme, Modal, Spin } from 'antd';
import ReactMarkdown from 'react-markdown';
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

const { Text } = Typography;
const { useToken } = theme;

interface Props {
  files: string[];
  onDownload: (file: string) => void;
  sessionId?: string;
}

export const getFileStyle = (filename: string): { color: string; bg: string; type: string } => {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return { color: '#fff', bg: '#ef4444', type: 'PDF' };
    case 'doc': case 'docx': return { color: '#fff', bg: '#2563eb', type: 'Word' };
    case 'xls': case 'xlsx': case 'csv': return { color: '#fff', bg: '#16a34a', type: 'Excel' };
    case 'zip': case 'rar': case 'tar': case 'gz': return { color: '#fff', bg: '#8b5cf6', type: 'Archive' };
    case 'jpg': case 'jpeg': case 'png': case 'gif': case 'svg': return { color: '#fff', bg: '#f59e0b', type: 'Image' };
    case 'md': return { color: '#fff', bg: '#3b82f6', type: 'Markdown' };
    case 'json': return { color: '#fff', bg: '#f59e0b', type: 'JSON' };
    case 'txt': return { color: '#fff', bg: '#64748b', type: 'Text' };
    default: return { color: '#fff', bg: '#94a3b8', type: 'File' };
  }
};

export const getFileIcon = (filename: string, style?: React.CSSProperties) => {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return <FilePdfOutlined style={{ color: '#ef4444', ...style }} />;
    case 'doc':
    case 'docx': return <FileWordOutlined style={{ color: '#2563eb', ...style }} />;
    case 'xls':
    case 'xlsx':
    case 'csv': return <FileExcelOutlined style={{ color: '#16a34a', ...style }} />;
    case 'zip':
    case 'rar':
    case 'tar':
    case 'gz': return <FileZipOutlined style={{ color: '#8b5cf6', ...style }} />;
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'svg': return <FileImageOutlined style={{ color: '#f59e0b', ...style }} />;
    case 'txt':
    case 'md':
    case 'json': return <FileTextOutlined style={{ color: '#64748b', ...style }} />;
    default: return <FileOutlined style={{ color: '#64748b', ...style }} />;
  }
};

const FilePreviewer: React.FC<{ file: string; sessionId?: string; onDownload: () => void }> = ({ file, sessionId, onDownload }) => {
  const ext = file.split('.').pop()?.toLowerCase() || '';
  const fileUrl = sessionId ? apiUrl(`/v1/sandbox/workspace/file?path=${encodeURIComponent(file)}&session_id=${sessionId}`) : '';
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!fileUrl) return;
    if (['md', 'txt', 'json', 'js', 'ts', 'py', 'sh', 'rs', 'html', 'css'].includes(ext)) {
      setLoading(true);
      fetch(fileUrl, { headers: { 'Authorization': `Bearer ${localStorage.getItem('claw_token')}` } })
        .then(res => res.text())
        .then(text => { setContent(text); setLoading(false); })
        .catch(() => { setContent('Failed to load content.'); setLoading(false); });
    } else {
      setLoading(false);
    }
  }, [fileUrl, ext]);

  if (!fileUrl) return <div style={{ padding: 40, textAlign: 'center' }}>No session context.</div>;

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: 400 }}><Spin /></div>;
  }

  // Handle different file types
  if (['pdf'].includes(ext)) {
    // We append the auth token to URL query if your API requires it, or just use a standard fetch/blob approach.
    // For simplicity, we assume the API allows direct GET with token via query, or we might need an object URL.
    // To be safe with auth, we'll fetch as blob and create object URL.
    if (!content) {
      setLoading(true);
      fetch(fileUrl, { headers: { 'Authorization': `Bearer ${localStorage.getItem('claw_token')}` } })
        .then(res => res.blob())
        .then(blob => { setContent(URL.createObjectURL(blob)); setLoading(false); })
        .catch(() => { setContent(''); setLoading(false); });
      return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: 400 }}><Spin /></div>;
    }
    return <iframe src={content} width="100%" height="100%" style={{ border: 'none', height: '80vh', display: 'block' }} title="PDF Preview" />;
  }

  if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext)) {
    if (!content) {
      setLoading(true);
      fetch(fileUrl, { headers: { 'Authorization': `Bearer ${localStorage.getItem('claw_token')}` } })
        .then(res => res.blob())
        .then(blob => { setContent(URL.createObjectURL(blob)); setLoading(false); })
        .catch(() => { setContent(''); setLoading(false); });
      return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: 400 }}><Spin /></div>;
    }
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: 400, background: '#f8fafc' }}>
        <img src={content} alt="Preview" style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
      </div>
    );
  }

  if (['md', 'txt', 'json', 'js', 'ts', 'py', 'sh', 'rs', 'html', 'css'].includes(ext)) {
    return (
      <div className="markdown-body" style={{ padding: '24px 32px', height: '80vh', overflowY: 'auto' }}>
        {ext === 'md' ? <ReactMarkdown>{content || ''}</ReactMarkdown> : <pre><code>{content}</code></pre>}
      </div>
    );
  }

  // Unsupported preview fallback
  return (
    <div style={{ padding: '64px 24px', textAlign: 'center', background: '#f8fafc', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ marginBottom: 16 }}>{getFileIcon(file, { fontSize: 64 })}</div>
      <Typography.Title level={4}>Preview not available</Typography.Title>
      <Text type="secondary" style={{ marginBottom: 24, display: 'block' }}>This file type cannot be previewed directly in the browser.</Text>
      <Button type="primary" icon={<DownloadOutlined />} onClick={onDownload}>Download File</Button>
    </div>
  );
};

export const WorkspaceFiles: React.FC<Props> = ({ files, onDownload, sessionId }) => {
  const { token } = useToken();
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  
  if (!files?.length) return null;
  const uniqueFiles = Array.from(new Set(files));

  return (
    <>
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>结果文件</Text>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {uniqueFiles.map((file, idx) => {
            const filename = file.split('/').pop() || file;
            const fileStyle = getFileStyle(filename);
            return (
              <div 
                key={idx} 
                onClick={() => setPreviewFile(file)}
                style={{ 
                  display: 'flex', alignItems: 'center', gap: 12, 
                  padding: '12px 16px', 
                  border: `1px solid ${token.colorBorderSecondary}`, 
                  borderRadius: 12, 
                  background: token.colorBgContainer,
                  cursor: 'pointer',
                  minWidth: 240,
                  maxWidth: 320,
                  flex: 1,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = token.colorPrimary;
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.05)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = token.colorBorderSecondary;
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.02)';
                }}
              >
                <div style={{ 
                  width: 36, height: 36, borderRadius: 8, background: fileStyle.bg, 
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 
                }}>
                  {getFileIcon(filename, { color: fileStyle.color })}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Text strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {filename}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{fileStyle.type} Document</Text>
                </div>
                <Button 
                  type="text" 
                  icon={<DownloadOutlined />} 
                  onClick={(e) => { e.stopPropagation(); onDownload(file); }} 
                  style={{ color: token.colorTextSecondary }}
                />
              </div>
            );
          })}
        </div>
      </div>

      <Modal
        title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{previewFile ? getFileIcon(previewFile) : null} {previewFile?.split('/').pop()}</span>}
        open={!!previewFile}
        onCancel={() => setPreviewFile(null)}
        footer={null}
        width="80vw"
        style={{ top: 24 }}
        styles={{ 
          body: { padding: 0, background: '#fff', borderBottomLeftRadius: 8, borderBottomRightRadius: 8, overflow: 'hidden' },
          header: { padding: '16px 24px', margin: 0, borderBottom: '1px solid #f0f0f0' }
        }}
        destroyOnClose
      >
        {previewFile && (
          <FilePreviewer 
            file={previewFile} 
            sessionId={sessionId} 
            onDownload={() => { setPreviewFile(null); onDownload(previewFile); }} 
          />
        )}
      </Modal>
    </>
  );
};
