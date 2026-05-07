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
const WORKSPACE_FILE_PATTERNS = [
  /`((?:\/workspace\/|workspace\/)?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)`/g,
  /`((?:\/workspace\/|workspace\/)?[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+)`/g,
  /(?:^|[\s(])((?:\/workspace\/|workspace\/)?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\.[A-Za-z0-9._-]+)(?=$|[\s),.;:])/gm,
  /(?:^|[\s(])((?:\/workspace\/|workspace\/)?[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+)(?=$|[\s),.;:])/gm,
];

function normalizeWorkspaceFile(candidate: string): string | null {
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
  if (!lastPart.includes('.')) {
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

  const thinkMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/);
  if (thinkMatch) {
    thinkingBlock = thinkMatch[1].trim();
    text = text.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();
  } else if (text.includes('<thinking>')) {
    const parts = text.split('<thinking>');
    thinkingBlock = parts[1]?.trim();
    text = parts[0]?.trim() ?? '';
  }

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
