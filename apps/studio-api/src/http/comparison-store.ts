import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** These labels match the fixed manual comparison rows in the browser. */
export const COMPARISON_CATEGORIES = [
  "Entry points and message admission", "Session identity and lifecycle",
  "Turn ownership and concurrency", "Configuration and resource discovery",
  "Instructions and prompt construction", "Conversation state and history",
  "Context selection and budgets", "Compaction and history rewriting",
  "Memory and retrieval", "Agent orchestration", "Models and provider requests",
  "Tools and external integrations", "Execution environments", "Delegation and subagents",
  "Persistence, durability and recovery", "Background and scheduled work",
  "Response delivery and presentation", "Observability and reproducibility",
  "Extensibility and architectural boundaries",
] as const;

export interface ComparisonItem {
  readonly id: string;
  readonly category: (typeof COMPARISON_CATEGORIES)[number];
  readonly agent: "hermes" | "openclaw" | "pi" | "waku";
  readonly text: string;
}

/** Workspace-wide manual notes, independent of chat sessions and experiment evidence.
 * Mutations complete synchronously after SQL commit; exceptions must reach the caller.
 * Repeated PUT/DELETE is safe. Import preserves an existing ID's database content.
 */
export class ComparisonStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path);
    try {
      this.database.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS comparison_items (
          id TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          agent TEXT NOT NULL CHECK (agent IN ('hermes', 'openclaw', 'pi', 'waku')),
          text TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
      `);
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  list(): ComparisonItem[] {
    return this.database.prepare(
      "SELECT id, category, agent, text FROM comparison_items ORDER BY created_at, id",
    ).all() as unknown as ComparisonItem[];
  }

  put(item: ComparisonItem): void {
    const timestamp = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO comparison_items (id, category, agent, text, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET category = excluded.category, agent = excluded.agent,
        text = excluded.text, updated_at = excluded.updated_at
    `).run(item.id, item.category, item.agent, item.text, timestamp, timestamp);
  }

  delete(id: string): void {
    this.database.prepare("DELETE FROM comparison_items WHERE id = ?").run(id);
  }

  /** Atomic browser migration: either every new ID commits, or no ID does. */
  import(items: readonly ComparisonItem[]): number {
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO comparison_items (id, category, agent, text, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      let imported = 0;
      const timestamp = new Date().toISOString();
      for (const item of items) {
        imported += Number(insert.run(item.id, item.category, item.agent, item.text, timestamp, timestamp).changes);
      }
      this.database.exec("COMMIT");
      return imported;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }
}
