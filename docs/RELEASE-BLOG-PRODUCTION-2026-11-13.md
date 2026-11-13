# DartFlow Blog · productie-uitrol 13 november 2026

De op staging geteste blogversie en SocialHero-koppeling zijn via de bestaande DG Webservices-releaseflow op productie geactiveerd. Beide health- en readinesscontroles geven 200. De productieblog bevat tijdens de eindcontrole nog geen artikelen; stagingproefartikelen zijn niet overgezet.

## Openen

- Blog: <https://dartflow.nl/blog>.
- Blogbeheer: <https://dartflow.nl/blog/beheer>, bereikbaar met het bestaande platformbeheeraccount en via `/app/blog`.
- SocialHero: <https://socialhero.dgwebservices.nl> → Beheer → Websites → Blogpublicatie → DartFlow.

## Actieve releases

| Applicatie | Geteste applicatiecommit | Productierelease | Configuratie |
|---|---|---|---|
| DartFlow | `daacf7af967b9db83dafc533efded6d055315e0d` | `43455727606-1` | `production-2026-11-12-v19-pin-1` |
| SocialHero | `083b0d80b4231c0dc12e10340cb31e3434786f17` | `083b0d80b4231c0dc12e10340cb31e3434786f17-43456288578-1` | `v2` |

