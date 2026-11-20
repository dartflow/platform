import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {assertAccountActive} from './account-removal';
import {DomainError} from './domain';
import {canonical, hash, transaction, uuid, text, type Client} from './platform-store';
import {enqueueNotificationEvent} from './notification-events';
import {assertSupportTransition, supportPermissions, supportStatusTransitions, supportWaitingOn} from './support-domain';
import {SUPPORT_CATEGORIES, SUPPORT_PRIORITIES, SUPPORT_STATUSES, type SupportAction, type SupportAdminEvent, type SupportAdminTicketList, type SupportAdminTicketSummary, type SupportCategory, type SupportCommand, type SupportCommandResult, type SupportNotificationReference, type SupportPerson, type SupportPriority, type SupportPublicEvent, type SupportStatus, type SupportTicketDetail, type SupportTicketFilters, type SupportTicketList, type SupportTicketSummary} from './support-types';

type TicketRow = {id: string; ticket_number: string; owner_id: string | null; category: SupportCategory; subject: string; status: SupportStatus; priority: SupportPriority; assignee_id: string | null; revision: number; public_revision: number; created_at: Date; updated_at: Date; public_updated_at: Date};
type EventRow = {id: string; sequence: string; actor_id: string | null; actor_role: 'user' | 'support' | 'system'; visibility: 'public' | 'internal'; kind: SupportAdminEvent['type']; body: string | null; changes: Record<string, string | null>; created_at: Date};
const stamp = (date: Date | string) => new Date(date).toISOString();
const number = (row: TicketRow) => `DF-${row.ticket_number}`;
const adminAction = (action: SupportAction) => action.type.startsWith('ticket.admin.');
function exact(value: Record<string, unknown>, keys: string[]) {if (Object.keys(value).some(key => !keys.includes(key))) throw new DomainError('support_input', 'De aanvraag bevat onbekende velden.');}
function enumValue<T extends string>(value: unknown, values: readonly T[]): T {if (typeof value !== 'string' || !values.includes(value as T)) throw new DomainError('support_input', 'Kies een geldige categorie, prioriteit of status.'); return value as T;}
async function requireAccount(client: Client, actor: string) {
  uuid(actor); await assertAccountActive(actor, client);
  if (!(await client.query("select id from dartflow_private.profiles where id=$1 and deleted_at is null and deletion_requested_at is null and not exists(select 1 from dartflow_private.event_guests g where g.profile_id=profiles.id)for share", [actor])).rowCount) throw new DomainError('forbidden', 'Log in met je eigen actieve DartFlow-account.', 403);
}
export async function canManageSupport(client: Client, actor: string): Promise<boolean> {
  const result = await client.query("select r.user_id from dartflow_private.platform_roles r join dartflow_private.profiles p on p.id=r.user_id where r.user_id=$1 and r.role in('owner','admin')and p.deleted_at is null and p.deletion_requested_at is null", [actor]);
  return Boolean(result.rowCount);
}
async function requireSupport(client: Client, actor: string) {if (!await canManageSupport(client, actor)) throw new DomainError('forbidden', 'Alleen bevoegde platformondersteuning kan dit ticket beheren.', 403);}
async function row(client: Client, id: unknown, lock = false): Promise<TicketRow> {
  const result = await client.query<TicketRow>(`select * from dartflow_private.support_tickets where id=$1${lock ? ' for update' : ''}`, [uuid(id)]);
  if (!result.rows[0]) throw new DomainError('ticket_not_found', 'Dit supportticket bestaat niet of is niet beschikbaar.', 404);
  return result.rows[0];
}
async function access(client: Client, ticket: TicketRow, actor: string, support: boolean) {
  if (support) await requireSupport(client, actor);
  else if (ticket.owner_id !== actor) throw new DomainError('ticket_not_found', 'Dit supportticket bestaat niet of hoort niet bij je account.', 404);
}
async function people(client: Client, ids: (string | null)[]): Promise<Map<string, SupportPerson>> {
  const result = await client.query<SupportPerson>('select p.id,l.name,l.username from dartflow_private.profiles p join dartflow_private.profile_labels l using(id)where p.id=any($1::uuid[])', [ids.filter(Boolean)]);
  return new Map(result.rows.map(p => [p.id, p]));
}
async function staff(client: Client): Promise<SupportPerson[]> {
  return (await client.query<SupportPerson>("select p.id,l.name,l.username from dartflow_private.platform_roles r join dartflow_private.profiles p on p.id=r.user_id join dartflow_private.profile_labels l on l.id=p.id where r.role in('owner','admin')and p.deleted_at is null and p.deletion_requested_at is null order by l.name,p.id")).rows;
}
const missingPerson = (): SupportPerson => ({id: '', name: 'Verwijderd account', username: null});
function summary(ticket: TicketRow, support: boolean): SupportTicketSummary {
  return {id: ticket.id, number: number(ticket), category: ticket.category, subject: ticket.subject, status: ticket.status, waitingOn: supportWaitingOn(ticket.status), revision: support ? ticket.revision : ticket.public_revision, createdAt: stamp(ticket.created_at), updatedAt: stamp(support ? ticket.updated_at : ticket.public_updated_at), permissions: supportPermissions(ticket.status, support, Boolean(ticket.owner_id))};
}
async function detail(client: Client, ticket: TicketRow, support: boolean): Promise<SupportTicketDetail> {
  const events = (await client.query<EventRow>(`select * from dartflow_private.support_ticket_events where ticket_id=$1${support ? '' : " and visibility='public'"} order by sequence`, [ticket.id])).rows;
  const visible = events.filter(event => event.visibility === 'public');
  const timeline: SupportPublicEvent[] = visible.map(event => ({id: event.id, type: event.kind as SupportPublicEvent['type'], actorRole: event.actor_role, actorName: event.actor_role === 'support' ? 'DartFlow Support' : event.actor_role === 'user' ? 'Jij' : 'Systeem', body: event.body, createdAt: stamp(event.created_at), ...(event.changes.fromStatus ? {fromStatus: event.changes.fromStatus as SupportStatus} : {}), ...(event.changes.toStatus ? {toStatus: event.changes.toStatus as SupportStatus} : {})}));
  const result: SupportTicketDetail = {...summary(ticket, support), timeline};
  if (support) {
    const profiles = await people(client, [ticket.owner_id, ticket.assignee_id, ...events.map(event => event.actor_id)]);
    result.management = {owner: profiles.get(ticket.owner_id ?? '') ?? missingPerson(), assignee: profiles.get(ticket.assignee_id ?? '') ?? null, priority: ticket.priority, publicRevision: ticket.public_revision, staff: await staff(client), allowedStatuses: ticket.owner_id ? supportStatusTransitions(ticket.status) : [], timeline: events.map(event => ({id: event.id, type: event.kind, visibility: event.visibility, actor: profiles.get(event.actor_id ?? '') ?? null, body: event.body, changes: event.changes, createdAt: stamp(event.created_at)}))};
  }
  return result;
}
export async function getSupportTicket(actor: string, id: string, support = false): Promise<{ticket: SupportTicketDetail}> {
  return transaction(async client => {await requireAccount(client, actor); if (support) await requireSupport(client, actor); const ticket = await row(client, id); await access(client, ticket, actor, support); return {ticket: await detail(client, ticket, support)};});
}
function filterInput(filters: SupportTicketFilters, support: boolean) {
  const q = filters.q === undefined ? '' : text(filters.q, 160, false);
  const status = filters.status === undefined ? 'all' : enumValue(filters.status, [...SUPPORT_STATUSES, 'all', 'open', 'unhandled']);
  const category = filters.category === undefined ? 'all' : enumValue(filters.category, [...SUPPORT_CATEGORIES, 'all']);
  const priority = filters.priority === undefined ? 'all' : enumValue(filters.priority, [...SUPPORT_PRIORITIES, 'all']);
  const assignee = filters.assignee ?? 'all'; if (!['all', 'me', 'unassigned'].includes(assignee)) uuid(assignee);
  if (!support && (priority !== 'all' || assignee !== 'all')) throw new DomainError('support_input', 'Interne filters horen alleen bij Supportbeheer.');
  const limit = filters.limit ?? 25, offset = filters.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new DomainError('support_input', 'Kies een geldige pagina.');
  return {q, status, category, priority, assignee, limit, offset};
}
export async function getSupportTickets(actor: string, filters: SupportTicketFilters = {}, support = false): Promise<SupportTicketList | SupportAdminTicketList> {
  const f = filterInput(filters, support);
  return transaction(async client => {
    await requireAccount(client, actor); if (support) await requireSupport(client, actor);
    const args: unknown[] = []; const where: string[] = [];
    const add = (condition: string, value: unknown) => {args.push(value); where.push(condition.replace('?', `$${args.length}`));};
    if (!support) add('t.owner_id=?', actor);
    if (f.q) {args.push(`%${f.q.replace(/[\\%_]/g, '\\$&')}%`); const n = args.length; where.push(`(t.subject ilike $${n} or ('DF-'||t.ticket_number::text)ilike $${n} or exists(select 1 from dartflow_private.support_ticket_events e where e.ticket_id=t.id${support ? '' : " and e.visibility='public'"} and e.body ilike $${n}))`);}
    if (f.status === 'open') where.push("t.status in('new','in_progress','waiting_for_user')"); else if (f.status === 'unhandled') where.push("t.status='new'"); else if (f.status !== 'all') add('t.status=?', f.status);
    if (f.category !== 'all') add('t.category=?', f.category); if (f.priority !== 'all') add('t.priority=?', f.priority);
    if (f.assignee === 'unassigned') where.push('t.assignee_id is null'); else if (f.assignee !== 'all') add('t.assignee_id=?', f.assignee === 'me' ? actor : f.assignee);
    const clause = where.length ? ' where ' + where.join(' and ') : '';
    const total = Number((await client.query(`select count(*)as n from dartflow_private.support_tickets t${clause}`, args)).rows[0].n);
    const rows = (await client.query<TicketRow>(`select t.* from dartflow_private.support_tickets t${clause} order by ${support ? 't.updated_at' : 't.public_updated_at'} desc,t.id limit $${args.length + 1} offset $${args.length + 2}`, [...args, f.limit, f.offset])).rows;
    const result: SupportTicketList = {tickets: rows.map(ticket => summary(ticket, support)), total, limit: f.limit, offset: f.offset, canManageSupport: support || await canManageSupport(client, actor), categories: SUPPORT_CATEGORIES, statuses: SUPPORT_STATUSES};
    if (!support) return result;
    const profiles = await people(client, rows.flatMap(ticket => [ticket.owner_id, ticket.assignee_id]));
    const tickets: SupportAdminTicketSummary[] = rows.map(ticket => ({...summary(ticket, true), owner: profiles.get(ticket.owner_id ?? '') ?? missingPerson(), assignee: profiles.get(ticket.assignee_id ?? '') ?? null, priority: ticket.priority}));
    const counts = (await client.query("select count(*)filter(where status in('new','in_progress','waiting_for_user'))::int as open,count(*)filter(where status='new')::int as unhandled from dartflow_private.support_tickets")).rows[0];
    return {...result, tickets, staff: await staff(client), counts};
  });
}
async function addEvent(client: Client, ticket: TicketRow, actor: string, support: boolean, kind: EventRow['kind'], body: string | null, changes: EventRow['changes'] = {}, internal = false): Promise<string> {
  const id = randomUUID(); await client.query('insert into dartflow_private.support_ticket_events(id,ticket_id,actor_id,actor_role,visibility,kind,body,changes)values($1,$2,$3,$4,$5,$6,$7,$8)', [id, ticket.id, actor, support ? 'support' : 'user', internal ? 'internal' : 'public', kind, body, JSON.stringify(changes)]); return id;
}
export async function supportNotificationRecipientEligible(client: Client, recipientId: string, reference: SupportNotificationReference | Record<string, unknown>): Promise<boolean> {
  try {
    await requireAccount(client, recipientId); const ticket = await row(client, reference.ticketId); if (reference.ticketNumber !== number(ticket)) return false;
    if (reference.recipientView === 'user') return ticket.owner_id === recipientId;
    if (reference.recipientView !== 'support' || !await canManageSupport(client, recipientId)) return false;
    return !ticket.assignee_id || !await canManageSupport(client, ticket.assignee_id) || ticket.assignee_id === recipientId;
  } catch (error) {if (error instanceof DomainError) return false; throw error;}
}
async function notify(client: PoolClient, ticket: TicketRow, actor: string, eventId: string, kind: 'support.created' | 'support.received' | 'support.user-replied' | 'support.reopened' | 'support.answered' | 'support.status-changed') {
  const toSupport = ['support.created', 'support.user-replied', 'support.reopened'].includes(kind);
  let recipients: string[];
  if (toSupport) {const active = await staff(client); recipients = ticket.assignee_id && active.some(person => person.id === ticket.assignee_id) ? [ticket.assignee_id] : active.map(person => person.id);}
  else recipients = ticket.owner_id ? [ticket.owner_id] : [];
  recipients = [...new Set(recipients)].filter(id => kind === 'support.received' || id !== actor);
  if (!recipients.length) return;
  const titles = {'support.created': 'Nieuw supportticket', 'support.received': 'Supportticket ontvangen', 'support.user-replied': 'Nieuwe reactie op supportticket', 'support.reopened': 'Ticket heropend', 'support.answered': 'Reactie van DartFlow Support', 'support.status-changed': 'Ticketstatus gewijzigd'};
  await enqueueNotificationEvent(client, {eventId, kind, actorId: actor, recipientIds: recipients, reference: {ticketId: ticket.id, ticketNumber: number(ticket), recipientView: toSupport ? 'support' : 'user'}, href: `${toSupport ? '/app/admin/support' : '/app/support'}/${ticket.id}`, title: `${titles[kind]} · ${number(ticket)}`, body: `Bekijk de opvolging van supportticket ${number(ticket)} in DartFlow.`});
}
function validateCommand(input: SupportCommand): SupportAction {
  if (!input || typeof input !== 'object' || !input.action || typeof input.action !== 'object') throw new DomainError('support_input', 'Gebruik een geldige ticketaanvraag.');
  exact(input as unknown as Record<string, unknown>, ['requestId', 'expectedRevision', 'action']); uuid(input.requestId);
  const a = input.action;
  const keys: Record<string, string[]> = {'ticket.create': ['category', 'subject', 'body'], 'ticket.reply': ['ticketId', 'body'], 'ticket.close': ['ticketId'], 'ticket.reopen': ['ticketId', 'body'], 'ticket.admin.reply': ['ticketId', 'body', 'status'], 'ticket.admin.note': ['ticketId', 'body'], 'ticket.admin.status': ['ticketId', 'status', 'reason'], 'ticket.admin.update': ['ticketId', 'priority', 'assigneeId', 'subject', 'category']};
  if (!Object.hasOwn(keys, a.type)) throw new DomainError('support_input', 'Onbekende ticketactie.'); exact(a as unknown as Record<string, unknown>, ['type', ...keys[a.type]]);
  if (a.type !== 'ticket.create') {uuid(a.ticketId); if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision! < 1) throw new DomainError('revision_required', 'Vernieuw het ticket voordat je de wijziging opslaat.', 409);}
  return a;
}
export async function executeSupportCommand(actor: string, input: SupportCommand): Promise<SupportCommandResult> {
  const action = validateCommand(input), support = adminAction(action), payloadHash = hash(canonical(input));
  return transaction(async client => {
    await requireAccount(client, actor); if (support) await requireSupport(client, actor);
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`support-request:${actor}:${input.requestId}`]);
    const receipt = (await client.query('select * from dartflow_private.support_ticket_receipts where actor_id=$1 and request_id=$2', [actor, input.requestId])).rows[0];
    if (receipt) {if (receipt.payload_hash !== payloadHash) throw new DomainError('request_reused', 'Dit aanvraag-ID is al voor andere inhoud gebruikt.', 409); const ticket = await row(client, receipt.ticket_id); await access(client, ticket, actor, support); return {ok: true, replayed: true, ticket: await detail(client, ticket, support)};}
    let ticket: TicketRow;
    if (action.type === 'ticket.create') {
      const category = enumValue(action.category, SUPPORT_CATEGORIES), subject = text(action.subject, 160), body = text(action.body, 8000), id = randomUUID();
      ticket = (await client.query<TicketRow>('insert into dartflow_private.support_tickets(id,owner_id,category,subject)values($1,$2,$3,$4)returning *', [id, actor, category, subject])).rows[0];
      const eventId = await addEvent(client, ticket, actor, false, 'created', body); await notify(client, ticket, actor, eventId, 'support.created'); await notify(client, ticket, actor, randomUUID(), 'support.received');
    } else {
      ticket = await row(client, action.ticketId, true); await access(client, ticket, actor, support);
      if ((support ? ticket.revision : ticket.public_revision) !== input.expectedRevision) throw new DomainError('revision_conflict', 'Het ticket is elders gewijzigd. Je invoer is niet overschreven; laad de nieuwste versie.', 409);
      let visible = false, eventId = '', notification: Parameters<typeof notify>[4] | undefined;
      const permission = supportPermissions(ticket.status, support, Boolean(ticket.owner_id));
      if (action.type === 'ticket.reply' || action.type === 'ticket.admin.reply') {
        if (!permission.canReply) throw new DomainError('ticket_closed', 'Heropen het opgeloste of gesloten ticket voordat je reageert.', 409);
        const next = action.type === 'ticket.reply' ? 'in_progress' : action.status === undefined ? 'waiting_for_user' : enumValue(action.status, ['waiting_for_user', 'in_progress', 'resolved']);
        const prior = ticket.status; ticket.status = next; eventId = await addEvent(client, ticket, actor, support, 'message', text(action.body, 8000), {fromStatus: prior, toStatus: next}); visible = true; notification = support ? 'support.answered' : 'support.user-replied';
      } else if (action.type === 'ticket.close' || action.type === 'ticket.reopen' || action.type === 'ticket.admin.status') {
        if (action.type === 'ticket.close' && !permission.canClose || action.type === 'ticket.reopen' && !permission.canReopen) throw new DomainError('ticket_transition', 'Deze ticketactie is nu niet beschikbaar.', 409);
        const next: SupportStatus = action.type === 'ticket.close' ? 'closed' : action.type === 'ticket.reopen' ? 'in_progress' : enumValue(action.status, SUPPORT_STATUSES); assertSupportTransition(ticket.status, next);
        if (!ticket.owner_id) throw new DomainError('ticket_closed', 'Dit geanonimiseerde ticket blijft gesloten.', 409);
        const prior = ticket.status; ticket.status = next;
        const body = action.type === 'ticket.reopen' && action.body !== undefined ? text(action.body, 8000) : action.type === 'ticket.admin.status' && action.reason !== undefined ? text(action.reason, 1000) : null;
        eventId = await addEvent(client, ticket, actor, support, 'status', body, {fromStatus: prior, toStatus: next}); visible = true; if (support) notification = 'support.status-changed'; else if (action.type === 'ticket.reopen') notification = 'support.reopened';
      } else if (action.type === 'ticket.admin.note') {
        if (!permission.canNote) throw new DomainError('ticket_closed', 'Dit geanonimiseerde ticket blijft gesloten.', 409); await addEvent(client, ticket, actor, true, 'internal_note', text(action.body, 8000), {}, true);
      } else if (action.type === 'ticket.admin.update') {
        let changed = false; const details: Record<string, string | null> = {};
        if (action.assigneeId !== undefined && action.assigneeId !== ticket.assignee_id) {if (action.assigneeId !== null && !await canManageSupport(client, uuid(action.assigneeId))) throw new DomainError('support_assignee', 'Kies een actuele bevoegde supportmedewerker.'); await addEvent(client, ticket, actor, true, 'assignment', null, {previousAssigneeId: ticket.assignee_id, assigneeId: action.assigneeId}, true); ticket.assignee_id = action.assigneeId; changed = true;}
        if (action.priority !== undefined) {const priority = enumValue(action.priority, SUPPORT_PRIORITIES); if (priority !== ticket.priority) {await addEvent(client, ticket, actor, true, 'priority', null, {previousPriority: ticket.priority, priority}, true); ticket.priority = priority; changed = true;}}
        if (action.subject !== undefined) {if (!permission.canEditDetails) throw new DomainError('ticket_closed', 'Dit geanonimiseerde ticket blijft gesloten.', 409); const subject = text(action.subject, 160); if (subject !== ticket.subject) {details.previousSubject = ticket.subject; details.subject = subject; ticket.subject = subject;}}
        if (action.category !== undefined) {if (!permission.canEditDetails) throw new DomainError('ticket_closed', 'Dit geanonimiseerde ticket blijft gesloten.', 409); const category = enumValue(action.category, SUPPORT_CATEGORIES); if (category !== ticket.category) {details.previousCategory = ticket.category; details.category = category; ticket.category = category;}}
        if (Object.keys(details).length) {await addEvent(client, ticket, actor, true, 'details', null, details); visible = true; changed = true;}
        if (!changed) throw new DomainError('ticket_unchanged', 'Er zijn geen wijzigingen om op te slaan.', 409);
      }
      await client.query('update dartflow_private.support_tickets set category=$2,subject=$3,status=$4,priority=$5,assignee_id=$6,revision=revision+1,public_revision=public_revision+$7,public_updated_at=case when $7=1 then clock_timestamp()else public_updated_at end,updated_at=clock_timestamp()where id=$1', [ticket.id, ticket.category, ticket.subject, ticket.status, ticket.priority, ticket.assignee_id, visible ? 1 : 0]);
      ticket = await row(client, ticket.id); if (notification) await notify(client, ticket, actor, eventId, notification);
    }
    await client.query('insert into dartflow_private.support_ticket_receipts(actor_id,request_id,ticket_id,payload_hash,audience)values($1,$2,$3,$4,$5)', [actor, input.requestId, ticket.id, payloadHash, support ? 'support' : 'owner']);
    return {ok: true, replayed: false, ticket: await detail(client, ticket, support)};
  });
}
