import OpenAI from 'openai';
import type { EmbeddingProvider } from '../types.js';

export class OpenAIEmbedding implements EmbeddingProvider {
  private client: OpenAI;
  constructor(
    private model: string = 'text-embedding-3-small',
    private dimensions: number = 512,
    apiKey: string = process.env.OPENAI_API_KEY ?? '',
  ) {
    if (!apiKey) throw new Error('OPENAI_API_KEY is required');
    this.client = new OpenAI({ apiKey });
  }

  async embed(text: string): Promise<number[]> {
    const res = await this.client.embeddings.create({
      model: this.model,
      input: text,
      dimensions: this.dimensions,
    });
    const vec = res.data[0]?.embedding;
    if (!vec) throw new Error('OpenAI returned no embedding');
    return vec;
  }
}
