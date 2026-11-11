/**
 * Server-side voorbeeldcontract. Koppel aan de bestaande repository en pinned Resend SDK.
 * De implementatie van database, autorisatie en secretopslag hoort in de echte app.
 */

type Environment = 'staging' | 'production';
type MailMode = 'log' | 'resend';

export type ResendSettingsView = {
  environment: Environment;
  revision: number;
  mode: MailMode;
  from: { name: string; address: string } | null;
  replyTo: string | null;
  keyStatus: 'missing' | 'stored' | 'verified' | 'attention';
  keyChangedAt: string | null;
  webhookUrl: string;
  webhookStatus: 'missing' | 'stored' | 'verified' | 'attention';
  lastVerifiedWebhookAt: string | null;
  lastTest: { at: string; outcome: 'accepted' | 'failed'; jobId: string } | null;
};

/** Alleen invoer van een geautoriseerde eigenaarmutatie. */
export type UpdateResendSettings = {
  expectedRevision: number;
  mode?: MailMode;
  from?: { name: string; address: string };
  replyTo?: string | null;
  testRecipients?: string[];
  apiKey?: string;
  webhookSigningSecret?: string;
};

type MailPayload = Readonly<{
  from: { name: string; address: string };
  to: string;
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
}>;

export type ClaimedMailJob = Readonly<{
  id: string;
  environment: Environment;
  kind: 'event' | 'test';
  claimToken: string;
  idempotencyKey: string;
  payload: MailPayload;
}>;

type Runtime = Readonly<{
  environment: Environment;
  mode: MailMode;
  exactTestRecipients: ReadonlySet<string>;
}>;

type TransportOutcome =
  | { status: 'simulated' }
  | { status: 'suppressed'; reason: 'recipient-outside-test-allowlist' }
  | { status: 'accepted'; providerMessageId: string }
  | { status: 'retry'; code: string; retryAfterSeconds?: number }
  | { status: 'uncertain'; code: string }
  | { status: 'failed'; code: string };

type ResendTransport = {
  send: (payload: MailPayload, idempotencyKey: string) => Promise<TransportOutcome>;
};

/** Roep aan na domein-/voorkeurscontrole en commit van de workerlease. */
export async function offerClaimedJob(
  job: ClaimedMailJob,
  runtime: Runtime,
  resend: ResendTransport,
): Promise<TransportOutcome> {
  if (job.environment !== runtime.environment) throw new Error('mail-environment-mismatch');
  if (runtime.mode === 'log') return { status: 'simulated' };

  const needsTestAllowlist = runtime.environment === 'staging' || job.kind === 'test';
  if (needsTestAllowlist && !runtime.exactTestRecipients.has(job.payload.to)) {
    return { status: 'suppressed', reason: 'recipient-outside-test-allowlist' };
  }

  // Adapter laadt en ontsleutelt de opgeslagen omgevingskey server-side.
  // Iedere transportpoging gebruikt dezelfde opgeslagen payload en transportsleutel.
  return resend.send(job.payload, job.idempotencyKey);
}

type VerifiedDeliverySignal = Readonly<{
  providerEventId: string;
  providerMessageId: string;
  eventType: string;
  occurredAt: string;
}>;

type WebhookDependencies = {
  verify: (
    payload: string,
    headers: { id: string; timestamp: string; signature: string },
  ) => Promise<VerifiedDeliverySignal>;
  storeIdempotently: (signal: VerifiedDeliverySignal) => Promise<void>;
};

/** Verifieer met de officiële SDK en het serversecret van deze omgeving. */
export async function receiveResendWebhook(
  request: Request,
  { verify, storeIdempotently }: WebhookDependencies,
): Promise<Response> {
  const id = request.headers.get('svix-id');
  const timestamp = request.headers.get('svix-timestamp');
  const signature = request.headers.get('svix-signature');
  if (!id || !timestamp || !signature) return new Response(null, { status: 400 });

  const raw = await request.text();
  let signal: VerifiedDeliverySignal;
  try {
    signal = await verify(raw, { id, timestamp, signature });
  } catch {
    return new Response(null, { status: 401 });
  }

  // Store gebruikt de eigen runtimeomgeving en een unieke provider-event-ID.
  // Koppel een nog onbekend providerbericht later, zonder de raw body te loggen.
  await storeIdempotently(signal);
  return new Response(null, { status: 204 });
}
