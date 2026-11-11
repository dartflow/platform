import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function createDevDb() {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(new URL('../drizzle/0000_baanmodus.sql', import.meta.url), 'utf8'));
  const syncRun = Symbol('runStatement');

  function prepare(sql, params = []) {
    const query = database.prepare(sql);
    function run() {
      const { changes } = query.run(...params);
      return { success: true, meta: { changes } };
    }
    return {
      bind: (...bound) => prepare(sql, bound),
      first: async () => query.get(...params) ?? null,
      all: async () => ({ success: true, results: query.all(...params) }),
      run: async () => run(),
      [syncRun]: run,
    };
  }

  return {
    prepare,
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => statement[syncRun]());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
