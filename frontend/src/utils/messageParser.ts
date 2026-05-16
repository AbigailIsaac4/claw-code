export interface PlanStep {
  num: string;
  title: string;
  fullBlock: string;
}

export interface ParsedMessage {
  cleanContent: string;
  thinkingBlock?: string;
  workspaceFiles: string[];
  planSteps: PlanStep[];
}

const WORKSPACE_PREFIX = /^\/?workspace\//i;
// 匹配除了特定标点符号和空格以外的所有字符（支持中文、大多数Unicode字符）
const namePart = `[^\\s\\/\\\\:"*?<>|\`(),;]+`;
const namePartWithSpace = `[^\`\n]+`; // 在反引号内允许空格等字符

const WORKSPACE_FILE_PATTERNS = [
  // 匹配反引号内的带路径文件或普通文件 (支持空格、中文等)
  new RegExp(`\\\`((?:\\/workspace\\/|workspace\\/)?${namePartWithSpace}(?:\\/${namePartWithSpace})*\\.[A-Za-z0-9]+)\\\``, 'g'),
  new RegExp(`\\\`((?:\\/workspace\\/|workspace\\/)?${namePartWithSpace}(?:\\/${namePartWithSpace})+)\\\``, 'g'),
  
  // 匹配普通文本中的文件路径 (必须带后缀名或路径，不支持带空格)
  new RegExp(`(?:^|[\\s(|<>"'])((?:\\/workspace\\/|workspace\\/)?${namePart}(?:\\/${namePart})+\\.${namePart})(?=$|[\\s),.;:|>"'])`, 'gm'),
  new RegExp(`(?:^|[\\s(|<>"'])((?:\\/workspace\\/|workspace\\/)?${namePart}\\.[A-Za-z0-9]+)(?=$|[\\s),.;:|>"'])`, 'gm'),
];

export function normalizeWorkspaceFile(candidate: string): string | null {
  const trimmed = candidate.trim().replace(/\\/g, '/');
  if (!trimmed || trimmed.includes('://')) {
    return null;
  }

  const normalized = trimmed.replace(WORKSPACE_PREFIX, '');
  if (!normalized || normalized.startsWith('/')) {
    return null;
  }

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  if (parts.some((part) => part === '.' || part === '..' || part.includes(':'))) {
    return null;
  }

  const lastPart = parts.at(-1) ?? '';
  const RESULT_EXTENSIONS = new Set([
    'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'tsv',
    'md', 'txt', 'rtf', 'odt', 'ods', 'odp',
    'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff',
    'json', 'xml', 'yaml', 'yml',
    'zip', 'tar', 'gz', 'rar', '7z',
    'html', 'htm', 'css',
    'mp3', 'mp4', 'wav', 'avi', 'mov',
  ]);

  const ext = lastPart.split('.').pop()?.toLowerCase() || '';
  if (!RESULT_EXTENSIONS.has(ext)) {
    return null;
  }

  return parts.join('/');
}

function extractWorkspaceFiles(text: string): string[] {
  const files = new Set<string>();

  for (const pattern of WORKSPACE_FILE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const normalized = normalizeWorkspaceFile(match[1] ?? '');
      if (normalized) {
        files.add(normalized);
      }
    }
  }

  return Array.from(files);
}

export function parseMessageContent(rawContent: string): ParsedMessage {
  let text = rawContent || '';
  let thinkingBlock: string | undefined;

  // Extract all <thinking>...</thinking> blocks (closed tags)
  const closedBlocks: string[] = [];
  let remaining = text;
  const closedRegex = /<thinking>([\s\S]*?)<\/thinking>/g;
  let match;
  while ((match = closedRegex.exec(text)) !== null) {
    closedBlocks.push(match[1].trim());
  }
  if (closedBlocks.length > 0) {
    thinkingBlock = closedBlocks.join('\n\n---\n\n');
    remaining = remaining.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
  } else if (remaining.includes('<thinking>')) {
    // Unclosed tag during streaming — take content after the last <thinking>
    const parts = remaining.split('<thinking>');
    thinkingBlock = parts[parts.length - 1]?.trim();
    remaining = parts.slice(0, -1).join('<thinking>').trim();
  }
  text = remaining;

  const workspaceFiles = extractWorkspaceFiles(text);
  const cleanContent = text;

  const planSteps: PlanStep[] = [];
  const lines = text.split('\n');
  let currentStep: { num: string; title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const stepMatch = line.match(/^###\s+Step\s+(\d+)\s*[：:]?\s*(.+)/i);
    if (stepMatch) {
      if (currentStep) {
        planSteps.push({
          num: currentStep.num,
          title: currentStep.title,
          fullBlock: currentStep.lines.join('\n'),
        });
      }
      currentStep = {
        num: stepMatch[1],
        title: stepMatch[2].trim(),
        lines: [line],
      };
    } else if (currentStep) {
      currentStep.lines.push(line);
    }
  }

  if (currentStep) {
    planSteps.push({
      num: currentStep.num,
      title: currentStep.title,
      fullBlock: currentStep.lines.join('\n'),
    });
  }

  return {
    cleanContent,
    thinkingBlock,
    workspaceFiles,
    planSteps,
  };
}
