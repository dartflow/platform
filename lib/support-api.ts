import {NextRequest, NextResponse} from 'next/server';
import {DomainError} from './domain';
import {consumeRateLimit} from './db';
import {executeSupportCommand, getSupportTicket, getSupportTickets} from './support-tickets';
import type {SupportCommand, SupportTicketFilters} from './support-types';

type ReadBody = (request: NextRequest, maxBytes?: number) => Promise<Record<string, unknown>>;
const json = (data: unknown) => NextResponse.json(data, {headers: {'Cache-Control': 'private, no-store', Pragma: 'no-cache', Vary: 'Authorization, Cookie'}});
/** Called only after the existing cookie/native principal and global CSRF gate. */
export async function handleSupportApi(request: NextRequest, parts: string[], actor: string, readBody: ReadBody): Promise<NextResponse | null> {
  if (parts[0] !== 'support') return null;
  if (request.method === 'POST' && parts.join('/') === 'support/actions') {
    const quota = await consumeRateLimit(`support-write:${actor}`, 40, 60);
    if (!quota.allowed) throw Object.assign(new DomainError('rate_limited', 'Je hebt tijdelijk veel supportacties verstuurd. Probeer het straks opnieuw.', 429), {retryAfter: quota.retryAfter});
    return json(await executeSupportCommand(actor, await readBody(request, 20000) as SupportCommand));
  }
  if (request.method === 'GET') {
    const support = parts[1] === 'admin', offset = support ? 1 : 0;
    if (parts[1 + offset] !== 'tickets') return null;
    if (parts.length === 3 + offset) return json(await getSupportTicket(actor, parts[2 + offset], support));
    if (parts.length === 2 + offset) {
      const q = request.nextUrl.searchParams;
      const filters: SupportTicketFilters = {};
      for (const key of ['q', 'status', 'category', 'priority', 'assignee'] as const) if (q.has(key)) Object.assign(filters, {[key]: q.get(key)});
      for (const key of ['limit', 'offset'] as const) if (q.has(key)) filters[key] = Number(q.get(key));
      return json(await getSupportTickets(actor, filters, support));
    }
  }
  return null;
}
