# v17: Oche Live, verenigingen en fysieke locaties

## Bron en omgeving

De implementatie bouwt verder op de bestaande Next.js-app in `/home/codex/repos/dartflow`, branch `codex/staging`, repository `dartflow/platform`. De v17-opdracht autoriseert staging op `https://staging.dartflow.nl`. Productie wordt in deze opdracht niet gemigreerd of gedeployd.

De aangeleverde prototypebron is versie 17, broncommit `8df1441bd3adeea012345e66df1c5ab8ef82426b`. De zip-SHA256 is `29af7c22a14c3ece79b227ccdcac021ee27552e60b45e982d89b181a56e7e222`. Beide bestandsinventarissen zijn volledig met SHA256 gecontroleerd. Het prototype bouwt lokaal en zijn 67 tests slagen. De referentie is `oche-live-604x933.png`; deze staat ook als testfixture in de repository. De prototype-preview op poort 5173 is afzonderlijk van de echte Next.js-app gereproduceerd. Sites-identiteitsheaders, tijdelijke demo-opslag en hostingmanifest zijn niet in de DG-app overgenomen.

De startinventaris van 12 november 2026, 01:07 UTC, toont stagingbron `e0ce637d1302a8254bf5461200cc71889d93cd08`, release `43113116356-1`. Productie draait dan `aa7ac5e49de184fa4eb5ec1a83318c44e1b5d0d6`, release `43102459247-1`. Staging heeft 3 profielen, 2 clubs, 1 wedstrijd en 8 worpen. Deze bestaande gegevens en vaste baan-ID's worden behouden. Het definitieve releasebewijs staat afzonderlijk in `docs/evidence/`.

## Werkelijke implementatie

| Onderdeel | Opslag en autorisatie |
| --- | --- |
| Identiteit | Bestaande Supabase OTP/Google, profielbevestiging, veilige terugkeerroute en serveractor blijven leidend. Geen demo-identiteiten op staging/productie. |
| Verenigingen | Eén eigenaar, eigenaarbeheer van rollen, meerdere aangepaste roltoekenningen, actuele grants, versiegebonden intakevragen en onveranderlijke antwoordsnapshots. Besluiten en ontvangstbewijzen worden atomair verwerkt. |
| Levenscyclus en merk | Inactief/herstel binnen 30 dagen, daarna definitieve logische sluiting; historie blijft bewaard. Logo wordt begrensd, echt gedecodeerd en zonder metadata als WebP opgeslagen. Kleuren worden gevalideerd en tekstcontrast wordt gekozen. |
| Fysieke banen | Zelfstandige thuis-/locatiebeheerrechten en delegeerbaar locatiebeheer. Een clubrol geeft geen fysiek beheer. Bestaande baanmakers krijgen expliciete fysieke eigendom zonder hun QR of scherm-ID te wijzigen. |
| Reserveringen | UTC-vensters, halfopen overlapcontrole, expliciet toegewezen locatiebanen, huidig organisatierecht en unieke wedstrijdcapaciteit. Bestaande toernooifixtures gebruiken dezelfde fysieke baan; begonnen partijen mogen uitlopen. |
| Feeds | My Feed en afzonderlijke platform-, club-, competitie- en toernooifeeds. Berichten, account-unieke likes, threads en stabiele tijd/ID-paginering staan in Postgres. Iedere lees-/schrijfactie toetst de huidige scope. |
| Chat | Club-, evenement- en thuis/hybride wedstrijdchat, minimaliseerbaar met bewaard concept. Polling hercontroleert rechten; scoped moderatie, stilte, blokkeren en verwijdertombstones. Een scopelock bewaakt de commitvolgorde van cursors. Bestaande online wedstrijdchat wordt behouden. |
| Oche Live | Originele logo's, fonts, kleurverdeling en echte QR. Per baan blijft het geïnstalleerde manifest-ID/startadres bestaan. `/oche-live/<UUID>` is een alias. Alleen-lezen apparaattoegang, netwerkherstel en scherm wakker houden blijven behouden. |
| Scoreconsole | De bestaande schermvullende console blijft voor solo, lokaal, thuis en hybride. Serverbeurt, bevoegdheid, verwachte revisie en actie-ID bepalen elke mutatie. Audio/camera blijven actief wanneer de console open is. |
| Scorecues | Alleen bevestigde servergebeurtenissen geven 180/hoge-finish-cues. Initiële snapshots, herhaling, reconnect en undo spelen geen oude cue opnieuw. De vaste baan ontvangt ook de laatste solo-finish nadat de baan is vrijgegeven. |
| Mail | Twee nieuwe catalogusitems naast de bestaande 32. Ontvangst, actuele reviewers, gerichte uitnodiging en besluit worden in dezelfde transactie in de outbox gezet. Geen intake-antwoorden in mail. Reviewers worden bij verzending opnieuw gecontroleerd. |

