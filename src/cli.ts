#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { resolve } from 'node:path';
import { Generator } from './generator.js';
import { SqliteStore } from './store.js';
import { loadTopicPack } from './topic.js';
import { OpenAILLM } from './providers/openai-llm.js';
import { OpenAIEmbedding } from './providers/openai-embedding.js';

const program = new Command();

program
  .name('dejano')
  .description('Daily AI content generator that refuses to repeat itself')
  .version('0.1.0');

program
  .command('generate')
  .description('Generate one new item from a topic pack')
  .requiredOption('-t, --topic <path>', 'Path to topic pack YAML')
  .option('-d, --db <path>', 'SQLite database path', './data/dejano.sqlite')
  .option('--cosine <n>', 'Cosine similarity reject threshold', '0.85')
  .option('--jaccard <n>', 'Jaccard similarity reject threshold', '0.35')
  .option('--attempts <n>', 'Max generation attempts before giving up', '5')
  .action(async (opts) => {
    const pack = loadTopicPack(resolve(opts.topic));
    const store = new SqliteStore(resolve(opts.db));
    const llm = new OpenAILLM();
    const embedding = new OpenAIEmbedding();

    const generator = new Generator({
      topicPack: pack,
      llm,
      embedding,
      store,
      dedup: {
        cosineThreshold: parseFloat(opts.cosine),
        jaccardThreshold: parseFloat(opts.jaccard),
        maxAttempts: parseInt(opts.attempts, 10),
      },
      onAttempt: (info) => {
        if (info.rejected) {
          console.log(
            `  attempt ${info.attempt}: rejected (${info.rejected.reason}, sim=${info.rejected.similarity.toFixed(3)}) — "${info.rejected.conflictingText.slice(0, 60)}..."`,
          );
        } else {
          console.log(`  attempt ${info.attempt}: subtopic=${info.subtopic.id}`);
        }
      },
    });

    console.log(`Generating from pack "${pack.name}" (history: ${store.count(pack.name)} items)`);
    const item = await generator.generateOne();
    console.log(`\n✔ Accepted: ${item.text}\n`);
    console.log(JSON.stringify(item.payload, null, 2));
  });

program
  .command('list')
  .description('List recent items from a topic pack')
  .requiredOption('-t, --topic <path>', 'Path to topic pack YAML')
  .option('-d, --db <path>', 'SQLite database path', './data/dejano.sqlite')
  .option('-n, --limit <n>', 'Number of items to show', '20')
  .action((opts) => {
    const pack = loadTopicPack(resolve(opts.topic));
    const store = new SqliteStore(resolve(opts.db));
    const items = store.recent(pack.name, parseInt(opts.limit, 10));
    console.log(`${items.length} recent item(s) for "${pack.name}":\n`);
    for (const item of items) {
      console.log(`[${item.createdAt}] (${item.subtopicId}) ${item.text}`);
    }
  });

program.parseAsync().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
