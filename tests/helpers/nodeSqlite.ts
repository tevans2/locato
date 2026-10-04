import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/** Test-only Bun query adapter: exercises production SQL against real SQLite under Node. */
export class Database {
  private readonly db: DatabaseSync;
  constructor(path = ":memory:", _options?: unknown) { this.db = new DatabaseSync(path); }
  exec(sql: string): void { this.db.exec(sql); }
  query<Row = unknown>(sql: string) {
    const statement = this.db.prepare(sql);
    return {
      get: (...params: readonly unknown[]): Row | null => (statement.get(...params as SQLInputValue[]) as Row | undefined) ?? null,
      all: (...params: readonly unknown[]): Row[] => statement.all(...params as SQLInputValue[]) as Row[],
      run: (...params: readonly unknown[]) => statement.run(...params as SQLInputValue[]),
    };
  }
  run(sql: string, ...params: readonly unknown[]): void { this.query(sql).run(...params); }
  transaction<Args extends unknown[]>(fn: (...args: Args) => void): (...args: Args) => void {
    return (...args) => { this.exec("BEGIN"); try { fn(...args); this.exec("COMMIT"); } catch (error) { this.exec("ROLLBACK"); throw error; } };
  }
  close(): void { this.db.close(); }
}
