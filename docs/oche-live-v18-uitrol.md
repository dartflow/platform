# Uitrol Oche Live v18 · 12 november 2026

Oche Live v18 staat op staging en productie met bron-SHA **`0503413f96fcf2288f48f5dbacc9bd54ea42e823`**. De release bevat het baanbeheer en de inactiviteitstijdlijn, de nieuwe scorekaart, globaal unieke gebruikersnamen, de gedraaide Cast-weergave en de herstelde installatieknop.

| Omgeving | URL | Actieve release | Configuratie | Uitrol |
| --- | --- | --- | --- | --- |
| Staging | [staging.dartflow.nl](https://staging.dartflow.nl) | `43301855965-1` | `staging-2026-11-11-v15-mail-1` | [Geslaagd](https://github.com/dartflow/platform/actions/runs/43301855965) |
| Productie | [dartflow.nl](https://dartflow.nl) | `43302652040-1` | `production-2026-11-11-v15-mail-1` | [Geslaagd](https://github.com/dartflow/platform/actions/runs/43302652040) |

De bestaande DG Webservices-flow is gevolgd: push naar `main`, verplichte CI voor de exacte SHA, een native build op `dg-nxttrack-01` voor staging en daarna een afzonderlijke native productiebuild van dezelfde SHA. Er zijn geen nieuwe GitHub-secrets of variabelen nodig. Beide omgevingen behouden hun eigen database, configuratie, runtimeaccount, runner en TURN-service.

## Openen en installeren

Ga naar **Locaties & banen** op `/app/locations` en kies **Open Oche Live** bij de betreffende baan. De vaste routes `/baanscherm/<baan-ID>` en `/oche-live/<baan-ID>/` draaien meteen 90° rechtsom, ook in browserfullscreen. De telefoon gebruikt de vaste QR-link `/baan/<baan-ID>`.

Het downloadpictogram in de schermfooter opent **Installeer dit baanscherm**. Een beschikbare native installatieprompt wordt gebruikt; anders volgen beginscherminstructies en de vaste baanlink. In een zelfstandig gestarte PWA blijft deze knop bewust verborgen. Herlaad bestaande browsertabs om de nieuwe versie te laden. Zie de [bedieningshandleiding](oche-live-v18.md) en [installatiehandleiding](installatie-speler-en-baanschermen.md).

De bestaande publieke productievoorbeeldbaan kan worden geopend als [Oche Live · Baan 1](https://dartflow.nl/oche-live/276acb23-c754-4fb8-928c-839048650bfd/) of via de [telefoonroute](https://dartflow.nl/baan/276acb23-c754-4fb8-928c-839048650bfd). Deze baan staat in de bestaande database als locatie van type `venue` met `public_screen=true`; de schermtoegang is bij deze uitrol niet gewijzigd. Spelersrechten blijven afzonderlijk gelden.

## Controles

[CI 43300020895](https://github.com/dartflow/platform/actions/runs/43300020895) is groen: **249** app- en databasetests, **46** prototypetests, **57** deployertests, **45** bootstrap-/Auth-contracttests en **33** browsertests. Typecheck, lint en build zijn geslaagd. De app-testreeks draait voortaan sequentieel, zodat de bestaande gedeelde mailfixtures elkaar niet beïnvloeden.

Na activatie zijn op beide omgevingen echte HTTPS-responses en een Chromium-browser gecontroleerd, zonder fixturedata of schrijfacties:

- Beide vaste baanroutes bouwen op 1920×1080 een logisch vlak van 1080×1920 op. De geroteerde container bereikt alle vier de signaalranden. Echte DOM-fullscreen behoudt dezelfde geometrie.
- De installatieknop is zichtbaar in browserfullscreen. De instructiedialoog en volledige achtergrond blijven binnen de geroteerde schermranden.
- De QR-code heeft een bron van 1024×1024 pixels. jsQR leest de juiste vaste baan-URL op de betreffende omgeving uit de werkelijk gerenderde, gedraaide screenshotpixels.
- Na tijdelijk offline gaan blijft de laatst ontvangen weergave staan met een offline-indicatie. Na herstel haalt de browser de actuele baanstatus opnieuw op.
- Spelers-, scorebord- en baanmanifest hebben verschillende, stabiele installatie-ID’s. De echte anonieme spelersroute op 390×844 gaat naar de inlogpagina met behoud van `/speler` als terugkeerroute; lokale testaccounts worden niet aangeboden.

Alle **acht** publieke en loopback-health/readiness-controles melden HTTP 200, dezelfde bron-SHA en de juiste omgevingsrelease/configuratie. De database is beschikbaar en Supabase Auth is bereikbaar. Appservices, mailtimers, runners en TURN-services zijn actief. Er zijn sinds activatie geen error-prioriteitmeldingen of herkende fouten van de baanworker gevonden. Beide appunits hebben één systemd-waarschuwing bij de servicestart; er is geen nul-waarschuwingenresultaat geclaimd.

De originele Caddy-bestanden zijn exact hersteld en de eigen mailtimers hervat. Milo behield zijn oorspronkelijke release, PID en servicestarttijd. De gedeelde buildlock behield device/inode `29:6` en is na de uitrol vrij.

Bekijk de productiebeelden: [gedraaide QR](evidence/oche-live-v18-production-qr-1920x1080.png) en [installatie-instructies in fullscreen](evidence/oche-live-v18-production-install-1920x1080.png). De volledige gestructureerde controles staan in het [uitrolbewijs](evidence/oche-live-v18-release-2026-11-12.json), het [staging-HTTPS-bewijs](evidence/oche-live-v18-staging-https-2026-11-12.json) en het [productie-HTTPS-bewijs](evidence/oche-live-v18-production-https-2026-11-12.json).

## Migraties en behoud van gegevens

Per omgeving is vóór de migraties de publieke API tijdelijk gepauzeerd, met behoud van health/readiness. Alleen de eigen mailtimer is gestopt en de lopende mailworker is uitgedraaid. Er waren geen fysieke wedstrijdtoewijzingen, geldige trainingsleases of resterende apptransacties. Daarna is een consistente back-up van de 63 door de runtime leesbare private applicatietabellen en de beschermde actieve configuratie gemaakt. Vijf bestandschecksums en een volledige archiefdecodering zijn onafhankelijk gecontroleerd. Supabase Auth/providerconfiguratie en `owner_bootstrap` vallen buiten deze back-up; er is geen herstelproef uitgevoerd.

De migraties `20261112183944_board_activity_sessions.sql` en `20261112184741_globally_unique_usernames.sql` zijn afzonderlijk via het projectgebonden Supabase-beheerpad toegepast. Extra transactionele uitrolcontroles begrenzen de lockwachttijd tot 10 seconden en een statement tot 90 seconden. Zij bewaken dat tijdens de overgang geen actieve fysieke toewijzing wordt overgenomen. De migratieregistraties en hashes van bron-SQL en uitgevoerde SQL staan in het uitrolbewijs. De native releasebroker voert deze beheermigraties niet automatisch uit; gebruik hiervoor op hosted projecten geen lokale `npm run db:migrate`.

Na migratie zijn alle 67 private tabellen door RLS beschermd. De drie nieuwe tabellen hebben alleen de bedoelde runtimeprivileges; `anon`, `authenticated` en `service_role` hebben geen CRUD-toegang. De beperkte purgefunctie is niet publiek uitvoerbaar. De gebruikersnaamindex is uniek en geldig; er zijn geen ongeldige bevestigde namen of dubbele bevestigde claims. Aantallen en hashes van accounts, wedstrijden en worpen zijn gelijk gebleven, met de bedoelde mogelijkheid om alleen naambevestiging te wijzigen. De drie oude stagingtrainingen met reeds verlopen leases zijn volledig behouden en niet door migratie, GET of worker geadopteerd.

De bestaande Supabase-advisories zijn ongewijzigd: de bewust afgesloten bootstrap-tabel heeft [RLS zonder publieke policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), en [beveiliging tegen gelekte wachtwoorden](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) staat uit. Er zijn geen nieuwe beveiligingsadvisories bijgekomen.

## Reikwijdte van het bewijs

De [lokale acceptatie](oche-live-v18-tests.md) en CI controleren scorekaart, beurtverwerking, timergrenzen, gedeelde verlengingen, gelijktijdige acties, vrijgave en unieke gebruikersnamen met geïsoleerde accounts en databases. Er is bij deze uitrol geen nieuwe hosted wedstrijd gespeeld, profiel gewijzigd, scherm gekoppeld, Google-/OTP-login voltooid of mail verzonden. Het openbare wachtscherm, de QR, installatie-instructies en reconnect zijn wel daadwerkelijk op beide actieve omgevingen gecontroleerd.

De gebruiker heeft fysieke installatie-, Chromecast-, Android-/iOS- en stroomuitvalproeven uitgesteld tot de grote testronde. De browsercontroles bewijzen geen OS-installatie of fysieke montage.

Een afzonderlijk vervolg voor bestaande legacydata blijft: expliciete POST-replays, undo of finish van een oude training zonder activiteitssessie kunnen het initialisatiepad bereiken. Volledige hercontrole van alle huidige baanvoorwaarden in die fallback is niet door dit uitrolverslag bewezen. Dit pad is geen automatische migratie-, GET- of workeractie; de oude stagingrecords zijn ongewijzigd gebleven.
