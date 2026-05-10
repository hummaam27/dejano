import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { streamSSE } from 'hono/streaming';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { Generator } from './generator.js';
import { SqliteStore } from './store.js';
import { loadTopicPack } from './topic.js';
import { OpenAILLM } from './providers/openai-llm.js';
import { OpenAIEmbedding } from './providers/openai-embedding.js';
import type { TopicPack } from './types.js';

const TOPICS_DIR = resolve('./topics');
const DB_PATH = resolve('./data/dejano.sqlite');

const store = new SqliteStore(DB_PATH);

let llm: OpenAILLM | null = null;
let embedding: OpenAIEmbedding | null = null;
let providerError: string | null = null;
try {
  llm = new OpenAILLM();
  embedding = new OpenAIEmbedding();
} catch (err) {
  providerError = (err as Error).message;
  console.warn(`\n  ⚠ OpenAI providers not initialized: ${providerError}`);
  console.warn(`  UI will load, but /api/generate will return an error until you set OPENAI_API_KEY in .env\n`);
}

function listTopicPacks(): { file: string; pack: TopicPack }[] {
  return readdirSync(TOPICS_DIR)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((file) => ({ file, pack: loadTopicPack(resolve(TOPICS_DIR, file)) }));
}

const app = new Hono();

app.get('/', (c) => {
  const html = readFileSync(resolve('./public/index.html'), 'utf8');
  return c.html(html);
});

app.get('/api/topics', (c) => {
  const packs = listTopicPacks().map(({ file, pack }) => ({
    file,
    name: pack.name,
    description: pack.description ?? '',
    subtopicCount: pack.subtopics.length,
    historyCount: store.count(pack.name),
  }));
  return c.json(packs);
});

app.get('/api/items', (c) => {
  const topic = c.req.query('topic');
  const freeTopic = c.req.query('freeTopic');
  if (!topic && !freeTopic) {
    return c.json({ error: 'topic or freeTopic query param required' }, 400);
  }
  const packName = freeTopic
    ? buildFreeTopicPack(freeTopic, LENGTH_PRESETS.medium).name
    : loadTopicPack(resolve(TOPICS_DIR, basename(topic!))).name;
  const items = store.recent(packName, 50);
  return c.json(
    items.map((i) => ({
      id: i.id,
      subtopicId: i.subtopicId,
      text: i.text,
      payload: i.payload,
      createdAt: i.createdAt,
    })),
  );
});

function slug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

type Length = 'short' | 'medium' | 'long' | 'custom';
interface LengthSpec { words: string; sentences: string }

const LENGTH_PRESETS: Record<Exclude<Length, 'custom'>, LengthSpec> = {
  short: { words: '~30 words', sentences: '1-2 sentences' },
  medium: { words: '~80 words', sentences: '3-5 sentences' },
  long: { words: '~150 words', sentences: '6-9 sentences' },
};

function resolveLengthSpec(length: Length, customWords?: number): LengthSpec {
  if (length === 'custom' && customWords && customWords > 0) {
    const sentences =
      customWords <= 25 ? '1 sentence' :
      customWords <= 60 ? '2-3 sentences' :
      customWords <= 120 ? '4-6 sentences' :
      customWords <= 220 ? '7-10 sentences' :
      'one full paragraph or two';
    return { words: `~${customWords} words`, sentences };
  }
  return LENGTH_PRESETS[(length === 'custom' ? 'medium' : length) as Exclude<Length, 'custom'>];
}

function buildFreeTopicPack(topic: string, spec: LengthSpec): TopicPack {
  const trimmed = topic.trim();
  return {
    name: `free:${slug(trimmed)}`,
    description: `Free-form topic: ${trimmed}`,
    systemPrompt: `You generate one short, interesting fact or insight about a topic each time you're called.

REQUIREMENTS:
- Pick a SPECIFIC angle on the topic — a particular event, person, mechanism, paradox, or detail.
- Avoid the obvious "introductory" facts everyone already knows. Surface something a curious adult would not have heard before.
- Length: the "fact" field MUST be ${spec.sentences} (${spec.words}). Do not exceed this.
- Tone: confident, direct, no hedging.
- If asked again about the same topic, pick a different angle each time.`,
    outputSchema: `{
  "title": "string — punchy title for the angle (5-8 words)",
  "fact": "string — the insight in ${spec.sentences} (${spec.words})",
  "why_it_matters": "string — one sentence on why a curious person should care"
}`,
    subtopics: [
      {
        id: 'freeform',
        category: 'freeform',
        seed: trimmed,
      },
    ],
  };
}

function applyLengthToPack(pack: TopicPack, spec: LengthSpec): TopicPack {
  return {
    ...pack,
    systemPrompt: `${pack.systemPrompt}\n\nLENGTH OVERRIDE: keep the primary text field to ${spec.sentences} (${spec.words}).`,
  };
}

const ALLOWED_MODELS = new Set([
  'gpt-5.5',
  'gpt-5.5-pro',
  'gpt-5.4',
  'gpt-5.4-pro',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
]);

app.post('/api/generate', (c) => {
  return streamSSE(c, async (stream) => {
    const body = await c.req.json().catch(() => ({}));
    const topicFile: string | undefined = body.topic;
    const freeTopic: string | undefined = body.freeTopic;
    const model: string = ALLOWED_MODELS.has(body.model) ? body.model : 'gpt-5.4-mini';
    const length: Length = (['short', 'medium', 'long', 'custom'] as const).includes(body.length)
      ? (body.length as Length)
      : 'medium';
    const customWords =
      typeof body.customWords === 'number' && body.customWords > 0
        ? Math.min(800, Math.floor(body.customWords))
        : undefined;
    const spec = resolveLengthSpec(length, customWords);

    if (!topicFile && !freeTopic) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ message: 'topic or freeTopic required' }),
      });
      return;
    }

    if (!embedding) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          message: `OPENAI_API_KEY missing. Add it to .env and restart. (${providerError})`,
        }),
      });
      return;
    }

    const requestLLM = new OpenAILLM(model);

    let pack: TopicPack;
    try {
      pack = freeTopic
        ? buildFreeTopicPack(freeTopic, spec)
        : applyLengthToPack(loadTopicPack(resolve(TOPICS_DIR, basename(topicFile!))), spec);
    } catch (err) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ message: (err as Error).message }),
      });
      return;
    }

    await stream.writeSSE({
      event: 'start',
      data: JSON.stringify({
        pack: pack.name,
        history: store.count(pack.name),
        subtopics: pack.subtopics.length,
      }),
    });

    const generator = new Generator({
      topicPack: pack,
      llm: requestLLM,
      embedding,
      store,
      onAttempt: async (info) => {
        await stream.writeSSE({
          event: 'attempt',
          data: JSON.stringify({
            attempt: info.attempt,
            subtopic: info.subtopic,
            rejected: info.rejected ?? null,
          }),
        });
      },
    });

    try {
      const item = await generator.generateOne();
      await stream.writeSSE({
        event: 'accepted',
        data: JSON.stringify({
          id: item.id,
          subtopicId: item.subtopicId,
          text: item.text,
          payload: item.payload,
          createdAt: item.createdAt,
        }),
      });
    } catch (err) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ message: (err as Error).message }),
      });
    }
  });
});

const port = parseInt(process.env.PORT ?? '3737', 10);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`\n  dejano running at http://localhost:${info.port}\n`);
});
