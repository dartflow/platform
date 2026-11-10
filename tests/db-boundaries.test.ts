import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { database } from '../lib/db';
import { databaseConnection, DatabaseConfigurationError, safeDatabaseScriptError } from '../scripts/db-shared.mjs';

test('local runtime identities cannot connect to a remote or privileged database', () => {
  const previousUrl = process.env.DARTFLOW_DATABASE_URL, previousMode = process.env.DARTFLOW_DATA_MODE;
  try {
    process.env.DARTFLOW_DATA_MODE = 'local';
    process.env.DARTFLOW_DATABASE_URL = 'postgresql://dartflow_app:test@must-not-connect.invalid/postgres';
    assert.throws(() => database(), { code: 'local_database_required' });
    process.env.DARTFLOW_DATABASE_URL = 'postgresql://dartflow_app:test@127.0.0.1/postgres?host=must-not-connect.invalid';
    assert.throws(() => database(), { code: 'database_url_invalid' });
    process.env.DARTFLOW_DATABASE_URL = 'postgresql://dartflow_app:test@127.0.0.1/postgres?user=postgres';
    assert.throws(() => database(), { code: 'database_url_invalid' });
    process.env.DARTFLOW_DATABASE_URL = 'postgresql://postgres:test@127.0.0.1/postgres';
    assert.throws(() => database(), { code: 'database_role_invalid' });
    assert.throws(() => databaseConnection('postgresql://owner:test@127.0.0.1/db?host=must-not-connect.invalid'), /queryparameters/);
  } finally {
    if (previousUrl === undefined) delete process.env.DARTFLOW_DATABASE_URL; else process.env.DARTFLOW_DATABASE_URL = previousUrl;
    if (previousMode === undefined) delete process.env.DARTFLOW_DATA_MODE; else process.env.DARTFLOW_DATA_MODE = previousMode;
  }
});

test('local migration and seed reject remote admin connections before any database request', () => {
  for (const script of ['scripts/db-seed.mjs', 'scripts/db-migrate.mjs']) {
    const sentinel = 'credential-must-stay-private';
    const result = spawnSync(process.execPath, [script], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 5000,
      env: { ...process.env, DARTFLOW_DATA_MODE: 'local', DARTFLOW_DATABASE_ADMIN_URL: `postgresql://owner:${sentinel}@must-not-connect.invalid/postgres`, DARTFLOW_DATABASE_URL: 'postgresql://dartflow_app:test@127.0.0.1:1/postgres' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /loopbackdatabase/);
    assert.equal(result.stderr.includes(sentinel), false);
    assert.equal(result.stderr.includes('ENOTFOUND'), false);
  }
});

test('migration failures never print credential values or database SQL details', () => {
  const sentinel = 'private-role-password';
  const providerError = Object.assign(new Error(`syntax error near '${sentinel}'`), { code: '42601', detail: sentinel, internalQuery: `alter role dartflow_app password '${sentinel}'` });
  const message = safeDatabaseScriptError(providerError, 'Databasemigratie');
  assert.match(message, /42601/); assert.equal(message.includes(sentinel), false); assert.equal(message.includes('alter role'), false);
  assert.match(safeDatabaseScriptError(new DatabaseConfigurationError('Runtimeconfig ontbreekt.'), 'Databasemigratie'), /Runtimeconfig ontbreekt/);
  const result = spawnSync(process.execPath, ['scripts/db-migrate.mjs'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 5000,
    env: { ...process.env, DARTFLOW_DATA_MODE: 'local', DARTFLOW_DATABASE_ADMIN_URL: `postgresql://owner:${sentinel}@127.0.0.1:1/postgres`, DARTFLOW_DATABASE_URL: `postgresql://dartflow_app:${sentinel}@127.0.0.1:1/postgres` },
  });
  assert.equal(result.status, 1); assert.match(result.stderr, /mislukt/); assert.equal(result.stderr.includes(sentinel), false);
});
