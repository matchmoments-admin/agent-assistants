import { DurableObject } from 'cloudflare:workers';

interface BudgetEnv {
  AGENT_CONFIG: KVNamespace;
  PRODUCT_ID: string;
}

// Spend tracked in integer micro-USD (1 USD = 1_000_000) to avoid float drift
// across many small Sonnet 4.6 token-cost increments.
const USD_TO_MICROS = 1_000_000;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export class BudgetDO extends DurableObject<BudgetEnv> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: BudgetEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS spend (
        month TEXT PRIMARY KEY,
        micros INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS spend_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month TEXT NOT NULL,
        micros INTEGER NOT NULL,
        agent_id TEXT,
        session_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_spend_log_month ON spend_log(month, created_at)
    `);
  }

  async recordSpend(usd: number, agentId?: string, sessionId?: string): Promise<number> {
    if (!Number.isFinite(usd) || usd < 0) return await this.getMonthSpend();
    const month = currentMonth();
    const micros = Math.round(usd * USD_TO_MICROS);

    return await this.ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(
        `INSERT INTO spend (month, micros) VALUES (?, ?)
         ON CONFLICT(month) DO UPDATE SET
           micros = micros + excluded.micros,
           updated_at = datetime('now')`,
        month, micros,
      );
      this.sql.exec(
        `INSERT INTO spend_log (month, micros, agent_id, session_id) VALUES (?, ?, ?, ?)`,
        month, micros, agentId ?? null, sessionId ?? null,
      );

      const total = this.readMonthMicros(month);
      const totalUsd = total / USD_TO_MICROS;
      // Write-through cache for /status (KV is read-only on the hot path now).
      await this.env.AGENT_CONFIG.put(
        `${this.env.PRODUCT_ID}:monthly_spend_usd`,
        totalUsd.toFixed(6),
      );
      await this.env.AGENT_CONFIG.put(
        `${this.env.PRODUCT_ID}:spend_month`,
        month,
      );
      return totalUsd;
    });
  }

  async getMonthSpend(): Promise<number> {
    const month = currentMonth();
    return this.readMonthMicros(month) / USD_TO_MICROS;
  }

  async getMonthSpendUsd(): Promise<{ month: string; usd: number }> {
    const month = currentMonth();
    return { month, usd: this.readMonthMicros(month) / USD_TO_MICROS };
  }

  // Test/ops helper: forcibly set the month total. Not exposed via fetch.
  async setMonthSpendForTest(usd: number): Promise<void> {
    const month = currentMonth();
    const micros = Math.round(usd * USD_TO_MICROS);
    await this.ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(
        `INSERT INTO spend (month, micros) VALUES (?, ?)
         ON CONFLICT(month) DO UPDATE SET micros = excluded.micros, updated_at = datetime('now')`,
        month, micros,
      );
      await this.env.AGENT_CONFIG.put(
        `${this.env.PRODUCT_ID}:monthly_spend_usd`,
        usd.toFixed(6),
      );
      await this.env.AGENT_CONFIG.put(
        `${this.env.PRODUCT_ID}:spend_month`,
        month,
      );
    });
  }

  private readMonthMicros(month: string): number {
    const rows = this.sql.exec(
      `SELECT micros FROM spend WHERE month = ?`,
      month,
    ).toArray() as Array<{ micros: number }>;
    return rows.length > 0 ? rows[0].micros : 0;
  }
}
