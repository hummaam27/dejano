import type { Subtopic } from './types.js';

export function pickSubtopic(
  pool: Subtopic[],
  recentlyUsedIds: string[],
): Subtopic {
  if (pool.length === 0) {
    throw new Error('Subtopic pool is empty');
  }

  const recentSet = new Set(recentlyUsedIds);
  const fresh = pool.filter((s) => !recentSet.has(s.id));
  const candidates = fresh.length > 0 ? fresh : pool;

  return candidates[Math.floor(Math.random() * candidates.length)];
}
