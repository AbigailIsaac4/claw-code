import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeHydratedMessages, type HydratedMessage } from './sessionHydration.ts';

const user = (content: string): HydratedMessage => ({
  id: `user-${content}`,
  role: 'user',
  content,
});

const assistant = (content: string): HydratedMessage => ({
  id: `assistant-${content}`,
  role: 'assistant',
  content,
});

test('dedupes consecutive identical user prompts from a recovered session', () => {
  const messages = normalizeHydratedMessages([user('same'), user('same')]);

  assert.deepEqual(messages.map((message) => message.content), ['same']);
});

test('keeps an in-flight assistant placeholder after refreshing an active turn', () => {
  const messages = normalizeHydratedMessages([user('work')], {
    activeTurn: true,
    generateId: () => 'pending-assistant',
  });

  assert.deepEqual(messages, [
    user('work'),
    {
      id: 'pending-assistant',
      role: 'assistant',
      content: '',
      streaming: true,
    },
  ]);
});

test('does not replace streamed assistant content with a placeholder', () => {
  const messages = normalizeHydratedMessages([user('work'), assistant('partial')], {
    activeTurn: true,
    generateId: () => 'pending-assistant',
  });

  assert.equal(messages.at(-1)?.content, 'partial');
});
