# v19 · validatie en uitrol

Bronrelease: `f37fb877a1a26102a48eb699729839718dcc5ead`.

Implementatie en bediening staan in [de spelershandleiding](v19-spelersprofiel-statistieken.md); runtimevariabelen en de gerichte hostupgrade staan in [het PIN-runbook](../infra/V19-PIN.md). Er zijn geen extra GitHub-secrets of GitHub-variabelen voor deze wijziging nodig. De peppers horen uitsluitend in de beschermde runtimebundels op de doel-VPS.

## Lokale validatie

- 304 applicatie- en databasetests: geslaagd, niets overgeslagen.
- 46 prototypetests en 64 native deployertests: geslaagd.
- Bootstrap-, runtime-, hostupgrade-, TURN- en Auth-redirectcontracten: geslaagd zonder hostmutaties.
- Typecheck, lint en productiebuild: geslaagd.
- Alle 44 unieke browserscenario's op de definitieve appbuild gevalideerd. De laatste volledige lokale run had 41 geslaagde scenario's en drie fouten in testwachten/selectoren. Na herstel slaagden alle vijf scenario's van de twee betrokken bestanden. De applicatiecode veranderde daarbij niet. CI heeft daarna alle 44 definitieve scenario's als één volledige suite succesvol uitgevoerd.

Alle functionele verificatie gebruikt uitsluitend lokale, synthetische accounts en UUID-afgebakende ontwikkeldata. De echte lokale tweebrowserflow rondt profielopslag met voorloopnul af en speelt thuis, hybride en lokaal. De PIN-databasetest koppelt twee profielen met één schrijver, speelt uit en controleert exact één uitslag voor beide profielen. Transportfixtures controleren de Google-/e-mail-UI en PIN-reset; echte providers of verificatiemails zijn daarvoor niet bediend.

| Onderdeel | Bewijs |
| --- | --- |
| Profiel/PIN | Verplichte velden, ASCII-cijfers, voorloopnul, mismatch, bezette canonieke naam, rollback/retry, wijzigen/reset, oude PIN ongeldig, legacy-account blijft speelbaar. |
| Eén telefoon | Actuele fysieke lobby, generieke fout, persistente afkoeling, KDF-budget, gelijktijdige tweede plek versus zelf scannen, PIN-versiecontrole, scoped schrijver en één gedeelde uitslag. |
| Statistieken | Gewogen 100,20/66,80 AVG, verloren legs, nul/bust, checkoutdarts, ontbrekende dubbelpogingen, laatste-50-dekking, 301/501 apart, topfinishes, First 9, opponent-ID's, officiële klassering en afzonderlijke oefeningen. |
| Oche Live | 1080×1920, 720×1280 en liggend 1920×1080 met 90°-rotatie; vijf stabiele scorekaartrijen, vaste historische AVG, live AVG/180, privacy intrekken, undo/reconnect/legwissel/animaties en recap. Screenshots visueel gecontroleerd. |
| Telefoon/PWA | 390×844 en 360×640 scoreconsole; beurtrechten, lokale schrijverovername, vaste QR, afzonderlijke manifests, installeren/fullscreen, offlineherstel en intrekbare schermkoppeling. |
| Bestaand wedstrijdpad | Check-in, reservering/toewijzing, schrijver, bevestigde uitslag, inactiviteit, vrijgeven en officiële onderbreking blijven afgedekt. |

Lokale bewijsbestanden staan in de genegeerde `.local/v19-*.log` en `.local/v19-oche-*.png`. Ze bevatten geen hosted testaccounts of gepubliceerde PIN-geheimen.

## Hosted release

