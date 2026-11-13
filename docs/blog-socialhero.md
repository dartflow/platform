# DartFlow Blog en SocialHero

Publieke routes: `/blog`, `/blog/[slug]`. Redactie: **Blogbeheer** in het platformmenu (`/app/blog`) of `/blog/beheer`. Alleen bestaande platformrollen `owner` en `admin` hebben toegang. Preview: `/blog/beheer/voorbeeld/<artikel-id>?revisie=<nummer>`; sessiecontrole, private/no-store, noindex. De bestaande Google- en e-mailaanmelding behouden de terugkeerroute.

## Redactie

De meegeleverde Sites-bron bepaalt de publieke layout en de Tiptap-bediening. Concepten en liveversies zijn afzonderlijke, onveranderlijke JSON-revisies (schema 1). Een bewerking maakt een nieuwe conceptrevisie. Publiceren kiest expliciet de actuele revisie; een titelwijziging behoudt de slug. Een bewuste slugwijziging reserveert de eerdere openbare URL en geeft een permanente redirect rechtstreeks naar de huidige liveversie. Revisiegeschiedenis kan een eerdere tekst als nieuw concept herstellen. Bij een conflict blijft lokale invoer staan; de redacteur kan vergelijken, de nieuwste versie laden of de eigen tekst bewust als nieuwe revisie bewaren.

Hero en deelbeeld worden apart geüpload. Alt-tekst en het focuspunt horen bij de revisie. De brede fallback is een 1200×630 WebP-uitsnede van dezelfde hero, rond het gekozen focuspunt. Alleen media die door een liveversie worden gebruikt zijn zonder account opvraagbaar. Rasterinvoer is begrensd op 10 MB, 24 miljoen pixels en 12.000 pixels per zijde; werkelijk bestandstype wordt gecontroleerd en het beeld wordt opnieuw gecodeerd. SVG, HTML en geanimeerde bestanden worden niet aangenomen.

De datumkiezer gebruikt Europe/Amsterdam, inclusief zomer-/wintertijdcontrole. UTC-planning wordt door de bestaande loopback-mailworker verwerkt via `/api/mail/process`; dit werkt zonder bezoekers. De bestaande worker-authenticatie en hostcontrole blijven gelden. Publiceren en archiveren leggen cacheverversing transactioneel vast. De worker en succesvolle schrijfacties verwerken deze outbox met Next `revalidatePath`; publieke pagina’s lezen daarnaast dynamisch de actuele liveversie.

## Opslag en release

Migratie: `supabase/migrations/20261113120254_blog_publication.sql`, aangemaakt met de Supabase CLI en idempotent voor de bestaande `npm run db:migrate`-releaseprocedure. De private tabellen zijn `blog_posts`, `blog_revisions`, `blog_routes`, `blog_media`, `blog_tokens`, `blog_receipts`, `blog_audit`, `blog_invalidation`. Browserrollen krijgen geen grants. De beperkte bestaande serverrol `dartflow_app` gebruikt RLS; revisies, receipts en auditregels zijn voor die rol onveranderlijk. Media staan als begrensde rasterbytes in dezelfde private database. Er is geen nieuw publiek bucket of VPS-mount nodig.

Voer de migratie met de bestaande beheerverbinding uit vóór de apprelease, na een geverifieerde back-up. Gebruik de bestaande GitHub CI en native VPS-broker met de bestaande immutable configuratie. Er zijn geen nieuwe GitHub-secrets of runtimevariabelen nodig. Bestaande configuratienamen: `DARTFLOW_ENV`, `DARTFLOW_APP_ORIGIN`, `DARTFLOW_DATA_MODE`, `DARTFLOW_DATABASE_URL`, migratie-only `DARTFLOW_DATABASE_ADMIN_URL`, en `DARTFLOW_MAIL_WORKER_TOKEN`. Productiecanonical is `https://dartflow.nl`; staging gebruikt `https://staging.dartflow.nl` en blijft noindex.

## Websitecontract v1

