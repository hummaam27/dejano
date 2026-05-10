import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GeneratedItem, Store } from './types.js';

export class SqliteStore implements Store {
  private db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic_pack TEXT NOT NULL,
        subtopic_id TEXT NOT NULL,
        text TEXT NOT NULL,
        payload TEXT NOT NULL,
        embedding BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_items_pack_created
        ON items(topic_pack, created_at DESC);
    `);
  }

  recent(topicPack: string, limit: number): GeneratedItem[] {
    const rows = this.db
      .prepare(
        `SELECT id, topic_pack, subtopic_id, text, payload, embedding, created_at
         FROM items WHERE topic_pack = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(topicPack, limit) as Array<{
      id: number;
      topic_pack: string;
      subtopic_id: string;
      text: string;
      payload: string;
      embedding: Buffer;
      created_at: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      topicPack: r.topic_pack,
      subtopicId: r.subtopic_id,
      text: r.text,
      payload: JSON.parse(r.payload),
      embedding: bufferToFloat32(r.embedding),
      createdAt: r.created_at,
    }));
  }

  recentSubtopicIds(topicPack: string, limit: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT subtopic_id FROM items WHERE topic_pack = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(topicPack, limit) as Array<{ subtopic_id: string }>;
    return rows.map((r) => r.subtopic_id);
  }

  insert(item: Omit<GeneratedItem, 'id' | 'createdAt'>): GeneratedItem {
    const result = this.db
      .prepare(
        `INSERT INTO items (topic_pack, subtopic_id, text, payload, embedding)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        item.topicPack,
        item.subtopicId,
        item.text,
        JSON.stringify(item.payload),
        float32ToBuffer(item.embedding),
      );

    const row = this.db
      .prepare(`SELECT created_at FROM items WHERE id = ?`)
      .get(result.lastInsertRowid) as { created_at: string };

    return {
      ...item,
      id: Number(result.lastInsertRowid),
      createdAt: row.created_at,
    };
  }

  count(topicPack: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as c FROM items WHERE topic_pack = ?`)
      .get(topicPack) as { c: number };
    return row.c;
  }
}

function float32ToBuffer(arr: number[]): Buffer {
  const f32 = new Float32Array(arr);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

function bufferToFloat32(buf: Buffer): number[] {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(f32);
}
