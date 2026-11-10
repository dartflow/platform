export async function loadEnv() {
  for (const path of ['.env.local', '.env']) {
    try { process.loadEnvFile(path); } catch (error) { if(error.code !== 'ENOENT') throw error; }
  }
}
export const ids = {
 organizer:'00000000-0000-4000-8000-000000000001', player1:'00000000-0000-4000-8000-000000000002', player2:'00000000-0000-4000-8000-000000000003', outsider:'00000000-0000-4000-8000-000000000004',
 club1:'10000000-0000-4000-8000-000000000001', club2:'10000000-0000-4000-8000-000000000002', event1:'20000000-0000-4000-8000-000000000001', event2:'20000000-0000-4000-8000-000000000002', match1:'30000000-0000-4000-8000-000000000001', board1:'40000000-0000-4000-8000-000000000001', board2:'40000000-0000-4000-8000-000000000002'
};

export class DatabaseConfigurationError extends Error {}
export function databaseConnection(value, label = 'database') {
  if (!value) throw new DatabaseConfigurationError(`${label} ontbreekt.`);
  let connection;
  try { connection = new URL(value); }
  catch { throw new DatabaseConfigurationError(`${label} bevat geen geldige Postgres-verbindings-URL.`); }
  if (!['postgres:', 'postgresql:'].includes(connection.protocol)) throw new DatabaseConfigurationError(`${label} vereist een Postgres-verbindings-URL.`);
  if ([...connection.searchParams.keys()].some(key => ['host', 'user', 'password', 'port', 'database'].includes(key.toLowerCase()))) throw new DatabaseConfigurationError(`${label} mag host, gebruiker en credential niet via queryparameters overschrijven.`);
  if (process.env.DARTFLOW_DATA_MODE === 'local' && !['127.0.0.1', 'localhost', '[::1]'].includes(connection.hostname.toLowerCase())) {
    throw new DatabaseConfigurationError(`Lokale pilotdata vereist een loopbackdatabase; ${label} verwijst naar een externe host.`);
  }
  return connection;
}
export function safeDatabaseScriptError(error, operation) {
  if (error instanceof DatabaseConfigurationError) return `${operation}: ${error.message}`;
  const code = error && typeof error === 'object' && /^[A-Z0-9]{2,20}$/.test(String(error.code)) ? ` (${error.code})` : '';
  // Do not print provider details, query text, connection strings or the original Error object.
  return `${operation} mislukt${code}. Controleer de databaseverbinding, rolrechten en serverlogs; credentials en SQL-details zijn niet gelogd.`;
}
