# Oche Display API v1

The browser and Android display share `/api/oche/v1` and
[`oche-display-v1.schema.json`](../../contracts/oche-display-v1.schema.json). Synthetic,
credential-free renderer fixtures are in `contracts/fixtures/oche-display-v1/`.
Production origin is `https://dartflow.nl`; staging uses its own configured
origin, database, credentials and Android application identity.

## Pairing and device access

| Method / path | Input | Result |
| --- | --- | --- |
| GET `capabilities` | None | Version, origin, code policy, read-only permissions and polling/revocation budgets. |
| POST `start` | `platform`, UUID `requestId`; native may supply prior `installationId` and `installationSecret` to explicitly regenerate | `OchePairing`; native additionally receives the 32-byte random installation secret. Browser receives an HttpOnly cookie instead. |
| GET `status` | Installation authentication | `OchePairingStatus`; pending status includes the same pairing code for other tabs. |
| POST `redeem` | Installation authentication; UUID `nonce` | `OcheSession`; native receives bearer/refresh credentials, browser receives HttpOnly cookies. |
| POST `refresh` | UUID `nonce`; native body `refreshToken`, browser cookie | Rotated `OcheSession`. |
| GET `snapshot` | Device access authentication | `OcheDisplaySnapshot`. |
| GET `events?after=<eventId>` | Device access authentication | `{apiVersion,eventId,reset,snapshot}`. An immediate authorized poll, not a persistent unauthenticated realtime subscription. |
| POST `logout` | Device access authentication | Revokes the current device and clears browser device cookies. |

Native installation authentication uses
`Authorization: OcheInstall <installationId>.<installationSecret>`.
Device access uses `Authorization: Bearer <accessToken>`. Never place either
credential in a URL, QR, analytics or logs. Authorization and Cookie headers
must remain redacted by the ingress proxy. Browser cookies are HttpOnly,
Secure on HTTPS, SameSite Strict, scoped to `/api/oche/v1`; cookie mutations
require the configured exact Origin. JSON bodies are limited to 8192 bytes.
HTTPS is mandatory outside the loopback-only local environment.

Clients create cryptographically random UUID request IDs/nonces and persist an
operation's nonce **before** its first request. A retry after a lost reply uses
the identical nonce and payload. Rotated refresh credentials must be stored
atomically with removal of the pending nonce. Refresh receipts recover the
same refresh generation for ten minutes, until that returned credential itself
rotates again. If only its two-minute access credential expired, recovery mints
current access without another rotation or slot. A repeated old refresh
operation cannot resurrect an older credential.
Access credentials expire after two minutes and are also checked against the
current device, grant version, location role and board on every request.

Codes contain eight Crockford Base32 characters, displayed as `XXXX–XXXX`, and
expire after ten minutes. QR prefill is only `/koppel-scherm#code=<code>`; the
management client consumes and clears the fragment. Approval requires an
existing account session and explicit confirmation. Approval reserves a slot
for at most two minutes and never extends the original code deadline. Codes
become unusable after redemption. Pending codes consume no capacity; approved
reservations do. Replacement reservations retain the old device until atomic
activation and reserve that same slot, rather than charging it twice.

## Account management API (also reusable by the future player app)

All management paths require the existing DartFlow account authentication;
device credentials never authorize these operations.

| Method / path | Input / result |
| --- | --- |
| GET `context` | `OcheManagement`: authorized locations/boards, devices, legacy devices, capacity, explicit home-session choices. |
| GET `devices` | `{devices: OcheDevice[]}`. |
| POST `claim` | `OcheClaim`: code, scope, name, optional location/board/replacement, UUID requestId. |
| POST `devices/<id>` | `{action:'rename'|'assign'|'revoke', name?,boardId?,requestId}`. Assign invalidates old access; refresh obtains the current assignment. |
| POST `limits` | `{locationId,maximum,requestId}`; current platform owner/admin only, integers 1–1000. |
| POST `home-session` | `{sourceId:string|null,requestId}`; only a source owned by or currently involving the account. |

