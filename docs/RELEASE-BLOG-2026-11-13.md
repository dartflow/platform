# DartFlow Blog · oplevering 13 november 2026

De blog en de SocialHero-koppeling zijn geïmplementeerd en via de bestaande DG Webservices-releaseflow op staging geactiveerd. Productie is bij deze opdracht niet gewijzigd. Het uitvoerbare applicatieartefact en de later toegevoegde testdocumentatie hebben afzonderlijke commits.

## Openen

- Lokaal: `http://localhost:3000/blog`, `http://localhost:3000/blog/beheer`.
- Publiek staging: <https://staging.dartflow.nl/blog>.
- Blogbeheer: <https://staging.dartflow.nl/blog/beheer>, met het bestaande platformbeheeraccount; ook bereikbaar via `/app/blog`.
- Werkelijk vanuit SocialHero gepubliceerd proefartikel: <https://staging.dartflow.nl/blog/socialhero-integratietest-ef08c3da>.
- SocialHero staging: <https://socialhero-staging.dgwebservices.nl> → Beheer → Websites → Blogpublicatie → DartFlow.
- SocialHero lokaal: `http://localhost:3107`.

De vier tijdelijke layout/API-artikelen en het afzonderlijke timerproefartikel zijn gearchiveerd. Alleen het herkenbare SocialHero-proefartikel blijft beschikbaar voor controle. Staging blijft noindex.

## Repositories en releases

| Repository | Applicatiecommit | Actieve stagingrelease |
|---|---|---|
| `dartflow/platform` | `daacf7af967b9db83dafc533efded6d055315e0d` | `43426760881-1` |
| `socialherodgweb/platform` | `083b0d80b4231c0dc12e10340cb31e3434786f17` | `083b0d80b4231c0dc12e10340cb31e3434786f17-43425449172-1` |

DartFlow-implementatie: `283f82e6af5156abcd5f71e0e30ffff8a14d1d67`, gevolgd door `daacf7a` met regressieherstel voor planning, revisieretries en HTTP-upserts. De immutable stagingconfiguratie is `staging-2026-11-12-v19-pin-1`. SocialHero behoudt zijn bestaande SQLite-v2-configuratie.

