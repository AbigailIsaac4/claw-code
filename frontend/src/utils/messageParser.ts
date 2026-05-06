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

export function parseMessageContent(rawContent: string): ParsedMessage {
  let text = rawContent || '';
  let thinkingBlock: string | undefined = undefined;

  // 1. 提取 <thinking>
  const thinkMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/);
  if (thinkMatch) {
    thinkingBlock = thinkMatch[1].trim();
    text = text.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();
  } else if (text.includes('<thinking>')) {
    const parts = text.split('<thinking>');
    thinkingBlock = parts[1].trim();
    text = parts[0].trim();
  }

  // 2. 提取文件挂载样式 (/workspace/...)
  const workspaceFiles = new Set<string>();
  const fileRegex = /(?:\s|^|\()(\/workspace\/[a-zA-Z0-9_.\-/]+)(?:\s|$|\))/g;
  let match;
  while ((match = fileRegex.exec(text)) !== null) {
    workspaceFiles.add(match[1]);
  }

  // 3. (Remvoed) no longer converting /workspace/ to markdown links, to avoid 404 on click.
  const cleanContent = text;

  // 4. 提取 Plan 步骤
  const planSteps: PlanStep[] = [];
  const lines = text.split('\n');
  let currentStep: { num: string; title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const stepMatch = line.match(/^###\s+Step\s+(\d+)\s*[：:]\s*(.+)/i);
    if (stepMatch) {
      if (currentStep) {
        planSteps.push({
          num: currentStep.num,
          title: currentStep.title,
          fullBlock: currentStep.lines.join('\n')
        });
      }
      currentStep = { num: stepMatch[1], title: stepMatch[2].trim(), lines: [line] };
    } else if (currentStep) {
      currentStep.lines.push(line);
    }
  }

  if (currentStep) {
    planSteps.push({
      num: currentStep.num,
      title: currentStep.title,
      fullBlock: currentStep.lines.join('\n')
    });
  }

  return {
    cleanContent,
    thinkingBlock,
    workspaceFiles: Array.from(workspaceFiles),
    planSteps
  };
}
