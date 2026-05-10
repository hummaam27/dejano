# déjano

> A daily AI generator that refuses to repeat itself.

## The problem

LLMs are great at producing one good answer. They're terrible at producing 30 *different* good answers in a row. Ask GPT for a daily trivia question and within a week half of them are about the pyramids. The model has favorites and converges on them.

If you're building any "daily" or "fresh content" feature on top of an LLM, you'll hit this wall.

## The solution

déjano sits between your app and the LLM and enforces novelty. Three layers:

1. **Cheap-first dedup** — every candidate is checked against history with Jaccard token overlap (free, no API call).
2. **Semantic dedup** — survivors are embedded; if cosine similarity to any prior item exceeds the threshold, it's rejected. This catches paraphrases the token test misses ("How many pillars of Islam?" vs "What's the number of Islamic pillars?").
3. **Retry-on-rejection** — the rejected candidate is thrown away and the model is asked again, with the rejected attempt added to its "do not repeat" list.

The result: a generator that gets harder to repeat itself over time, instead of easier.

## Who it's for

Any product where the same kind of thing has to be produced day after day:

- **Education apps** — daily quiz questions, vocabulary words, math problems
- **Wellness / habit apps** — journal prompts, meditation cues, affirmations
- **Marketing tools** — social post ideas, headline variations, ad copy
- **Internal tooling** — daily standup icebreakers, team trivia, retro prompts
- **Newsletters** — "did you know" facts, weekly tips, recipe ideas
- **Games** — procedurally generated puzzles, lore, NPC dialogue

If your product would be embarrassing if users saw the same content twice in a month, this is for you.

## Stack

- **TypeScript** + ES modules
- **Hono** — tiny modern web framework, Server-Sent Events for live attempt streaming
- **better-sqlite3** — local history with embeddings stored as Float32 BLOBs
- **OpenAI** — `gpt-4o-mini` for generation, `text-embedding-3-small` (512 dims) for dedup
- **Provider interfaces** — `LLMProvider`, `EmbeddingProvider`, `Store` are small enough to swap for Anthropic, Postgres, local models, etc.

## Run it locally

```bash
git clone <repo>
cd dejano
npm install
cp .env.example .env   # add OPENAI_API_KEY
npm run web            # http://localhost:3737
```

Type a topic. Click Generate. Hit Burst ×10 and watch rejections fire in real time.

## License

MIT
