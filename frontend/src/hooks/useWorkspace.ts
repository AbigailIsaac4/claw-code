import { useState, useCallback } from 'react';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

export interface WorkspaceFile {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

export function useWorkspace(sessionId: string | null) {
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [workspaceFilesLoading, setWorkspaceFilesLoading] = useState(false);
  const [workspaceSubPath, setWorkspaceSubPath] = useState<string>('');

  const loadWorkspaceFiles = useCallback(async (subPath?: string) => {
    if (!sessionId) {
      setWorkspaceFiles([]);
      return;
    }
    setWorkspaceFilesLoading(true);
    try {
      const token = localStorage.getItem('claw_token');
      const params = new URLSearchParams({ session_id: sessionId });
      if (subPath) params.set('path', subPath);
      const res = await fetch(apiUrl(`/v1/sandbox/files?${params}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const raw: WorkspaceFile[] = data.files || [];
        // Whitelist: only show result/deliverable files that users care about.
        // Hide all directories, scripts, configs, logs, and intermediate artifacts.
        const RESULT_EXTENSIONS = new Set([
          // Documents
          'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'tsv',
          'md', 'txt', 'rtf', 'odt', 'ods', 'odp',
          // Images
          'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff',
          // Data & structured
          'json', 'xml', 'yaml', 'yml',
          // Archives
          'zip', 'tar', 'gz', 'rar', '7z',
          // Web
          'html', 'htm', 'css',
          // Media
          'mp3', 'mp4', 'wav', 'avi', 'mov',
        ]);
        const filtered = raw.filter(f => {
          // Always hide directories — users only need files
          if (f.is_dir) return false;
          // Hide dotfiles
          if (f.name.startsWith('.')) return false;
          // Only show files with known result extensions
          const ext = f.name.split('.').pop()?.toLowerCase() || '';
          return RESULT_EXTENSIONS.has(ext);
        });
        setWorkspaceFiles(filtered);
      }
    } catch (err) {
      console.error('Failed to load workspace files:', err);
    } finally {
      setWorkspaceFilesLoading(false);
    }
  }, [sessionId]);

  const downloadWorkspaceFileFromSidebar = useCallback(async (filePath: string) => {
    if (!sessionId) return;
    try {
      const token = localStorage.getItem('claw_token');
      const params = new URLSearchParams({ session_id: sessionId, path: filePath });
      const res = await fetch(apiUrl(`/v1/sandbox/download?${params}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filePath.split('/').pop() || 'download';
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Failed to download file:', err);
    }
  }, [sessionId]);

  const downloadWorkspaceFile = useCallback(async (filepath?: string | React.MouseEvent) => {
    let filename = '';
    if (typeof filepath === 'string') {
      filename = filepath;
    } else {
      const input = prompt('Enter a workspace-relative file path, for example result.txt or reports/result.pdf');
      if (!input) return;
      filename = input;
    }
    if (!filename || !sessionId) return;

    try {
      const params = new URLSearchParams({ path: filename, session_id: sessionId });
      const res = await fetch(apiUrl(`/v1/sandbox/download?${params.toString()}`), {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('claw_token')}` }
      });
      if (!res.ok) {
        throw new Error('File not found');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.split('/').pop() || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('Failed to download workspace file:', err);
    }
  }, [sessionId]);

  return {
    workspaceFiles,
    workspaceFilesLoading,
    workspaceSubPath,
    setWorkspaceSubPath,
    loadWorkspaceFiles,
    downloadWorkspaceFileFromSidebar,
    downloadWorkspaceFile,
  };
}