Home capacity is fixed at one. Physical venues default to two, shared across
Android and browser devices. Offline devices retain their place. Lowering a
limit preserves existing displays but blocks new approvals, activation and
replacement while above the new limit. All capacity mutations serialize on
one scope lock. Pairing operations first take an installation guard, then the
capacity scope, then installation/reservation/device row locks. This also
serializes explicit new-code requests against concurrent approval. Revoke,
legacy activation and central limit edits use that same scope lock.

Existing private physical-board browser grants also consume shared capacity.
They remain visible as `legacyDevices` and in the existing board screen UI;
revoke them with `DELETE /api/boards/<boardId>/screen-devices/<id>`. For this
transition they must be explicitly disconnected before being enrolled through
v1; a legacy grant cannot be a v1 replacement target. New legacy physical-board
provisioning returns `use_screen_pairing` and points to `/oche-live` and
`/koppel-scherm`. Existing public board projections and playing QR URLs remain
compatible; no private home data is added to them.

## Projection, transport and configuration

Clients poll every two seconds and revalidate access for every poll. No
subscription caches account/grant authority. The tested revocation budget is
five seconds; on 401/403/410 and failed refresh, erase the previous projection
from the rendered UI. On network loss only, keep the last permitted projection
with an offline indicator. Reconnect, resume and event gaps fetch a full current
snapshot. Stable score event IDs baseline initial/reconnected views and
deduplicate animations; boardless home events reuse accepted command receipts
and audit records, rather than maintaining another score ledger.

The generic device scope is strictly `{read:true,score:false,extend:false}`.
Existing separately authorized scoring and Doorspelen interfaces retain their
own authority; a generic paired display says to continue on the phone.

Optional `DARTFLOW_SCREEN_PAIRING_SECRET` must contain at least 32 bytes. If
absent, the existing strong `DARTFLOW_MAIL_WORKER_TOKEN` is the root secret.
Distinct HMAC purpose labels derive code-digest, access-signing and encrypted
retry-receipt keys. No new GitHub secret is required with that existing root.
Changing the root invalidates outstanding display credentials/receipts; plan
re-enrollment and do not silently rotate it. Local development uses a generated
0600 key in ignored `.local/oche-device.key` if neither root is configured.

The private migration is additive and enables RLS on all eight new tables.
Browser database roles receive no access. Only the limited server runtime role
reads/updates the registry, credentials, encrypted receipts and audit records.
Persistent IP, installation, access-token and authenticated-account limits
return 429 with `Retry-After`; clients honor that delay. Error bodies contain
only stable `code`, user-facing `message` and optional capacity metadata.

`cleanupOcheDevices` runs in the existing worker; claims synchronously expire
their scope's old reservations as well, so capacity recovery does not depend
on a display being open.

## Verification evidence

Migration: `supabase/migrations/20261113162231_oche_display_installations.sql`,
created with Supabase CLI 3.1.0. Local owner applies DDL; the application uses
the limited `dartflow_app` role. No hosted database was modified by the backend
implementation worker.

Complete repository suite after the backend freeze: **414/414 passed, zero
skipped**, reported by the release owner. Typecheck, lint and the production
build also passed. Tests exclusively use synthetic loopback data. The final
release report records the rebuilt release and browser/Android acceptance.

The real database cases cover home one-slot claims, Android/browser shared
capacity, venue default two, central override three and reduction to two,
approved reservation versus a reduced limit, explicit atomic replacement,
refresh replay/rotation, transient lost responses, code regeneration, expiry
without a client, revoked issuer rights, board ownership, private projections,
legacy quota bridges, boardless home score/undo events and reauthorization of
the event poll two seconds after revoke (asserted below five seconds).
API checks cover HttpOnly/SameSite/path flags, cookie CSRF, rejected old custom
secret headers, the redacted Authorization installation scheme, no-store,
payload limits, persistent cooldown/Retry-After and recovery after cooldown.

This worker did not perform physical Android/TV or Google Play verification;
those results belong to the app/release acceptance report.