- [DartFlow productie-uitrol](https://github.com/dartflow/platform/actions/runs/43455727606): geslaagd, met de eerdere groene [CI op exact dezelfde applicatiecommit](https://github.com/dartflow/platform/actions/runs/43425459356).
- [SocialHero productie-CI](https://github.com/socialherodgweb/platform/actions/runs/43455726926): geslaagd, inclusief 206 tests, typecheck en build.
- [SocialHero native build](https://github.com/socialherodgweb/platform/actions/runs/43456288578) en [activatie](https://github.com/socialherodgweb/platform/actions/runs/43456518606): geslaagd. Het verzegelde manifest bevestigt exact bovenstaande commit en databasecompatibiliteit `socialhero-sqlite-v2-images`.

De gedeelde VPS-bouwlock is gerespecteerd. Andere lokale SocialHero-wijzigingen en latere integratiebranchwijzigingen zijn niet als applicatiebron meegenomen. De twee productiereleases bevatten dezelfde applicatiecommits als de eerdere stagingacceptatie. Bewijsdocumentatie wordt daarna apart gecommit.

## Database en back-ups

Migratie [`20261113120254_blog_publication.sql`](../supabase/migrations/20261113120254_blog_publication.sql) is vóór de DartFlow-activatie toegepast op productieproject `wlrnowuownakqqgjxnbb`. Featureversie `blog_publication=1` is bevestigd. De acht tabellen staan in `dartflow_private`, met RLS en zonder SELECT-grants voor `anon` of `authenticated`. De beperkte serverrol heeft de bedoelde rechten; revisies, receipts en auditregels blijven voor die rol onveranderlijk.

Vóór de migratie is een consistente back-up van de private applicatieopslag en actieve runtimeconfiguratie gemaakt onder `/var/backups/dartflow/v20-feed-seasons-production-20261113T154411772289Z`. Alle vijf bestandshashes en de volledige decodeerbaarheid van het databasearchief zijn gecontroleerd. Supabase Auth en providerinstellingen vallen buiten deze applicatieback-up.

De normale SocialHero-activatie maakte vóór omschakeling een beschermde SQLite-back-up. De integriteit daarvan en van de actieve database is `ok`; de databaserechten zijn `0600`. De webservice en worker zijn actief. Voor deze uitrol is geen restore-oefening uitgevoerd.

## Productiekoppeling en configuratie

De bestaande SocialHero-werkruimte `socialhero-production` en het bestaande project `brand-dartflow-2` met domein `dartflow.nl` zijn gebruikt. De verbinding is `verified`, site-ID `dartflow`, omgeving `production`, basis-URL `https://dartflow.nl`. De overige projecten zijn behouden.

Defaults: taal `nl-NL`, auteur `redactie`, categorie `toernooien`, portrethero `blog-hero` en breed deelbeeld `share`. De read-only capabilitiescontrole slaagt. De project- en campagnegegevens zijn niet gewijzigd; er zijn geen publicatiejobs of receipts toegevoegd.

Een eigen productiecredential met scopes `read`, `media:write`, `drafts:write`, `publish` is uitgegeven. DartFlow bewaart alleen de verifier; SocialHero bewaart de waarde versleuteld in de projectverbinding. De tijdelijke plaintextfile is verwijderd. De credential verloopt op 13 november 2027 en kan via de bestaande integratie-API worden geroteerd of ingetrokken. Dezelfde productiecredential wordt op staging geweigerd met 401.

Er zijn **geen nieuwe GitHub-secrets of runtimevariabelen** nodig. De bestaande configuratie blijft in gebruik:

- DartFlow: `DARTFLOW_ENV`, `DARTFLOW_APP_ORIGIN`, `DARTFLOW_DATA_MODE`, `DARTFLOW_DATABASE_URL`, migratie-only `DARTFLOW_DATABASE_ADMIN_URL`, `DARTFLOW_MAIL_WORKER_TOKEN`.
- SocialHero: `SOCIALHERO_ENV`, `SOCIALHERO_PUBLIC_URL`, `SOCIALHERO_WORKSPACE_ID`, `SOCIALHERO_DB_PATH`, `SOCIALHERO_MASTER_KEY`.

De API-mapping blijft rechtstreeks `/api/socialhero/v1`: capabilities, media, concept-upsert, status en expliciete revisiepublicatie. Zie [`blog-socialhero.md`](blog-socialhero.md) voor het contract, scopes, revisiecontrole, idempotentie en foutmapping.

## Werkelijke productiecontroles

- DartFlow: 18 onafhankelijke publieke controles en twaalf echte browserweergaven op 1440×900 en 391×844. Geen JavaScriptfouten of horizontale overflow.
- Blog, homepage, login, bestaande app en Oche Live zijn bereikbaar. De blog toont de correcte lege staat; de homepage toont geen lege artikelenrubriek.
- Canonical, robots en sitemap verwijzen naar `https://dartflow.nl`. Vier stagingproefartikelen geven op productie 404.
- Blogbeheer stuurt anonieme bezoekers naar de login. Preview geeft 404 met private/noindex; beheer-API en een aanvraag zonder websitecredential geven 401.
- De geauthenticeerde capabilitiescontrole bevestigt site `dartflow`, omgeving `production` en de bedoelde scopes. Een productiecredential werkt niet op staging.
- SocialHero: twintig read-only releasecontroles op productie en staging slagen; de productieassets horen bij exact `083b0d8`. De versleutelde projectverbinding is geverifieerd en de werkruimte-inhoud bleef ongewijzigd.
- Eindcontrole: beide productieomgevingen zijn gezond en ready. De blogmigratie is actief, er zijn nul productieartikelen en media, en de invalidatie-outbox is leeg.

Er zijn tijdens deze uitrol geen proefartikelen gepubliceerd, AI-aanvragen gedaan of socialberichten verstuurd. Werkelijke uploads, concepten, planning en publicatieretries zijn eerder op staging getest; zie het [stagingverslag](RELEASE-BLOG-2026-11-13.md). Echte socialbezorging blijft afhankelijk van een geconfigureerde kanaalprovider.

Het volledige resultaat zonder geheime waarden staat in [`evidence/blog-production-2026-11-13.json`](evidence/blog-production-2026-11-13.json). Productiescreenshots staan lokaal onder `artifacts/blog-production/`; SocialHero heeft een afzonderlijk productieverslag en bewijsmateriaal onder `artifacts/dartflow-blog-production/`.
