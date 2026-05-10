import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { TopicPack } from './types.js';

export function loadTopicPack(path: string): TopicPack {
  const raw = readFileSync(path, 'utf8');
  const parsed = parse(raw) as TopicPack;

  if (!parsed.name) throw new Error(`Topic pack at ${path} missing 'name'`);
  if (!parsed.systemPrompt) throw new Error(`Topic pack at ${path} missing 'systemPrompt'`);
  if (!parsed.outputSchema) throw new Error(`Topic pack at ${path} missing 'outputSchema'`);
  if (!Array.isArray(parsed.subtopics) || parsed.subtopics.length === 0) {
    throw new Error(`Topic pack at ${path} missing or empty 'subtopics'`);
  }

  for (const s of parsed.subtopics) {
    if (!s.id || !s.category || !s.seed) {
      throw new Error(`Topic pack at ${path} has malformed subtopic: ${JSON.stringify(s)}`);
    }
  }

  return parsed;
}
