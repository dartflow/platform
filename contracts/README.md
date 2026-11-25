# Oche Display API v1

The browser and Android display share `/api/oche/v1` and
[`oche-display-v1.schema.json`](./oche-display-v1.schema.json). Synthetic,
credential-free renderer fixtures are in `fixtures/oche-display-v1/`.
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
current device, grant version and location role on every request. Each lane's current availability is checked independently before projection.

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

## Opt-in screen layout extension (layout version 1)

Deploy `20261125154720_oche_screen_layout.sql` before the web backend and then
Android. The default v1 snapshot remains the primary lane and keeps its original
schema. New clients request `snapshot?panels=1` or
`events?panels=1&after=<eventId>`; the cookie path stays `/api/oche/v1`.
`capabilities.layouts.version === 1` and `context.layoutSupport === true` advertise
support. Without that capability clients use the valid single primary view.
The extension schema and synthetic single-source renderer inputs are in
`oche-display-v1-panels.schema.json` and `fixtures/oche-display-v1-panels/`.

A layout is `{orientation:'portrait'|'landscape',scoreboards:1|2}`; portrait
requires one board and two boards require a physical location. `layout:null`
means an existing device still uses its adaptive legacy layout. The primary
`board_id` remains intact for older clients. Explicit layout and both lane IDs
are stored atomically; physical screen and reservation counts are unchanged.

`start` accepts `layoutProposal`. Save that confirmed local choice before calling
start. Account `GET proposal?code=<shortCode>` returns
`{layoutProposal,targetDeviceId,device?}`. For a new installation the account
must explicitly supply `layout` in `claim`, plus optional `secondaryBoardId`.
For home the account must explicitly confirm one board. Both non-null lane IDs
must be distinct active lanes of the same location; missing lanes are allowed.

Account `POST devices/<id>` with
`{action:'configure',layout,boardId,secondaryBoardId,expectedRevision,requestId}`
updates composition and assignments in one transaction. `configurationRevision`
starts at zero. A stale revision returns HTTP 409 `configuration_conflict` and
retains the prior configuration. Retrying the same UUID and payload returns its
original receipt. Transitioning to one board clears the active secondary lane;
transitioning back to two does not restore it. Legacy `assign` preserves layout
and the secondary lane and rejects a duplicate primary assignment.

A linked display can `POST layout-proposal` with device authentication and
`{layout,requestId}`. This only creates an expiring short review code and pairing
QR; it grants no configuration authority and consumes no screen/reservation slot.
Keep polling the existing display session. Account proposal lookup verifies the
current owner/location manager. Account `claim` supplies the existing scope,
layout, assignments and `expectedRevision`, then atomically applies the reviewed
configuration to the same device. Both the displayed proposal revision and the
account revision must still be current. No re-pairing or redeem is needed.
The changed grant returns HTTP 401 `device_assignment_changed`; erase the old
projection, refresh the existing session, and load the effective server layout.
An expired access token instead returns `device_unauthorized`.

Extended snapshots include `layout`, `configurationRevision`, and ordered
`panels` with stable `position:'left'|'right'`, `sourceId`, `status` and an
individual v1 `snapshot` (with its own cursor/revision, session key, activity
deadlines and events). A missing assignment is `unassigned`; a lane removed from
the location is `unavailable`; a projection error/timeout is `error`. These states
carry no projection or QR. Individual projection SQL is isolated with savepoints
and a total 1000 ms source budget (each SQL receives only the remaining time) so
one source failure does not abort the other and two stalled sources fit the
existing 2500 ms client request deadline. Legacy v1 retains its original timeout
behavior.
The device is authorized once per poll; revocation removes access to both lanes.
Clients baseline events separately per position and source/session on initial
load, reconnect or reassignment, and suppress playable QR codes while offline.
