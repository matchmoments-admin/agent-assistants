import { DurableObject } from 'cloudflare:workers';

interface MemoryRecord {
  id: string;
  agent: string;
  task: string;
  key: string;
  value: string;
  created_at: string;
}

export class AgentMemory extends DurableObject<Record<string, unknown>> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        task TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_agent_task ON memories(agent, task)
    `);

    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_key ON memories(key)
    `);
  }

  async store(agent: string, task: string, key: string, value: string): Promise<void> {
    const id = crypto.randomUUID();
    this.sql.exec(
      `INSERT OR REPLACE INTO memories (id, agent, task, key, value) VALUES (?, ?, ?, ?, ?)`,
      id, agent, task, key, value,
    );
  }

  async recall(agent: string, key: string): Promise<string | null> {
    const rows = this.sql.exec(
      `SELECT value FROM memories WHERE agent = ? AND key = ? ORDER BY created_at DESC LIMIT 1`,
      agent, key,
    ).toArray() as Array<{ value: string }>;

    return rows.length > 0 ? rows[0].value : null;
  }

  async recallAll(agent: string): Promise<MemoryRecord[]> {
    return this.sql.exec(
      `SELECT * FROM memories WHERE agent = ? ORDER BY created_at DESC LIMIT 50`,
      agent,
    ).toArray() as unknown as MemoryRecord[];
  }

  async search(query: string): Promise<MemoryRecord[]> {
    return this.sql.exec(
      `SELECT * FROM memories WHERE value LIKE ? ORDER BY created_at DESC LIMIT 20`,
      `%${query}%`,
    ).toArray() as unknown as MemoryRecord[];
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const agent = url.searchParams.get('agent') ?? '';

    if (request.method === 'POST') {
      const body = await request.json() as { task: string; key: string; value: string };
      await this.store(agent, body.task, body.key, body.value);
      return new Response('stored', { status: 200 });
    }

    const key = url.searchParams.get('key');
    if (key) {
      const value = await this.recall(agent, key);
      return Response.json({ value });
    }

    const records = await this.recallAll(agent);
    return Response.json(records);
  }
}