De drie additieve migraties staan onder `supabase/migrations/` met omschrijvingen `v17_club_roles_intake_lifecycle`, `v17_community_score_events` en `physical_locations_reservations`. Alle nieuwe tabellen staan in `dartflow_private`, hebben RLS en zijn niet rechtstreeks aan publieke Supabase-API-rollen verleend. De beperkte runtime krijgt de noodzakelijke rechten; nieuwe gebeurtenissen, intakeversies en antwoordsnapshots blijven beschermd. Het kernschema blijft versie 1; afzonderlijke featuremarkers bepalen v17-readiness.

Verenigingsdossiers, rollen, aanvragen, locaties, reserveringen, berichten, likes, chat en scores zijn aan de backend gekoppeld. Alleen niet-gezaghebbende bediening blijft op het toestel: een chatconcept, installatie-instructies en de expliciet gekozen baan van de Scorebord-terugvalapp. De vaste baanroute bepaalt altijd zelf zijn manifest en toegang. Clubmailbeheer gebruikt actuele `settings.edit`-rechten; de expliciete platformeigenaar behoudt zijn bestaande beheertoegang. De vaste spelers-QR gebruikt dezelfde actuele organisatierechten als reserveringsacties.

## Testgrenzen en acceptatie

De automatische browserproeven gebruiken gescheiden lokale browsersessies met de bestaande fixtureaccounts: organisator, speler 1, speler 2 en speler uit een andere club. Dit zijn geautomatiseerde sessies op de dev-VPS, geen echte telefoons of Google-/OTP-providerproeven. De release-CI voert dezelfde bron opnieuw uit met de gepinde toolchain en Chromium.

| Acceptatiegroep | Uitgevoerde automatische dekking | Afzonderlijke handmatige controle |
| --- | --- | --- |
| AUTH-01–07 | Bestaande Auth-, redirect-, profielnaam- en rechtenregressies; lokale loginintentie, terugkeer en onafhankelijke privileges. | Volledige nieuwe OTP/Google-login op de uiteindelijke release is geen uitkomst van fixture-authenticatie. |
| CL-01–08 | Intakevelden/versies, privacy, gerichte uitnodigingen, actuele grants, capaciteit, twee beoordelaars, eigendom, inactiviteit en serverklokgrens; aanvullende echte formulierproef. | Eigenaar kan de ingerichte stagingclub met eigen accounts nalopen. |
| MAIL-01–02 | Encryptie, templates, afzender-/ontvangergrenzen, outbox-deduplicatie, retries, webhookverificatie en intrekking van reviewerrechten. | Supabase SMTP en app-Resend zijn aparte verbindingen. Echte bezorging vraagt een opgeslagen app-API-sleutel en een toegelaten testontvanger. |
| SOC-01–06 | Onafhankelijke scopes, deelname, gelijke timestamps, account-unieke likes, threads, chat, intrekking, blokken/stilte, cursor-commitvolgorde, tombstones en vertraagde browserantwoorden. | Twee echte telefoons/netwerken zijn niet door browsercontexten bewezen. |
| BOARD-01–05 | Vaste manifestidentiteiten, QR-routes, alleen-lezen toegang, koppelen/intrekken, onafhankelijke locaties, overlap/aangrenzende vensters, capaciteit en bestaande fixture-toewijzing. | OS-installatie, herstart en daadwerkelijke QR-scan blijven apparaatafhankelijk. |
| BOARD-06–10 | Lokale schrijverovername, thuis/hybride eigen beurt, 4-tekenuitnodigingen, camera-trackwissel met twee browserpeers, score-idempotentie, finish, undo, reconnect en eenmaal per serverevent getoonde cues. | Camera's en videorelay op echte apparaten/netwerken vallen in de uitgestelde grote testronde. |
| BOARD-11 | Werkelijke 604×933-render met geometrie-/pixelcontrole; daarnaast 360/390/430/540 portret en landschap, veilige schermranden en bereikbare bevestiging. | Browsermetingen bewijzen geen fysieke displaykalibratie. |
| REL-01–03 | Lokale tests/build, upgrade- en hostcontractproeven; vervolgens exacte SHA-CI, stagingback-up, migraties, native deploy en HTTPS/loopback-identiteit. | Definitieve uitvoer en SHA worden in het releasebewijs ingevuld. |
| REL-04–05 | Bestaand native rollbackcontract en achterwaartse schemacompatibiliteit worden automatisch gecontroleerd. | Geen echte pilotvideo op fysieke apparaten of nieuwe operationele app-/databaseherstelproef geclaimd. |

