export interface Subtopic {
  id: string;
  category: string;
  seed: string;
}

export interface TopicPack {
  name: string;
  description?: string;
  systemPrompt: string;
  outputSchema: string;
  subtopics: Subtopic[];
}

export interface GeneratedItem {
  id?: number;
  topicPack: string;
  subtopicId: string;
  text: string;
  payload: unknown;
  embedding: number[];
  createdAt: string;
}

export interface LLMProvider {
  generate(args: {
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
  }): Promise<string>;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export interface Store {
  recent(topicPack: string, limit: number): GeneratedItem[];
  recentSubtopicIds(topicPack: string, limit: number): string[];
  insert(item: Omit<GeneratedItem, 'id' | 'createdAt'>): GeneratedItem;
  count(topicPack: string): number;
}

export interface DedupConfig {
  cosineThreshold: number;
  jaccardThreshold: number;
  maxAttempts: number;
}