- [DartFlow CI](https://github.com/dartflow/platform/actions/runs/43425459356) en [native stagingdeploy](https://github.com/dartflow/platform/actions/runs/43426760881): geslaagd.
- [SocialHero native build](https://github.com/socialherodgweb/platform/actions/runs/43425449172) en [stagingactivatie](https://github.com/socialherodgweb/platform/actions/runs/43425644775): geslaagd.

De laatste read-only productiecontrole rapporteerde DartFlow `8246b2945ead34ebeb7ba34c2abe1334b5372e2c` en SocialHero `d848d102d632ddde8c444c9deca6746634bf8a7e`, beide gezond. Voor deze blogwijziging is geen productiemigratie, productiecredential of productiepublicatie uitgevoerd.

## Implementatie

De publieke routes `/blog` en `/blog/[slug]` renderen inhoud en metadata op de server. De homepage toont maximaal drie nieuwste live artikelen tussen community en FAQ, met de gevraagde omslagpunten voor drie, twee en één kolom. De meegeleverde afbeeldingen, fonts, kleuren, kaarten, detailpagina, filter- en lege states zijn overgenomen binnen de bestaande productieshell.

Blogbeheer bevat Tiptap, dezelfde blokken en bediening, media/alt/focuspunt, SEO, concepten, beveiligde preview, revisiegeschiedenis, herstel, directe publicatie en planning. Concept- en liverevisies zijn afzonderlijk. Een titelwijziging behoudt de live-URL; een bewuste slugwijziging reserveert de oude route en geeft een permanente redirect. Bij conflicten blijft lokale tekst beschikbaar en wordt geen ongeziene revisie gepubliceerd.

Live media zijn openbaar, conceptmedia niet. De portrethero en brede deelafbeelding zijn afzonderlijk; zonder breed bestand wordt een uitsnede rond het opgeslagen focuspunt gemaakt. Canonical, Open Graph, Twitter Card, artikel-JSON-LD en sitemap volgen de liveversie. Publicatie en archivering verversen ook homepage en archief zonder applicatiedeploy.

SocialHero hergebruikt zijn versleutelde websiteverbinding, goedkeuringen, media, campagnejobs en revisies. Blogpublicatie toont defaults, bevestigde branding en onafhankelijke hero-/deelbeeldpresets. Een afhankelijke socialtaak krijgt pas een deel-URL nadat de openbare HTML de juiste externe identiteit, revisie en canonical bevestigt.

## Migratie en configuratie

Migratie: [`20261113120254_blog_publication.sql`](../supabase/migrations/20261113120254_blog_publication.sql). Deze is met de Supabase CLI aangemaakt, idempotent voor de bestaande migratierunner en vóór de stagingrelease toegepast op project `dsnqnvbckkqpzadblshu`.

De acht `blog_*`-tabellen staan in `dartflow_private`. RLS is op alle acht actief; `anon` en `authenticated` hebben geen SELECT-grants. De bestaande beperkte serverrol gebruikt de tabellen; revisies, receipts en auditregels zijn onveranderlijk voor die rol. Media gebruiken private databaseopslag, zonder nieuwe publieke bucket of mount. SocialHero heeft voor deze uitbreiding geen nieuwe schemamigratie nodig.

Er zijn **geen nieuwe GitHub-secrets of runtimevariabelen** nodig. Bestaande namen:

- DartFlow: `DARTFLOW_ENV`, `DARTFLOW_APP_ORIGIN`, `DARTFLOW_DATA_MODE`, `DARTFLOW_DATABASE_URL`, migratie-only `DARTFLOW_DATABASE_ADMIN_URL`, `DARTFLOW_MAIL_WORKER_TOKEN`.
- SocialHero: `SOCIALHERO_ENV`, `SOCIALHERO_PUBLIC_URL`, `SOCIALHERO_WORKSPACE_ID`, `SOCIALHERO_DB_PATH`, `SOCIALHERO_MASTER_KEY`.

Het aparte staging-sitecredential is aan site `dartflow`, omgeving `staging`, verloop en scopes `read`, `media:write`, `drafts:write`, `publish` gebonden. DartFlow bewaart alleen de verifier; SocialHero bewaart de waarde versleuteld in de projectverbinding. Tijdelijke plaintextbestanden zijn verwijderd. De afzonderlijke read-only testsleutel is ingetrokken. Een latere productieaansluiting vereist een eigen productiecredential, geen kopie van de stagingsleutel.

Vóór de migratie is de beschermde stagingback-up volledig gedecodeerd en zijn vijf bestandshashes gecontroleerd. Dit was een archiefcontrole; er is geen restore-oefening uitgevoerd.

## API-mapping

Het pakketcontract is rechtstreeks geïmplementeerd; geen afwijkende endpointmapping:

| Doel | Endpoint |
|---|---|
| Read-only verbindingstest | `GET /api/socialhero/v1/capabilities` |
| Beeldbestand | `POST /api/socialhero/v1/media`, multipart `file` |
| Concept | `PUT /api/socialhero/v1/posts/{externalId}` |
| Status | `GET /api/socialhero/v1/posts/{externalId}` |
| Expliciete revisie publiceren | `POST /api/socialhero/v1/posts/{externalId}/publish` |

SocialHero Markdown wordt zonder ruwe HTML naar hetzelfde editor-JSON-schema geconverteerd. Een bestaand concept vereist `If-Match`. Schrijfacties hebben een duurzame `Idempotency-Key`; dezelfde operatie geeft bij retry dezelfde uitkomst, gewijzigde invoer met die sleutel geeft 409, een verouderde revisie 412.

SocialHero accepteert de afgesproken geneste foutcode en de vlakke DartFlow-variant. Bekende codes blijven herkenbaar; HTTP 401/403 wordt intern `PERMISSION_DENIED`, 404 `NOT_FOUND`, 412 `REVISION_CONFLICT`. Onbekende fouten worden geredigeerd naar `WEBSITE_REJECTED`. Volledige payload-, rechten- en foutmapping: [`blog-socialhero.md`](blog-socialhero.md) en SocialHero `docs/DARTFLOW-BLOG-KOPPELING.md`.

## Werkelijk geteste resultaten

**DartFlow CI op de actieve applicatiecommit:** 386 domein/backend/contenttests, 46 prototypetests en 66 browser-E2E-tests geslaagd. Ook typecheck, lint, build, de bestaande deployer/bootstrapcontracten en de vijf extra Feed/chat-browserchecks slagen. De gerichte editorregressies dekken onder meer twee gelijktijdige redacteuren, revisieherstel, planning A/annuleren/B/annuleren en een verloren saveantwoord gevolgd door een ongeziene nieuwere revisie.

**Werkelijke staging-HTTP-proef:** 30 controles geslaagd. Daaronder read-only scopes, publieke versus private inhoud/media, veilige Markdown, SSR/crawlermetadata, echte rasterdimensies, MIME-spoofing, te grote invoer, gelijktijdige writes, `If-Match`, expliciete publicatie, duurzame retries, slugredirects, de nieuwste drie homepagekaarten en archiveren. Afzonderlijk geven een verlopen en een ingetrokken credential beide HTTP 401. Alle acht private tabellen hebben de verwachte RLS en grants. De invalidatie-outbox is leeg na verwerking.

**Planning zonder bezoekers:** een via de bestaande domeinfuncties opgeslagen en geplande stagingrevisie stond op `2026-11-13T12:49:09.536Z`. De bestaande systemd-mailtimer publiceerde om `12:49:21.263Z`, met een serverpublicatie zonder gebruikersactor. De eerste publieke GET volgde pas om `12:49:33.521Z` en gaf 200. De worker is niet handmatig aangeroepen voor deze proef. Archivering gaf daarna 404. Alle tijden zijn UTC.

**Visuele vergelijking:** 20 lokale vergelijkingen tegen de meegeleverde Sites-bron op 1440×1000, 900×1200, 540×960 en 390×844. Maximale gemeten geometrieafwijking: 0 px; maximaal afwijkende pixels: 0,01914%. Daarnaast twaalf editorcontroles met echte gebouwde assets, inclusief smalle viewports en open menu's, zonder horizontale overflow of JavaScriptfouten.

**Echte stagingbrowser:** twaalf homepage-, archief- en artikelweergaven op 1440×900, 1024×768, 768×1024 en 390×844, met werkelijk geladen afbeeldingen. Geen JavaScriptfouten of horizontale overflow. De homepage heeft respectievelijk drie, drie, twee en één kolom. Filter/lege zoekstaat en anonieme afscherming van beheer/preview slagen. De bestaande app, login en openbare Oche Live-route geven 200.

**SocialHero:** 206 tests, typecheck, build, 22 UI-controles en de staginggezondheidscontroles slagen. De echte keten gebruikte de gedeployde persistente workerlogica vanuit een operatorharness; exclusieve verwerking door de achtergronddienst wordt voor deze proef niet geclaimd. De goedgekeurde campagne `dartflow-blog-acceptance-ef08c3da` doorliep pauzeren/hervatten, uploads van exact 1200×1800 en 1200×630, privéconcept vóór de geplande tijd, publicatie op de echte klok, identieke retries en publieke revisiecontrole. Er is precies één blogreceipt. De socialtaak ging van `WAITING_FOR_WEBSITE` naar `PROVIDER_NOT_CONFIGURED` met de juiste UTM-deel-URL, terwijl canonical schoon bleef.

Er is geen AI-aanvraag gedaan en geen socialbericht verstuurd. De meegeleverde referentieafbeelding is door de bestaande mediapipeline verwerkt. De socialprovider is niet geconfigureerd; echte socialbezorging en een externe platformpreviewvalidator zijn dus niet getest.

## Bewijs en resterende validatie

De compacte, zonder secrets opgeslagen resultaten staan in [`evidence/blog-2026-11-13.json`](evidence/blog-2026-11-13.json). Lokale screenshots en detailmetingen staan onder `artifacts/blog-public/`, `artifacts/blog-staging/` en in de SocialHero-checkout onder `artifacts/dartflow-blog-deployment/` en `artifacts/dartflow-blog-staging-ui/`.

De editorwrites zijn lokaal met ontwikkelaccounts getest; op hosted staging zijn beheer en preview alleen anoniem op afscherming gecontroleerd. Een echte Google-/e-mail-loginronde, fysieke apparaatinstallatie en het versturen van een bericht via een echte socialprovider vallen buiten het geleverde testbewijs. Bestaande niet aan deze opdracht gerelateerde lokale SocialHero-edits zijn behouden en maken geen deel uit van de hierboven vermelde release.
