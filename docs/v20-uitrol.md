# v20 · oplevering, validatie en uitrol

De geaccepteerde applicatiebron is `337a59158ac1a55c46a0953b3d50b29aab6b9538`. [CI-run 43365811911](https://github.com/dartflow/platform/actions/runs/43365811911) is op 13 november 2026 succesvol afgerond: 347 applicatie-/DB-tests en alle 61 browserscenario's slagen. De gerichte Feed-/chatcontrole slaagt daarnaast afzonderlijk met vijf scenario's.

Staging én productie draaien via de native releaseflow op deze bron. De alleen-lezen HTTPS-controles, definitieve hostcontrole en databehoudscontrole slagen voor beide omgevingen. Dit verslag scheidt de lokale/CI-verificatie van de hosted controles; de release- en back-upbewijzen staan onderaan. Bediening, routes, rollen en configuratie staan in [de v20-handleiding](v20-feed-en-competities.md).

## Geïmplementeerde scope

| Onderdeel | Opgeleverd gedrag |
| --- | --- |
| My Feed en Ontdekken | Chronologische tijdlijn met paginering, kanaalfilters, volgen zonder inschrijving, maximaal twee persoonlijke vervolgacties, kanaalvoorkeuren, berichten, likes, reacties en tijdelijk vastzetten. Het publiek staat vóór verzenden in beeld. |
| Uitslag delen en revanche | Deelvoorvertoning, servermatig opgeloste intrekbare deel-ID's en controle van actuele bronrechten bij ieder openen. Correcties gebruiken dezelfde bronidentiteit. Revanche maakt een nieuwe vrije partij met dezelfde ondersteunde instellingen. |
| Bestaande community | Dezelfde bericht-, like- en reactie-identiteiten blijven bruikbaar in bestaande verenigingsweergaven. Clubchat blijft beschikbaar; openbare competitie-updates geven geen toegang tot de bestaande besloten deelnemerschat of oudere privéberichten. |
| Vandaag en persoonlijke speeldag | Eigen vervolgactie, programma, check-in en beschikbaarheid volgen de actuele wedstrijd- en baanrechten. Favoriete banen en laatst gebruikte instellingen blijven persoonlijk bewaard. |
| Gerichte training en schermbeheer | First 9-/checkoutoefeningen, voortgang binnen dezelfde oefenvorm, beheer van bestaande schermkoppelingen, heartbeat en baangebonden rotatie. |
| Interne competitie | Seizoen met vaste speelblokken of flexibele rondevensters, inschrijving, divisies, programma, conflicten, publicatie/rondevrijgave, check-in, baan/schrijver, uitslagen, stand, statistieken, kalender/export en bevoegd beheer. |
| Landelijke pilot | Vier singles per ontmoeting; selectie, captain/vervanger, afgeschermde opstelling tot onthulling, toegewezen officiële PIN-check-in, teambevestiging, dispuut en bevoegde correctie. Een voorlopige single wordt geen definitieve teamuitslag of openbare historie. |
| Bestaande score- en schermlogica | De normale partij, scorekaart, vaste QR, beurt/schrijver en Oche Live delen dezelfde wedstrijdidentiteit. Voorlopige of onderbroken officiële bronnen worden gescheiden van definitieve uitslagen en statistieken. |

Nieuwe opslag staat in `dartflow_private`. Profiel-, baan-, evenement- en wedstrijd-ID's blijven behouden. Resultaatprojecties zijn idempotent per bron en revisie. De technische bronmapping staat in [Technische aansluiting](v20-feed-en-competities.md#technische-aansluiting).

## Definitieve verificatie

Alle onderstaande CI-controles horen bij exact dezelfde bron-SHA. De applicatie- en databasetests zijn zonder overgeslagen DB-scenario's uitgevoerd tegen de geïsoleerde lokale PostgreSQL-database van de runner; hosted spelers- of wedstrijdgegevens zijn niet als testfixture gebruikt.

| Controle | Definitieve uitkomst | Bewijs |
| --- | --- | --- |
| Typecheck | Geslaagd. | CI: `npm run typecheck`. |
| Lint | Geslaagd, geen toegestane waarschuwingen. | CI: `npm run lint`. |
| Applicatie en database | **347 geslaagd, 0 fouten, 0 overgeslagen.** | CI: `npm test`; lokale herhaling: `.local/v20-full-unit-final-lock.log`. |
| Bestaande prototypetests | **46 geslaagd, 0 fouten, 0 overgeslagen.** | CI: `npm run test:prototype`. |
| Native deployercontracten | **64 geslaagd.** | CI: `npm run test:deploy`. |
| Aanvullende infrastructuur- en redirectcontracten | **45 geslaagd**: 8 runner-, 6 cleanup-, 5 runtime-, 10 hostupgrade-, 8 TURN- en 8 Auth-redirectchecks. | CI: de twee aanvullende Python-stappen. |
| Productiebuild | Geslaagd, inclusief standalone-server en publieke assets. | CI: `npm run build`. |
| Gerichte Feed-/chatbrowsers | **5 geslaagd** in 36,2 seconden. | CI: `playwright test tests/e2e/community-v17.spec.ts`. |
| Volledige browsersuite | **61 geslaagd** in 5,8 minuten. | CI: `npm run test:e2e`. De vijf gerichte scenario's zitten ook in deze 61 en zijn geen vijf extra unieke acceptatiegevallen. |
| Kandidaat verpakken | Geslaagd; bronidentiteit gecontroleerd, manifest en checksum aanwezig. | CI-artifact hieronder. |

Het volledige log is lokaal bewaard als `.local/v20-ci-release.log`. Het [CI-artifact](https://github.com/dartflow/platform/actions/runs/43365811911/artifacts/14011420156) heet `ci-337a59158ac1a55c46a0953b3d50b29aab6b9538` en bevat:

- `dartflow-337a59158ac1a55c46a0953b3d50b29aab6b9538-43365811911.tgz`;
- de bijbehorende `.tgz.sha256`;
- `release-manifest.json`, met deze bron-SHA, `sourceVerified=true`, CI-run en `dataMode=local`.

Dit lokale CI-artifact is de ontwikkelpreview. De bestaande native releaseflow bouwt voor iedere hosted omgeving de kandidaat met de eigen openbare buildconfiguratie en bijpassende beschermde runtimeconfiguratie. Het lokale artifact wordt niet als Supabase-productierelease geactiveerd.

Een eerdere lokale alles-in-één browsersessie is wegens resourcegebrek onderbroken. Eerdere CI-kandidaten vonden bovendien een echte mobiele Feed-overlap en verloren bestaande chattoegang. De definitieve kandidaat herstelt deze regressies: de Feed-chatlauncher staat in de normale paginaflow, de geopende sheet blijft een overlay en de replybediening houdt ruimte boven de vaste navigatie. Alle betrokken oude scenario's zijn behouden; de definitieve groene CI vervangt de eerdere onvolledige acceptatie.

## Wat de tests aantonen

| Onderdeel | Gecontroleerd |
| --- | --- |
| Feed en bronprivacy | Volgen zonder inschrijving, huidige rollen en lidmaatschappen, privé-eventberichten tegenover een openbare volger, intrekking, broncorrecties, expliciete openbare deelkaart en een nieuwe revanche-identiteit. Likes/reacties en retries behouden dezelfde bronidentiteit. |
| Asynchrone chat en reacties | Drie echte lokale browsersessies delen clubberichten, likes, reacties en chat. Offline herstel, bewaard concept, minimaliseren, vertrek uit de club, alleen-lezen chat, vertraagde antwoorden na intrekking en wisselen tussen threads zijn gecontroleerd. |
| Mobiele overlap | Op 390×844 en 360×640 blijft Reageren bij de laatste kaart boven de ondernavigatie en zichtbare viewportrand. De hit-test raakt de knop en een gewone klik slaagt, ook na chatminimalisatie en maximale documentscroll. Geen geforceerde klik wordt gebruikt. |
| Seizoenen en transacties | Clubgebonden rollen, selectie/opstelling, één officiële partij-ID, versiecontrole, retry, conflicten, PIN-check-in, bevestiging, dispuut, correctie en herberekening. Het nationale rekenvoorbeeld eindigt op 2–2 in partijen en 9–8 in legs. Een afzonderlijke regressie controleert gelijktijdige Feed-projectie en seizoensopslag. |
| Definitieve projecties | Voorlopige nationale singles blijven buiten gepubliceerde uitslagen, persoonlijke historie en algemene standen. Bevoegde correcties laten bestaande projecties convergeren zonder een tweede uitslag. |
| Spelerservaring | Planning, check-in, pauze/beschikbaarheid, eigen baanvoorkeuren, vergelijkbare trainingsdoelen, schermkoppeling/rotatie en veilig hervatten na een verloren antwoord. |
| Bestaande speelomgeving | Solo, lokaal, thuis en hybride, eigen beurt versus gedeelde schrijver, vaste QR, scoreconsole, profiel-/PIN-flows, camera-trackwissel, toernooi-/baanbediening, Oche Live, schermprivacy, PWA-identiteit en intrekbare schermtoegang. |
| Viewports | Nieuwe Feed-/competitieschermen op 1440×900 en 390×844, extra Feed-bediening op 360×640; bestaande Oche-tests op 1080×1920, 720×1280 en 1920×1080 en smalle mobiele score-invoer. |

De volledige suite bevat zowel echte lokale sessie-/databaseflows als expliciete browsertransportfixtures. Een gemockte provider- of seizoenrespons bewijst de UI en haar verzoeken, niet een echte Google-/SMTP-provider of fysiek schermapparaat.

## Visuele vergelijking en grenzen

De v20-weergaven zijn vergeleken met de overdracht. Acht lokale screenshots van de eerste UI-controle staan in `.local/v20-ui-*.png`; het bijbehorende rapport staat in `.local/v20-ui-report/index.html`:

| Beeld | Dataset en rol | Vastgelegde beelden |
| --- | --- | --- |
| My Feed | Synthetische Danny/Rick-, club-, kanaal- en uitslagfixture. | `v20-ui-my-feed-1440.png`, `v20-ui-my-feed-390.png`. |
| Competitie-index | Interne vaste/flexcompetitie, landelijke pilot en niet-startbaar Champions-concept; beheerrol. | `v20-ui-competitions-1440.png`, `v20-ui-competitions-390.png`. |
| Landelijk overzicht | Synthetische Rick/Mike- en teamfixture; bevoegd overzicht. | `v20-ui-national-overview-1440.png`, `v20-ui-national-overview-390.png`. |
| Aanmaken en opstellen | Mobiele seizoenswizard en eigen vier-slotopstelling als captain. | `v20-ui-season-wizard-mobile.png`, `v20-ui-captain-lineup.png`. |

Deze screenshots zijn tijdens de eerdere UI-controle gemaakt, vóór de laatste chatplaatsing. De uiteindelijke header-/replygeometrie is afzonderlijk gecontroleerd in de vijf gerichte en 61 volledige CI-browserscenario's. Er wordt geen pixelgelijke overeenkomst van alle schermen geclaimd.

Bekende verschillen met de referentie zijn de bestaande productieshell met context-/lokale testmeldingen boven de schermen, een langere introductie op de competitie-index, de éénkoloms mobiele wizard en bredere koppen dan in de Feed-referentiefoto. De gecontroleerde pagina's hebben geen horizontale overflow. Tabellen behouden hun eigen horizontale scroll wanneer hun inhoud breder is dan de mobiele kolom.

## Geïsoleerde testaccounts en lokale preview

Nieuwe DB-tests genereren per run eigen UUID's voor spelers, vereniging, evenement, seizoen, banen en uitslagen en ruimen alleen hun eigen fixtures op. Browserfixtures met voorbeelduitslagen worden niet in staging of productie geladen. De echte lokale communitytest gebruikt onderstaande seedaccounts en maakt een eigen club met een willekeurige suffix.

| Lokale rol | Seednaam | Account-ID |
| --- | --- | --- |
| Organisator / lokale eigenaar | Danny Goldenbelt | `00000000-0000-4000-8000-000000000001` |
| Eerste speler | Michael de Groot | `00000000-0000-4000-8000-000000000002` |
| Tweede speler | Raymond van Dijk | `00000000-0000-4000-8000-000000000003` |
| Andere vereniging | Speler andere club | `00000000-0000-4000-8000-000000000004` |

De normale lokale seed maakt geen vooraf gevuld v20-seizoen. Maak een seizoen via Competities, of laat de afgebakende UUID-tests hun eigen programma opbouwen. De namen en IDs hierboven zijn geen hosted accounts.

De exacte geaccepteerde CI-kandidaat draait op deze development-VPS op `127.0.0.1:3000`, gestart via `.local/v20-local-preview.mjs` vanuit `.local/v20-local-release/`. Health en readiness melden bron `337a59158ac1a55c46a0953b3d50b29aab6b9538`. Het uitgepakte artifact is gecontroleerd tegen SHA-256 `a5425c705603ec36dc3096ae65d7af5fd878340113a3574393ce15b00aebf495`. Het startscript laadt de bestaande lokale configuratie, vereist `DARTFLOW_DATA_MODE=local` en een loopback-database en controleert `http://localhost:3000`. Het artifact bevat geen runtime-envbestand.

```sh
node .local/v20-local-preview.mjs
```

De opdracht hierboven is de herstartinstructie voor de bestaande preview; start geen tweede server op dezelfde poort. De voorbereiding controleert manifest, bron-SHA en SHA-256 vóór veilig uitpakken. De preview gebruikt uitsluitend de bestaande lokale PostgreSQL- en PIN-configuratie. Voor het opnieuw bouwen en volledig reproduceren staan de commando's in [Lokale verificatie](v20-feed-en-competities.md#lokale-verificatie-opnieuw-uitvoeren).

Open daarna `http://localhost:3000` op de dev-VPS, of gebruik de bestaande SSH-poortdoorvoer naar die loopbackpoort:

- `/app`, `/app/speeldag`, `/app/baanfavorieten`, `/app/training-advies` en `/app/schermbeheer` voor de spelers- en leidingflows.
- `/app/feed` en `/app/feed/discover` voor tijdlijn en kanalen; `/app/feed/club/<clubId>` voor de eigen verenigingsfeed en chat.
- `/app/feed/share/<bronId>` vanuit een bevestigde bevoegde uitslag; `/app/feed/result/<deelId>` voor de aangemaakte deelkaart.
- `/app/competities` en `/app/competities/<seizoenId>` voor een nieuw of opgeslagen seizoen.
- `/baan/<baanId>` en `/oche-live/<baanId>/` voor de vaste spelers- en schermroute. De normale lokale Baan 1 gebruikt `40000000-0000-4000-8000-000000000001` wanneer deze fixture aanwezig en toegankelijk is.

## Migraties en configuratie

De drie bronmigraties worden via de bestaande hosted migratieprocedure toegepast. Hun featuremarkers zijn `competition_seasons=1`, `feed_channels=1` en `player_experience=1`.

| Bronbestand | Staging: toegepaste hosted versie | Productie: toegepaste hosted versie |
| --- | --- | --- |
| `20261113021017_competition_seasons.sql` | `20261113043907` · toegepast en gecontroleerd. | `20261113044334` · toegepast en gecontroleerd. |
| `20261113021043_feed_channels_and_result_shares.sql` | `20261113043911` · toegepast en gecontroleerd. | `20261113044337` · toegepast en gecontroleerd. |
| `20261113021253_player_experience_and_screen_presence.sql` | `20261113043916` · toegepast en gecontroleerd. | `20261113044344` · toegepast en gecontroleerd. |

Voor v20 zijn **geen nieuwe GitHub-secrets, GitHub-variabelen of provideraccounts nodig**. De bestaande v19-PIN-peppers, secretversie en KDF-/limietconfiguratie blijven vereist in de beschermde runtimebundels. Namen en rotatiegrenzen staan in [infra/V19-PIN.md](../infra/V19-PIN.md); waarden horen niet in dit verslag of buildartifact.

Op staging én productie zijn alle 13 nieuwe tabellen gecontroleerd: RLS staat aan, de benodigde runtime-SELECT is aanwezig en provider-read is niet toegestaan. Tellingen en stabiele hashes van profiel-ID's, volledige wedstrijdrecords, beurten en uitslagen zijn in beide omgevingen onder maintenance vóór en na de migratie identiek gebleven. De bronbestanden zijn onder de hierboven vermelde feitelijke hosted versies geregistreerd.

De migraties behouden bestaande profiel- en wedstrijdidentiteiten. Iedere hosted toepassing controleert behoud van bestaande data, private RLS/grants, featuremarkers en schema-/runtimecompatibiliteit. De lokale alles-herhalende `db:migrate` is geen alternatieve hosted uitrolroute.

## Supabase Security Advisors

De Security Advisors geven op beide projecten dezelfde twee reeds bestaande bevindingen; er zijn geen nieuwe bevindingen door deze migraties ontstaan.

| Bevinding | Vastgestelde status en vervolg |
| --- | --- |
| INFO · RLS enabled no policy op `dartflow_private.owner_bootstrap` | Bestaande bewuste API-afscherming van de eigenaarbootstrap. RLS zonder beleid staat geen API-toegang toe; de bestaande private grants blijven behouden. Supabase beschrijft desgewenst een expliciet afwijzend beleid om deze bedoeling vast te leggen. Er is in deze uitrol geen nieuw beleid toegevoegd. [Officiële uitleg en remedie](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). |
| WARN · Leaked password protection disabled | Deze bestaande Auth-instelling staat nog uit. Inschakelen volgt afzonderlijk via de project-Auth-instellingen. Er is in deze uitrol geen providerinstelling gewijzigd. [Officiële configuratie-instructie](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). |

## Hosted staging- en productie-uitrol

De geautoriseerde native uitrol naar staging en productie is afgerond voor dezelfde geteste applicatiebron `337a59158ac1a55c46a0953b3d50b29aab6b9538`. Beide health-/readinessprojecties bevestigen de bijbehorende bron, release en ongewijzigde v19-runtimeconfiguratie.

| Omgeving | Geaccepteerde applicatiebron | Native deployrun en feitelijke activatie |
| --- | --- | --- |
| [Staging](https://staging.dartflow.nl) | `337a59158ac1a55c46a0953b3d50b29aab6b9538` | [Native run 43366937852](https://github.com/dartflow/platform/actions/runs/43366937852) geslaagd; actief `43366937852-1`, configuratie `staging-2026-11-12-v19-pin-1`. |
| [Productie](https://dartflow.nl) | `337a59158ac1a55c46a0953b3d50b29aab6b9538` | [Native run 43367406953](https://github.com/dartflow/platform/actions/runs/43367406953) geslaagd; actief `43367406953-1`, configuratie `production-2026-11-12-v19-pin-1`. |

Readiness bevestigt in beide omgevingen een werkende database en bereikbare Auth-service op de geaccepteerde bron en configuratie. De maintenancevensters op 13 november 2026 waren **04:38:42–04:42:15 UTC voor staging** en **04:43:08–04:47:04 UTC voor productie**. Na elk venster zijn de exacte bestaande Caddy-configuratie en de mailtimer hersteld; onafhankelijke configuratie bleef behouden. De migratiecontrole en back-upbewijzen zijn bewaard. Auth-bereikbaarheid is geen nieuwe volledige Google-/OTP-gebruikerslogin.

### Alleen-lezen controles via HTTPS

De volgende controles zijn geslaagd op de daadwerkelijk geactiveerde bron en release, op 13 november 2026:

| Omgeving | Vastgelegde controletijd UTC | Bewijs |
| --- | --- | --- |
| Staging | `04:42:19.495` | `.local/v20-staging-public-smoke.json`. |
| Productie | `04:47:10.169` | `.local/v20-production-public-smoke.json`. |

Beide controles voeren dezelfde onderstaande proeven uit. Er zijn geen hosted mutaties, logininzendingen, PIN-koppelingen, scorebeurten of mails uitgevoerd. Er zijn nul paginafouten vastgesteld.

- Drie verschillende manifeste-identiteiten zijn gecontroleerd: DartFlow Speler, Scorebord en het vaste baanscherm, inclusief start-URL, scope en 192-/512-pixeliconen.
- De openbare aliassen `/baanscherm/<baanId>` en `/oche-live/<baanId>/` vullen beide bij een 1920×1080-signaal het volledige vlak. Hun logische oppervlak is 1080×1920 met 90° rechtsomrotatie; er is geen horizontale overflow.
- De QR-code is uit de werkelijk gerenderde, gedraaide screenshotpixels gedecodeerd en opent dezelfde vaste spelersroute. Dit is een beeld-/decoderproef, geen fysieke camerascan.
- Browser-DOM-fullscreen, de zichtbare installatiebediening en aangeboden installatie-instructies zijn gecontroleerd. Tijdens netwerkverlies blijft de laatst ontvangen projectie staan; na herstel volgt een nieuwe actuele baanstatusopvraag.
- De echte anonieme spelers-loginlanding is op 390×844 geopend. Anonieme GET-verzoeken naar de gecontroleerde private spelerendpoints zijn met HTTP 401 geweigerd; ook een onbekend openbaar deel-ID is geweigerd. Er is geen aangemelde spelerssessie aangemaakt.

De gecontroleerde [stagingbaan](https://staging.dartflow.nl/oche-live/6fd6090a-111f-4bf4-89ef-1db4ab84a7f3/) en [productiebaan](https://dartflow.nl/oche-live/276acb23-c754-4fb8-928c-839048650bfd/) stonden vrij en openbaar beschikbaar. **Echte hosted live-score-invoer is niet getest.** Ook native OS-installatie en een fysiek mobiel/Chromecastapparaat zijn hiermee niet bewezen. De screenshotreeksen staan in `.local/v20-staging-public-smoke/` en `.local/v20-production-public-smoke/`.

De bestaande DG Webservices-native procedure verzorgt private back-up, migratiecontrole, omgevingsspecifieke build/runtime en staging vóór productie. De alleen-lezen hosted acceptatie omvat de bron-/configuratie-identiteit, health/readiness, geldige openbare scherm-/manifestroutes en HTTP 401 op anonieme GET-verzoeken naar de gecontroleerde private endpoints. Er zijn geen private mutatieverzoeken ingezonden. Nieuwe privé-Feed- of seizoenrechten worden niet bewezen door alleen een HTTP 200 op de loginpagina. Geïsoleerde lokale testresultaten zijn geen claim dat echte hosted providerlogin of apparaatinstallatie opnieuw is doorlopen.

### Definitieve host- en databehoudscontrole

De alleen-lezen eindcontrole is geslaagd op **13 november 2026 om 04:47:17 UTC**; bewijs staat in `.local/v20-final-host-check.json` en `.local/v20-hosted-database-final.json`.

- Alle acht publieke en loopback health-/readinesscontroles geven de juiste bron, release en configuratie.
- Beide apps, beide runners en TURN zijn actief; beide mailtimers zijn actief. In de gecontroleerde app-/maillogs zijn nul fouten vastgesteld, ook bij de worker voor verlopen baansessies.
- Per app bestaat één systemd-waarschuwing met prioriteit 4. Beide hebben dezelfde genormaliseerde afdruk `a017f3965eb70cf0304a70265331e2c4fe63c087a65684ed5c80a1c8918a1d86`, die ook vóór deze uitrol op 11 november aanwezig was. Ruwe journalinhoud is niet in het verslag opgenomen.
- De gedeelde lock met identiteit `29:6` is vrij en de modus is ongewijzigd. Alle Caddy-configuratie is exact teruggezet. De onafhankelijke Milo-app behoudt PID `70911`, dezelfde release en dezelfde gezonde status.
- De definitieve tellingen en hashes van bestaande profiel-ID's, volledige wedstrijdrecords, beurten en uitslagen zijn in beide databases ongewijzigd. De private v19-runtimeconfiguraties blijven behouden.

## Private back-ups en terugval

| Bewijs | Staging | Productie |
| --- | --- | --- |
| Back-up vóór migratie: root-only pad, UTC-tijd, checksum-/archiefcontrole | `/var/backups/dartflow/v20-feed-seasons-staging-20261113T043852348491Z`, 13 november 2026 04:38:52.348491 UTC; vijf hashes en volledige archiefdecodering gecontroleerd. | `/var/backups/dartflow/v20-feed-seasons-production-20261113T044315733277Z`, 13 november 2026 04:43:15.733277 UTC; vijf checksums en volledige archiefdecodering gecontroleerd. Archief: 252.745 bytes; SHA-256 hieronder. |
| Beschermde runtimebundel en vorige apprelease | Ongewijzigd `staging-2026-11-12-v19-pin-1`; beschermd `runtime.env` in de private back-upset. Vorige appreferentie: `f37fb877a1a2-43313841460-1`. | Ongewijzigd `production-2026-11-12-v19-pin-1`; beschermd `runtime.env` in de private back-upset. Vorige appreferentie: `f37fb877a1a2-43314509638-1`. |
| Back-up na activatie en gekoppelde release | `/var/backups/dartflow/v20-feed-seasons-staging-20261113T044745273716Z`, 13 november 2026 04:47:45.273716 UTC; actief `43366937852-1`. Vijf hashes en volledige archiefdecodering gecontroleerd. | `/var/backups/dartflow/v20-feed-seasons-production-20261113T044817652700Z`, 13 november 2026 04:48:17.652700 UTC; actief `43367406953-1`. Vijf hashes en volledige archiefdecodering gecontroleerd. |

De gecontroleerde archiefchecksums zijn:

| Archief | SHA-256 |
| --- | --- |
| Productie vóór migratie | `12dbe1b1bd299fa9c2889e1b90032837f4c47399e023600ae0863dd7bcbc3f1c` |
| Staging na activatie | `3ff303079d68252e0bef7911bab6f8b7346299f9e68233999a281ff2498ffded` |
| Productie na activatie | `424ee44d573aa5f6506767a0b485ca9fe1b2a6ec489606937d14054e20702577` |

De beide back-ups na activatie bevatten elk 84 voor de app leesbare tabellen. De bewust extra afgeschermde `owner_bootstrap` valt buiten deze tabelsnapshot; de beschermde runtimeconfiguratie is afzonderlijk in de private back-upset opgenomen. Dit is geen claim van een uitgevoerde volledige Supabase-/Auth-restore.

Voor deze staging- en productieback-ups is geen restore uitgevoerd. Een gecontroleerd archief is geen uitgevoerde restoreproef. Terugzetten van een eerdere apprelease na nieuwe v20-seizoensschrijfacties vereist eerst een compatibiliteitscontrole van het schema, de opgeslagen seizoen-/wedstrijdstatus en de oude applicatie. Gebruik daarna de bestaande native terugvalprocedure; behoud peppers, onafhankelijke applicaties en hun configuratie. Zet niet blind de database of Supabase Auth terug: een data- of Auth-herstel vraagt een afzonderlijk gecontroleerd herstelplan en mag nieuwere geldige gegevens niet stil overschrijven.

## Bewuste acceptatiegrenzen

- De speelbare nieuwe seizoenspilot omvat interne lokale partijen en landelijke ontmoetingen met vier singles. Officiële remote clubontmoetingen met twee fysieke baankoppelingen en passende schrijvers blijven afgeschermd. Daarmee is acceptatiegeval L09 niet als volledig ondersteund opgeleverd.
- Koppels, zeven-slotteamgames en de nieuwe clubbeker-, ladder-, instuif- en Champions-verwerking hebben aanvullende score-, bracket-, instroom- of kwalificatieregels nodig. Het model kan deze als concept bewaren; de server blokkeert ongeldige publicatie/start. L11 en L12 zijn daarmee niet volledig uitgevoerd.
- Bewaarde promotie-, degradatie-, termijn- en inhaalinstellingen vormen geen automatische promotie-, kwalificatie- of escalatiejob. L10 moet binnen de daadwerkelijk aangeboden bevoegde beslissingen worden gelezen.
- Officiële bronuitslagen en ondersteunde seizoenupdates voeden de Feed. Een kaartcategorie voor prestaties bewijst geen automatische producent voor iedere mogelijke mijlpaal of kampioenschap.
- Echte Google-/e-mail-OTP bij de providers, fysieke QR-scans, native PWA-installatie op Android/iOS/tv, kioskstart na stroomuitval en de fysiek gemonteerde Chromecast zijn niet door de beschreven lokale/browserfixtures bewezen. Deze apparaatproeven zijn niet opnieuw uitgevoerd; de gebruiker heeft de fysieke apparatentests eerder laten overslaan.
- De geslaagde automatische suite en vastgelegde screenshots tonen de beschreven werking en lay-out. Ze vormen geen claim van pixelgelijke overeenkomst met iedere afbeelding uit de overdracht.
