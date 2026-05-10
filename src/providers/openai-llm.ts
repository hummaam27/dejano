import OpenAI from 'openai';
import type { LLMProvider } from '../types.js';

export class OpenAILLM implements LLMProvider {
  private client: OpenAI;
  constructor(
    private model: string = 'gpt-4o-mini',
    apiKey: string = process.env.OPENAI_API_KEY ?? '',
  ) {
    if (!apiKey) throw new Error('OPENAI_API_KEY is required');
    this.client = new OpenAI({ apiKey });
  }

  async generate(args: {
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
  }): Promise<string> {
    const isGpt5 = this.model.startsWith('gpt-5');

    const params: Record<string, unknown> = {
      model: this.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: args.systemPrompt },
        { role: 'user', content: args.userPrompt },
      ],
    };

    if (isGpt5) {
      params.max_completion_tokens = 1200;
    } else {
      params.max_tokens = 600;
      params.temperature = args.temperature ?? 0.8;
    }

    const completion = await this.client.chat.completions.create(params as never);
    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('OpenAI returned empty completion');
    return content;
  }
}