Uitgerold op 12 november 2026 via de bestaande handmatige exact-SHA-releaseflow. [CI 43312209166](https://github.com/dartflow/platform/actions/runs/43312209166) is volledig geslaagd: 304 applicatietests, 46 prototypetests, 64 deployertests, de bootstrapcontracten, typecheck, lint, build en 44 browsertests. De drie migraties zijn ook op de verse CI-database uitgevoerd.

| Omgeving | Actieve release | Configuratie | Native workflow |
| --- | --- | --- | --- |
| [Staging](https://staging.dartflow.nl) | `43313841460-1` | `staging-2026-11-12-v19-pin-1` | [Geslaagd](https://github.com/dartflow/platform/actions/runs/43313841460) |
| [Productie](https://dartflow.nl) | `43314509638-1` | `production-2026-11-12-v19-pin-1` | [Geslaagd](https://github.com/dartflow/platform/actions/runs/43314509638) |

Beide omgevingen rapporteren bron-SHA `f37fb877a1a26102a48eb699729839718dcc5ead`, dezelfde verwachte build-/runtimeconfiguratie, gezonde database en bereikbare Supabase Auth. De publieke én loopback health/readiness-controles zijn alle acht geslaagd. Apps, mailtimers, mailworkers, TURN en runners zijn gezond; de appjournals bevatten geen foutmeldingen of fouten van de verlopen-sessieworker. Caddy is via reload beheerd en de oorspronkelijke configuratiebytes zijn hersteld. Milo behield zijn proces, release en broker. De gedeelde lock blijft inode `29:6`, mode `0660`, en is vrij.

De echte anonieme HTTPS-smokecontrole slaagt op beide domeinen: drie manifests, beide vaste schermaliassen, logische 1080×1920-inhoud in het 1920×1080-signaal, 90°-rotatie, softwarematig gedecodeerde QR, DOM-fullscreen, zichtbare installatiebediening en instructies, offline-indicatie en herstel met actuele baandata. De loginpagina toont de echte providers en geen lokale demoaccounts. Profiel en statistiek-API weigeren anonieme toegang; de sessieprojectie bevat geen gebruiker. Er zijn geen accounts, scorebeurten, PIN-koppelingen, apparaatkoppelingen of mails aangemaakt. De controles op productie gebruikten de reeds bestaande openbare baan.

Direct openen na eigen login:

- [Profielinstellingen en spelerspincode](https://dartflow.nl/app/settings).
- [Wedstrijdstatistieken](https://dartflow.nl/app/statistics?view=matches), [tegenstanders](https://dartflow.nl/app/statistics?view=opponents), [toernooien](https://dartflow.nl/app/statistics?view=tournaments) en [oefenen](https://dartflow.nl/app/statistics?view=practice).
- [Bestaande productie-baan/QR-spelersflow](https://dartflow.nl/baan/276acb23-c754-4fb8-928c-839048650bfd) en [Oche Live](https://dartflow.nl/oche-live/276acb23-c754-4fb8-928c-839048650bfd/).
- [Bestaande staging-baan](https://staging.dartflow.nl/baan/6fd6090a-111f-4bf4-89ef-1db4ab84a7f3) en [staging Oche Live](https://staging.dartflow.nl/oche-live/6fd6090a-111f-4bf4-89ef-1db4ab84a7f3/).

### Database en geheimen

Alle drie featuremarkers zijn op beide projecten `1`. De vijf nieuwe private tabellen hebben RLS; `anon`, `authenticated` en `service_role` hebben geen SELECT op de PIN-verifiers. De labelview gebruikt `security_invoker=true`, de runtime heeft de vereiste onboardinggrants en de unieke gebruikersnaamindex is geldig. De bestaande profielen zijn als legacy behouden; er is geen PIN voor hen gegenereerd. Historische openbare statistieken staan standaard uit.

De bestaande profiel-ID's en oorspronkelijke profielvelden, wedstrijden, beurten en trainingspayloads zijn via tellingen en hashes vóór/na gelijk bevonden. Staging behield drie profielen, één wedstrijd, acht beurten en de drie bestaande trainingsrecords met verlopen baanleases. Productie behield één profiel en geen wedstrijden/beurten. Er waren vóór de overgang geen actieve fysieke baansessies.

| Migratie | Stagingversie in hosted historie | Productieversie in hosted historie |
| --- | --- | --- |
| `player_pin_participation` | `20261112214801` | `20261112215222` |
| `player_statistics_kickoffs` | `20261112214818` | `20261112215224` |
| `player_profile_identity` | `20261112214820` | `20261112215227` |

Bij staging botste eenmaal de registratie van twee migraties die de Supabase-tool binnen dezelfde seconde nummerde. De statistiek-DDL was al gecommit; dezelfde idempotente migratie is daarna veilig opnieuw toegepast en correct geregistreerd. De drie historievermeldingen en schemaresultaten zijn afzonderlijk gecontroleerd. Productie gebruikte tussenpozen en had deze botsing niet.

Iedere omgeving heeft een eigen op de doelhost gegenereerde 256-bit pepper, versie `v1`, uitsluitend in de nieuwe root-beschermde runtimebundel. De bestaande publieke configuratie en oorspronkelijke runtimevelden zijn exact behouden. De rootupgrade wijzigde uitsluitend eigen helpers/hashpins en configallowlists; de apps zijn pas via hun native workflow geactiveerd. Benodigde namen, KDF-defaults en limieten staan in [infra/V19-PIN.md](../infra/V19-PIN.md); waarden zijn nergens gepubliceerd.

Supabase Security Advisors zijn na de DDL op beide projecten gecontroleerd. Er zijn geen nieuwe bevindingen; de bestaande private bootstrapmelding en uitgeschakelde gelekte-wachtwoordcontrole blijven gelijk. De verwijzingen zijn [RLS zonder policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) en [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

### Private back-ups en bewijs

Vóór iedere migratie is een consistente private applicatieback-up gemaakt en onafhankelijk op checksums en volledige archiefdecode gecontroleerd. Na activatie zijn opnieuw back-ups gemaakt met de juiste nieuwe runtimebundel, inclusief de private pepper. Directories zijn root-only `0700`, bestanden `0600`. Deze back-ups omvatten de voor de runtime leesbare private applicatieschema/data en runtimeconfiguratie; Supabase Auth, providerinstellingen en de ontoegankelijke private bootstrap zijn uitgesloten. Er is geen nieuwe database-restoreproef uitgevoerd.

- Staging vóór migratie: `/var/backups/dartflow/v19-oche-live-staging-20261112T214749351227Z`.
- Productie vóór migratie: `/var/backups/dartflow/v19-oche-live-production-20261112T215159923130Z`.
- Staging actieve runtime: `/var/backups/dartflow/v19-oche-live-staging-20261112T215630695087Z`.
- Productie actieve runtime: `/var/backups/dartflow/v19-oche-live-production-20261112T215637890930Z`.
- Vorige native controlbestanden: `/var/backups/dartflow/v19-pin-host-20261112T214739881294Z`.

Lokale veilige bewijzen: `.local/v19-ci.log`, `.local/v19-*-deployment.log`, `.local/v19-*-public-smoke.json`, `.local/v19-final-host-check.json`, de onderhoudsherstelbewijzen en back-upverificaties. Geen secretwaarden of ruwe journals zijn in dit verslag opgenomen.

## Grenzen van de validatie

Native installatie en herstart op echte Android-/iOS-/tv-apparaten, fysieke QR-scans en de gemonteerde Chromecast zijn niet bediend. Ook een echte Google-/OTP-login en PIN-reset met de eigenaaraccount vallen buiten deze lokale tests. Softwarematige browsermetingen bewijzen wel de routes, logische schermmaten en rotatie.

Het bestaande bevoegde correctiepad vóór publicatie is getest, inclusief herverwerking zonder dubbele telling. Een algemene wijziging van reeds gepubliceerde definitieve uitslagen is geen bestaande ondersteunde route; daarvoor is geen alternatieve schrijfmogelijkheid toegevoegd.
