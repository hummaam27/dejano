export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as',
  'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where', 'why', 'how',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'should',
  'can', 'could', 'may', 'might', 'must', 'it', 'its', 'i', 'you', 'he', 'she',
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = tokens(a);
  const setB = tokens(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface DuplicateCheck {
  isDuplicate: boolean;
  reason?: 'cosine' | 'jaccard';
  similarity?: number;
  conflictingText?: string;
}

export function checkDuplicate(
  candidateText: string,
  candidateEmbedding: number[],
  history: { text: string; embedding: number[] }[],
  cosineThreshold: number,
  jaccardThreshold: number,
): DuplicateCheck {
  for (const item of history) {
    const j = jaccardSimilarity(candidateText, item.text);
    if (j >= jaccardThreshold) {
      return { isDuplicate: true, reason: 'jaccard', similarity: j, conflictingText: item.text };
    }
  }
  for (const item of history) {
    const c = cosineSimilarity(candidateEmbedding, item.embedding);
    if (c >= cosineThreshold) {
      return { isDuplicate: true, reason: 'cosine', similarity: c, conflictingText: item.text };
    }
  }
  return { isDuplicate: false };
}
