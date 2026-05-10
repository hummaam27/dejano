import { checkDuplicate } from './dedup.js';
import { pickSubtopic } from './rotator.js';
import type {
  DedupConfig,
  EmbeddingProvider,
  GeneratedItem,
  LLMProvider,
  Store,
  Subtopic,
  TopicPack,
} from './types.js';

export interface GeneratorOptions {
  topicPack: TopicPack;
  llm: LLMProvider;
  embedding: EmbeddingProvider;
  store: Store;
  dedup?: Partial<DedupConfig>;
  historyWindow?: number;
  rotationWindow?: number;
  onAttempt?: (info: AttemptInfo) => void;
}

export interface AttemptInfo {
  attempt: number;
  subtopic: Subtopic;
  rejected?: { reason: 'cosine' | 'jaccard'; similarity: number; conflictingText: string };
}

const DEFAULT_DEDUP: DedupConfig = {
  cosineThreshold: 0.85,
  jaccardThreshold: 0.35,
  maxAttempts: 5,
};

export class Generator {
  private dedup: DedupConfig;
  private historyWindow: number;
  private rotationWindow: number;

  constructor(private opts: GeneratorOptions) {
    this.dedup = { ...DEFAULT_DEDUP, ...(opts.dedup ?? {}) };
    this.historyWindow = opts.historyWindow ?? 200;
    this.rotationWindow = opts.rotationWindow ?? 30;
  }

  async generateOne(): Promise<GeneratedItem> {
    const { topicPack, llm, embedding, store, onAttempt } = this.opts;

    const recentItems = store.recent(topicPack.name, this.historyWindow);
    const recentSubtopicIds = store.recentSubtopicIds(topicPack.name, this.rotationWindow);
    const history = recentItems.map((i) => ({ text: i.text, embedding: i.embedding }));
    const recentTexts = recentItems.slice(0, 20).map((i) => i.text);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.dedup.maxAttempts; attempt++) {
      const subtopic = pickSubtopic(topicPack.subtopics, recentSubtopicIds);
      const userPrompt = buildUserPrompt(topicPack, subtopic, recentTexts);

      let raw: string;
      try {
        raw = await llm.generate({
          systemPrompt: topicPack.systemPrompt,
          userPrompt,
          temperature: 0.85,
        });
      } catch (err) {
        lastError = err as Error;
        onAttempt?.({ attempt, subtopic });
        continue;
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(raw);
      } catch {
        lastError = new Error(`Model returned non-JSON: ${raw.slice(0, 200)}`);
        onAttempt?.({ attempt, subtopic });
        continue;
      }

      const text = extractText(payload);
      if (!text) {
        lastError = new Error(`Model output missing primary text field`);
        onAttempt?.({ attempt, subtopic });
        continue;
      }

      const vec = await embedding.embed(text);
      const dup = checkDuplicate(
        text,
        vec,
        history,
        this.dedup.cosineThreshold,
        this.dedup.jaccardThreshold,
      );

      if (dup.isDuplicate) {
        onAttempt?.({
          attempt,
          subtopic,
          rejected: {
            reason: dup.reason!,
            similarity: dup.similarity!,
            conflictingText: dup.conflictingText!,
          },
        });
        continue;
      }

      onAttempt?.({ attempt, subtopic });
      return store.insert({
        topicPack: topicPack.name,
        subtopicId: subtopic.id,
        text,
        payload,
        embedding: vec,
      });
    }

    throw new Error(
      `Failed to generate a non-duplicate after ${this.dedup.maxAttempts} attempts. ` +
        (lastError ? `Last error: ${lastError.message}` : 'All attempts hit dedup threshold.'),
    );
  }
}

function extractText(payload: Record<string, unknown>): string | null {
  for (const key of ['question', 'fact', 'prompt', 'text', 'content', 'title']) {
    const v = payload[key];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function buildUserPrompt(pack: TopicPack, subtopic: Subtopic, recentTexts: string[]): string {
  let p = `Generate one new item.\n\nTODAY'S SUBTOPIC (REQUIRED — build the item around this exact angle):\n- Category: ${subtopic.category}\n- Subtopic: ${subtopic.seed}\n\nThe output MUST focus on this specific subtopic. Do not drift to a more famous topic in the same category.`;

  if (recentTexts.length > 0) {
    p += `\n\nAVOID DUPLICATES — these have run recently. Do not repeat or paraphrase:\n${recentTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
  }

  p += `\n\nReturn ONLY a JSON object matching this schema:\n${pack.outputSchema}`;
  return p;
}
