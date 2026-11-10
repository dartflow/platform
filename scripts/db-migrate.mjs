import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { loadEnv, databaseConnection, DatabaseConfigurationError, safeDatabaseScriptError } from './db-shared.mjs';
async function migrate() {
  await loadEnv();
  const connectionString = process.env.DARTFLOW_DATABASE_ADMIN_URL;
  databaseConnection(connectionString, 'DARTFLOW_DATABASE_ADMIN_URL');
  let password = process.env.DARTFLOW_DATABASE_APP_PASSWORD;
  if (process.env.DARTFLOW_DATABASE_URL) {
    const runtime = databaseConnection(process.env.DARTFLOW_DATABASE_URL, 'DARTFLOW_DATABASE_URL');
    const username = decodeURIComponent(runtime.username);
    if (username !== 'dartflow_app' && !username.startsWith('dartflow_app.')) throw new DatabaseConfigurationError('DARTFLOW_DATABASE_URL vereist de beperkte dartflow_app-rol.');
    password ||= decodeURIComponent(runtime.password);
  }
  if (!password) throw new DatabaseConfigurationError('Stel DARTFLOW_DATABASE_URL in met de dartflow_app-credential om de runtime-rol te configureren.');
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await client.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    await client.query(`alter role dartflow_app password '${password.replaceAll("'", "''")}'`);
    console.log('Dartflow-schema toegepast; runtime-rol dartflow_app is gescheiden van de eigenaar.');
  } finally { await client.end().catch(() => undefined); }
}
try { await migrate(); }
catch (error) { console.error(safeDatabaseScriptError(error, 'Databasemigratie')); process.exitCode = 1; }