De eigenaar heeft op 12 november expliciet de fysieke apparaat-, installatie- en stroomherstartproeven uitgesteld tot de grote testronde. Deze worden niet als geslaagd gemeld en blokkeren deze oplevering niet.

De eerste volledige v17-ronde vond en corrigeerde onder meer een verdwenen verenigingscode, een verouderde mailcatalogusassertie, een overzichtsrace bij actuele clubtoegang en cursor-/browserresponseraces. De uiteindelijke aantallen en eventuele herhaalde browsergevallen staan bij het releasebewijs; eerdere mislukte pogingen gelden niet als eindresultaat.

## Geverifieerde stagingrelease

Staging is op **12 november 2026 om 02:58 CET** geactiveerd met bron-SHA **`c93903fbc3d0f822a52130f6a4331acb8b475fb9`**, release **`43137840623-1`** en configuratie **`staging-2026-11-11-v15-mail-1`**. [CI op deze SHA](https://github.com/dartflow/platform/actions/runs/43136969056) en [de native stagingdeployment](https://github.com/dartflow/platform/actions/runs/43137840623) zijn geslaagd.

CI bevestigt **206 app-/databasetests, 24 browserproeven, 46 bestaande prototypetests, 57 native-deployertests en 45 host-/Auth-contracttests**. Typecheck, lint en build zijn groen. De afzonderlijk aangeleverde v17-prototypebron heeft lokaal 67 geslaagde tests en een geslaagde build. De eerste lokale volledige browserpoging had vijf fouten; gerichte herhalingen en daarna de volledige CI-ronde op de definitieve SHA zijn groen. De nieuwe rechtenregressies toetsen ook clubmailbeheer en aangepaste organisatierollen op de vaste QR.

De echte 604×933-render heeft een podium van `(18, 0, 532, 933)`. De pixelvergelijking meet **3,70% afwijkende pixels** boven kanaaldrempel 32 en **3,15/255 gemiddelde kanaalafwijking**, binnen de vastgelegde grenzen. Alleen de dynamische QR en de aangepaste footerbediening zijn gemaskeerd. Zie [de echte capture](evidence/v17-oche-live-604x933-actual.png) en [de metingen](evidence/v17-oche-live-604x933-measurements.json). Dit is een lokale dataprojectie op de echte Next-productiebouw; geen fysieke of hosted spelproef.

Vóór de migraties is op de doel-VPS een consistente stagingback-up gemaakt van de 46 voor de runtime leesbare applicatietabellen en de beschermde actieve configuratie. Alle vijf bestandshashes en het volledige archief zijn onafhankelijk gecontroleerd; er is geen restore uitgevoerd. De drie hosted migraties staan geregistreerd als `20261112015520`, `20261112015524` en `20261112015527`. Alle 64 private tabellen hebben RLS, zonder publieke tabelgrants. Aantallen én hashes van de 3 bestaande profielen, 1 wedstrijd en 8 worpen zijn ongewijzigd. Er zijn geen nieuwe security-advisors bijgekomen; de bestaande meldingen over [owner_bootstrap zonder publiek beleid](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) en [wachtwoordlekcontrole](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) zijn onveranderd.

Na deployment geven `/api/health` en `/api/ready` zowel via HTTPS als via VPS-loopback HTTP 200 met dezelfde bron-, release- en configuratie-identiteit. De hosted browsercontrole omvat 12 controles op 390 en 540 pixels: vier onafhankelijke manifestidentiteiten, openbare vaste QR, afgeschermde schermtoegang, offline/online-herstel, de Oche Live-alias, lokale Scorebord-koppeling en de echte spelersloginpagina zonder fixtureaccounts. Er is geen hosted wedstrijd gespeeld en er zijn geen accounts, koppelcodes of scores voor de controle aangemaakt. De bestaande openbare baan was vrij.

De actieve app staat op `/srv/sites/dartflow-staging/current`, dat verwijst naar `releases/c93903fbc3d0-43137840623-1`. De configuratie staat onder `/etc/dg-sites/dartflow-staging/configs/staging-2026-11-11-v15-mail-1/`. De secrets blijven op hun beschermde bestemming. Productie behoudt bron `aa7ac5e49de184fa4eb5ec1a83318c44e1b5d0d6`, release `43102459247-1` en hetzelfde proces. Ook Milo en buildlock `29:6` zijn ongewijzigd.

Het [volledige geanonimiseerde releasebewijs](evidence/v17-staging-2026-11-12.json) en [de hosted browsercontrole](evidence/v17-staging-public-smoke-2026-11-12.json) leggen de controles en grenzen vast.

**Nog te configureren:** in DartFlow zelf zijn bij de laatste stagingcontrole nul Resend-appcredentials opgeslagen. Voeg de Resend HTTP API-sleutel toe onder [Platformbeheer → Integraties](https://staging.dartflow.nl/app/platform/integraties), met afzender `noreply@dartflow.nl` en de toegelaten testontvanger `info@dgwebservices.nl`. Supabase Auth SMTP blijft een afzonderlijke verbinding. Echte appmailaflevering en nieuwe providerlogins zijn niet als geslaagd afgevinkt. De fysieke apparaatproeven blijven op verzoek van de eigenaar voor de grote testronde.

## Starten en bedienen

```sh
cd /home/codex/repos/dartflow
npm ci
npm run db:start
npm run db:migrate
npm run db:seed
npm run dev
```

De developmentmodus en testaccounts worden uitsluitend op loopback toegelaten. `npm run db:reset` is alleen voor de afgeschermde lokale fixtureomgeving; voer dit niet tegen een hosted project uit.

Begin voor wedstrijdleiding met [de installatiehandleiding](installatie-speler-en-baanschermen.md), [verenigingsbeheer](v17-clubs.md) en [locaties/reserveringen](v17-locaties.md). Nieuwe hoofdroutes zijn `/app/feed`, `/app/locations` en `/app/reservations`. Gebruik bij een nieuwe baan zijn vaste spelers-QR en afzonderlijke Oche Live-schermlink.

Er zijn voor v17 geen nieuwe GitHub-secrets of omgevingsvariabelen nodig. De bestaande immutable stagingbundel blijft `staging-2026-11-11-v15-mail-1`. Resend-appcredentials worden via het bestaande write-only beheer in DartFlow versleuteld opgeslagen; plaats ze niet in Git of de chat. De gecontroleerde echte testontvanger blijft `info@dgwebservices.nl`, met afzender `noreply@dartflow.nl` en Reply-To `support@dartflow.nl`.

## Release en herstel

Volg [de bestaande DG-releaseprocedure](deployment.md): commit exact vastleggen, groene CI voor dezelfde SHA, geverifieerde stagingback-up, afzonderlijk gereviewde incrementele migraties en `deploy-staging.yml` met die SHA/config-ID. De hostbrede buildlock en andere applicaties blijven buiten wijzigingsscope.

Een procesrollback naar de voorgaande stagingrelease houdt de nieuwe tabellen en gegevens intact. De nieuwe UI-functionaliteit is dan niet beschikbaar. De back-up bevat de door de runtime leesbare private applicatiegegevens en de beschermde configuratie, maar geen Supabase Auth-gebruikers/sessies of externe providerconfiguratie. Een archiefindex/hashcontrole is geen uitgevoerde databaseherstelproef. Herstel geen database over nieuwe scores of verzonden mail heen zonder reconciliatie en expliciete herstelbeslissing. Productie is een afzonderlijke opdracht.
