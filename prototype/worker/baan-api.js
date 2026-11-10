import { applyBoard, boardView, createBoard } from './baan-domain.js';

const boardPath = /^\/api\/baan\/(duindorp-baan-1|demo-[a-z0-9]{12,32})$/;
const receiptId = /^[A-Za-z0-9_-]{8,100}$/;
const jsonHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function json(data, status = 200, extraHeaders) {
  return Response.json(data, { status, headers: { ...jsonHeaders, ...extraHeaders } });
}

function methodNotAllowed(allow) {
  return json({ error: 'Deze actie is hier niet beschikbaar.' }, 405, { Allow: allow });
}

async function readJson(request) {
  const maximumBytes = 4096;
  if (!request.body || Number(request.headers.get('content-length')) > maximumBytes) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let input = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        return null;
      }
      input += decoder.decode(value, { stream: true });
    }
    return JSON.parse(input + decoder.decode());
  } catch {
    return null;
  }
}

function randomToken() {
  return crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readActor(db, request) {
  const token = /^Bearer ([a-f0-9]{64})$/i.exec(request.headers.get('authorization') || '')?.[1];
  if (!token) return null;
  const tokenHash = await hashToken(token);
  return db.prepare('SELECT id, name FROM baan_profiles WHERE token_hash = ?').bind(tokenHash).first();
}

async function register(db, request) {
  const input = await readJson(request);
  const name = typeof input?.name === 'string' ? input.name.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
  if (!name || Array.from(name).length > 32 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    return json({ error: 'Kies een zichtbare spelersnaam van 1 tot 32 tekens.' }, 422);
  }
  const token = randomToken();
  const actor = { id: crypto.randomUUID(), name };
  await db.prepare('INSERT INTO baan_profiles (id, name, token_hash) VALUES (?, ?, ?)')
    .bind(actor.id, actor.name, await hashToken(token)).run();
  return json({ actor, token }, 201);
}

async function readBoard(db, id) {
  const row = await db.prepare('SELECT revision, payload FROM baan_boards WHERE id = ?').bind(id).first();
  return row
    ? { revision: row.revision, state: JSON.parse(row.payload) }
    : { revision: 0, state: createBoard(id) };
}

async function readHistory(db, actor) {
  if (!actor) return [];
  const { results } = await db.prepare(
    'SELECT payload FROM baan_history WHERE actor_id = ? ORDER BY finished_at DESC, match_id DESC LIMIT 30',
  ).bind(actor.id).all();
  return results.map(row => JSON.parse(row.payload));
}

async function currentResponse(db, board, actor, extras = {}, status = 200) {
  return json({
    state: boardView(board.state, actor),
    revision: board.revision,
    actor,
    history: await readHistory(db, actor),
    ...extras,
  }, status);
}

const commandFields = ['mode', 'startScore', 'bestOfLegs', 'bestOfSets', 'score', 'darts', 'doubleConfirmed', 'name', 'label', 'opponent', 'matchId'];

function buildCommand(action) {
  const command = { type: action.type };
  for (const key of commandFields) {
    if (Object.hasOwn(action, key)) command[key] = action[key];
  }
  if (command.type === 'join') command.inviteToken = action.inviteToken;
  if (command.type === 'start' || command.type === 'prepare') {
    command.matchId = crypto.randomUUID();
    command.inviteToken = randomToken();
  }
  return command;
}

function findReceipt(db, boardId, actorId, requestId) {
  return db.prepare(
    'SELECT message FROM baan_actions WHERE board_id = ? AND actor_id = ? AND request_id = ?',
  ).bind(boardId, actorId, requestId).first();
}

function guardUpdate(db, next, expectedRevision, operation, actorId, requestId) {
  const payload = JSON.stringify(next.state);
  const boardId = next.state.id;
  const unusedReceipt = `NOT EXISTS (
    SELECT 1 FROM baan_actions WHERE board_id = ? AND actor_id = ? AND request_id = ?
  )`;
  if (expectedRevision === 0) {
    return db.prepare(`
      INSERT OR IGNORE INTO baan_boards (id, revision, payload, operation)
      SELECT ?, ?, ?, ? WHERE ${unusedReceipt}
    `).bind(boardId, next.revision, payload, operation, boardId, actorId, requestId);
  }
  return db.prepare(`
    UPDATE baan_boards SET revision = ?, payload = ?, operation = ?
    WHERE id = ? AND revision = ? AND ${unusedReceipt}
  `).bind(next.revision, payload, operation, boardId, expectedRevision, boardId, actorId, requestId);
}

function storeReceipt(db, boardId, actorId, requestId, message, operation) {
  return db.prepare(`
    INSERT INTO baan_actions (board_id, actor_id, request_id, message)
    SELECT id, ?, ?, ? FROM baan_boards WHERE id = ? AND operation = ?
  `).bind(actorId, requestId, message || null, boardId, operation);
}

function storeFinishedMatch(db, before, after, operation) {
  const match = after.match;
  if (after.status !== 'result' || !match?.resultPublished ||
      (before.match?.id === match.id && before.match.resultPublished)) return [];
  const view = boardView(after, null).match;
  if (!view) return [];
  return view.players.map((player, index) => {
    const opponent = view.players.find(other => other.id !== player.id)?.name;
    const record = {
      matchId: view.id,
      mode: view.mode,
      name: opponent ?? 'Solotraining',
      opponent: opponent ?? null,
      stats: view.stats[index],
      at: view.finishedAt,
      outcome: view.mode === 'practice' ? 'practice' : view.winnerId === player.id ? 'won' : 'lost',
    };
    return db.prepare(`
      INSERT OR IGNORE INTO baan_history (actor_id, match_id, finished_at, payload)
      SELECT ?, ?, ?, ? FROM baan_boards WHERE id = ? AND operation = ?
    `).bind(player.id, view.id, view.finishedAt, JSON.stringify(record), after.id, operation);
  });
}

async function commit(db, current, updated, actor, requestId) {
  const next = { state: updated.state, revision: current.revision + 1 };
  const operation = crypto.randomUUID();
  const [write] = await db.batch([
    guardUpdate(db, next, current.revision, operation, actor.id, requestId),
    storeReceipt(db, current.state.id, actor.id, requestId, updated.message, operation),
    ...storeFinishedMatch(db, current.state, updated.state, operation),
  ]);
  return write.meta.changes > 0 ? next : null;
}

const changed = {
  code: 'board-changed',
  error: 'De baanstand is inmiddels gewijzigd. Controleer de actuele stand en probeer opnieuw.',
};

async function postBoard(db, board, actor, request) {
  if (!actor) {
    return currentResponse(db, board, null, {
      code: 'profile-required', error: 'Open eerst je Dartflow-demoprofiel.',
    }, 401);
  }
  const input = await readJson(request);
  const action = input?.action;
  const requestId = input?.requestId;
  if (!action || typeof action.type !== 'string' || !Number.isSafeInteger(input.revision) ||
      input.revision < 0 || typeof requestId !== 'string' || !receiptId.test(requestId)) {
    return currentResponse(db, board, actor, { error: 'De baanactie is ongeldig.' }, 400);
  }
  const id = board.state.id;
  const receipt = await findReceipt(db, id, actor.id, requestId);
  if (receipt) {
    const latest = await readBoard(db, id);
    return currentResponse(db, latest, actor, { message: receipt.message });
  }
  if (input.revision !== board.revision) return currentResponse(db, board, actor, changed, 409);

  const update = applyBoard(board.state, actor, buildCommand(action));
  if (update.error) return currentResponse(db, board, actor, { error: update.error }, 422);
  if (update.needsDouble) {
    return currentResponse(db, board, actor, { needsDouble: true, message: update.message });
  }

  const next = await commit(db, board, update, actor, requestId);
  if (next) return currentResponse(db, next, actor, { message: update.message });
  const duplicate = await findReceipt(db, id, actor.id, requestId);
  const latest = await readBoard(db, id);
  return duplicate
    ? currentResponse(db, latest, actor, { message: duplicate.message })
    : currentResponse(db, latest, actor, changed, 409);
}

export async function handleBaanApi(request, env) {
  const pathname = new URL(request.url).pathname;
  const isProfile = pathname === '/api/baan/profile';
  const id = boardPath.exec(pathname)?.[1];
  if (!id && !isProfile) return json({ error: 'Deze Dartflow-baan bestaat niet.' }, 404);
  if (isProfile && request.method !== 'POST') return methodNotAllowed('POST');
  if (!isProfile && request.method !== 'GET' && request.method !== 'POST') return methodNotAllowed('GET, POST');
  if (!env.DB) return json({ error: 'De live verbinding met de baan is tijdelijk niet beschikbaar.' }, 503);

  try {
    const db = env.DB.withSession?.('first-primary') ?? env.DB;
    if (isProfile) return await register(db, request);
    const actor = await readActor(db, request);
    const board = await readBoard(db, id);
    return request.method === 'GET'
      ? await currentResponse(db, board, actor)
      : await postBoard(db, board, actor, request);
  } catch (error) {
    console.error('Dartflow Baanmodus API', error.message);
    return json({ error: 'De live verbinding met de baan is tijdelijk niet beschikbaar.' }, 503);
  }
}