| Operatie | Endpoint | Recht |
| --- | --- | --- |
| Alleen-lezen mogelijkheden | `GET /api/socialhero/v1/capabilities` | `read` |
| Media uploaden | `POST /api/socialhero/v1/media` multipart `file` | `media:write` |
| Concept upsert | `PUT /api/socialhero/v1/posts/<externalId>` | `drafts:write` |
| Actuele status | `GET /api/socialhero/v1/posts/<externalId>` | `read` |
| Expliciete revisie publiceren | `POST /api/socialhero/v1/posts/<externalId>/publish` | `publish` |

Geen afwijkende endpointmapping. `contractVersion` is de string `1`; `type` ondersteunt `blog` en `article`. SocialHero levert Markdown; DartFlow converteert zonder ruwe HTML naar hetzelfde Tiptap-schema. Auteur `redactie`; categorieën worden uit capabilities gekozen. Revisies zijn gehele getallen; `If-Match` is verplicht bij het vervangen van een bestaand concept. Status bevat de actuele revisie, gepubliceerde revisie en daadwerkelijke URL. De publieke HTML bevat `socialhero:external-id` en `socialhero:revision` voor versiecontrole.

Elk credential is aan site `dartflow`, één omgeving, scopes en verloop gekoppeld. Uitgifte/rotatie: geauthenticeerd `POST /api/blog/integration` met `name`, `scopes`, `expiresInDays` en eventueel `rotateId`. De waarde wordt uitsluitend bij uitgifte teruggegeven; opslag bevat SHA-256-verifiers. Intrekken: `POST /api/blog/integration/<id>/revoke`. Metadata-overzicht: `GET /api/blog/integration`. Bewaar de eenmalige waarde direct in SocialHero’s versleutelde, project- en omgevingsgebonden websiteverbinding. Zet deze nooit in browserconfiguratie, source, chat, logs of meetlinks.

Schrijfoperaties vereisen een duurzame `Idempotency-Key`. De fingerprint omvat operatie, doel, scopes, verwachte revisie en inhoud of mediachecksum. Een succesvolle retry geeft de eerdere uitkomst terug, ook wanneer een latere revisie bestaat. Andere invoer met dezelfde sleutel geeft 409. Verouderde revisies geven 412; validatiefouten 422; te grote invoer 413; persistente snelheidslimieten 429 met `Retry-After`. Media komen uitsluitend als bestand binnen: de website haalt geen willekeurige externe URL op.

## SocialHero

Beheer → Websites → Blogpublicatie bewaart de juiste staging- of productiebestemming, read-only verbindingstest, auteur/categorie/taal, bevestigd merkprofiel en onafhankelijke hero-/deelbeeldpresets. De versleutelde verbinding hergebruikt de bestaande `SOCIALHERO_MASTER_KEY` en private opslag; geen nieuw omgevingssecret.

De bestaande campagnegoedkeuring zet de publicatierevisie vast. De worker bewaart per operatie media, concept, UTC-planning, revisie, URL en retry-identiteit. Afhankelijke socialtaken blijven geblokkeerd totdat een openbare GET canonical, externe identiteit en gepubliceerde revisie bevestigt. UTM-parameters komen uitsluitend op de gedeelde URL. Een ontbrekende socialprovider blijft als zodanig zichtbaar; dit wordt niet als een verzonden bericht gerapporteerd.

## Verificatie

Lokale URL: `http://localhost:3000/blog` en `/blog/beheer`. Lokaal worden uitsluitend de bestaande synthetische accounts en ontwikkeldata gebruikt. `tests/blog-content.test.ts`, `tests/blog-backend.test.ts`, `tests/blog-public.test.ts` en `tests/e2e/blog.spec.ts` bewaken inhoud, transacties, media, API, editor, publicatie en SSR. `scripts/qa-blog-public.mjs` vergelijkt de meegeleverde bron op 1440×900, 1024×768, 768×1024 en 390×844. Werkelijke release- en stagingresultaten worden apart bij de oplevering vastgelegd.
