export interface HydratedToolCall {
  id: string;
  name: string;
  input: string;
  result?: string;
  error?: string;
  status: 'running' | 'done' | 'error';
}

export interface HydratedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: HydratedToolCall[];
  streaming?: boolean;
}

interface NormalizeOptions {
  activeTurn?: boolean;
  generateId?: () => string;
}

const fallbackId = () => `pending-${Date.now().toString(36)}`;

export function normalizeHydratedMessages(
  messages: HydratedMessage[],
  options: NormalizeOptions = {},
): HydratedMessage[] {
  const normalized: HydratedMessage[] = [];

  for (const message of messages) {
    const previous = normalized.at(-1);
    if (
      message.role === 'user' &&
      previous?.role === 'user' &&
      previous.content === message.content
    ) {
      continue;
    }
    normalized.push(message);
  }

  if (options.activeTurn && normalized.at(-1)?.role === 'user') {
    normalized.push({
      id: options.generateId?.() ?? fallbackId(),
      role: 'assistant',
      content: '',
      streaming: true,
    });
  }

  return normalized;
}
