# v20 · Feed, spelerservaring en competities

Deze handleiding beschrijft de bediening en technische aansluiting van Toevoeging 1 en 2 op de bestaande DartFlow-app. De bron uit de overdracht is gebruikt als ontwerp- en gedragsreferentie; productie gebruikt de bestaande Next.js-app, eigen sessie, PostgreSQL-opslag en score-engine. Prototypeaccounts, browseropslag en de voorbeeldwedstrijd zijn geen productiegegevens.

De uitgevoerde controles, eventuele beperkingen van die controles, actieve release-SHA, workflowruns en migratiebewijzen staan in [v20-uitrol.md](v20-uitrol.md). Deze handleiding is geen bewijs dat een uitrol of volledige testsuite al is geslaagd.

## Direct openen

Gebruik lokaal `http://localhost:3000`, op staging `https://staging.dartflow.nl` en op productie `https://dartflow.nl` als basis. Open daarna de onderstaande route. Een baan-, wedstrijd- of seizoen-ID komt uit de eigen omgeving; kopieer geen voorbeeld-ID uit de overdracht naar productie.

| Route | Gebruik |
| --- | --- |
| `/app` | Vandaag: persoonlijke speeldagkaart, relevante vervolgactie en bestaande speelomgeving. |
| `/app/feed` | My Feed met gevolgde kanalen, maximaal twee persoonlijke acties, filters, berichten en reacties. |
| `/app/feed/discover` | Openbare kanalen ontdekken en volgen. Volgen schrijft niemand in voor een evenement. |
| `/app/feed/club/<clubId>` | Besloten verenigingskanaal, volgens het actuele clublidmaatschap. |
| `/app/feed/club-public/<clubId>` | Openbare clubpublicaties, wanneer de vereniging daarvoor is vrijgegeven. |
| `/app/feed/friends` | Berichten binnen de actuele DartFlow-vriendschappen. |
| `/app/feed/league/<seizoenId>` of `/app/feed/tournament/<toernooiId>` | Het toegestane competitie- of toernooikanaal. |
| `/app/feed/share/<bronId>` | Voorvertoning en publiekskeuze voor een definitief bevestigde eigen uitslag. |
| `/app/feed/result/<deelId>` | Servermatig opgeloste deelkaart. Alleen een expliciet openbare, geldige deelkaart kan zonder login openen. |
| `/app/speeldag` | Eigen programma, beschikbaarheid, check-in, oproep en toegang tot de toegewezen partij. |
| `/app/baanfavorieten` | Favoriete banen en laatst gebruikte spelinstellingen per speler. |
| `/app/training-advies` | Gerichte First 9- en checkoutoefeningen met voortgang van dezelfde oefenvorm. |
| `/app/schermbeheer` | Oche Live-schermen beheren binnen de eigen baanrechten. |
| `/app/competities` | Interne en landelijke seizoenen openen of, met de juiste rol, aanmaken. |
| `/app/competities/<seizoenId>` | Overzicht, stand, programma, uitslagen, statistieken, reglement en bevoegd beheer. |
| `/wedstrijd/<wedstrijdId>` | Bestaande scorekaart, schrijver, beurtvolgorde en wedstrijdafronding. |
| `/baan/<baanId>` | Bestaande vaste QR-spelersflow. |
| `/oche-live/<baanId>/` | Bestaand Oche Live-baanscherm met vaste PWA-route. |

De uitslagpagina kan voor een ingelogde bevoegde gebruiker ook een bron-ID oplossen. Voor openbaar delen wordt altijd een afzonderlijk deel-ID aangemaakt. Een wedstrijd uit een nieuw seizoen verwijst naar de definitieve ontmoeting of fixture: een losse nationale single wordt vóór teambevestiging geen afzonderlijk openbare teamuitslag.

## My Feed en een uitslag delen

1. Open **My Feed**. Kies **Ontdekken** om openbare kanalen te volgen. Het evenement zelf blijft de ingang voor inschrijving, deelnamevoorwaarden en check-in.
2. Stel via **Voorkeuren** per kanaal **Alle updates**, **Belangrijke updates** of **Gedempt** in. Deze voorkeuren bepalen welke kanaalupdates in de persoonlijke Feed verschijnen; deelname en officiële wedstrijdbesluiten veranderen hierdoor niet.
3. Kies bij een nieuw bericht eerst het kanaal. Het leesbare publiek staat vóór **Plaatsen** in beeld. De server controleert de actuele rechten nogmaals bij verzenden.
4. Likes en reacties gebruiken een aanvraag-ID. Een onzekere aanvraag kan met hetzelfde ID worden herhaald. Bij verbindingsproblemen toont de app een herstelactie en houdt zij een eerder ontvangen tijdlijn herkenbaar van een echte lege toestand.
5. Een bevoegde kanaalbeheerder kan berichten tijdelijk vastzetten en kanaalinstellingen beheren. De ingestelde maximale pinduur is één, drie of zeven dagen. Dit vastzetten staat los van de spelerspincode.

De persoonlijke tijdlijn en reacties gebruiken chronologische paginering met een tijdstip en UUID als vaste tweede sleutel. De cursor bewaart ook PostgreSQL-microseconden. Bestaande compacte club- en evenementfeeds houden dezelfde bericht- en reactie-ID's; likes, reacties en verwijderingen worden tussen die weergaven aangesloten.

Op een toegestaan clubkanaal blijft de bestaande verenigingschat beschikbaar. Bij een openbaar competitie- of toernooikanaal geven volgen en het lezen van openbare updates geen toegang tot de deelnemerschat. Ook oudere deelnemersberichten en hun reacties houden hun oorspronkelijke rechten. Intrekken van toegang wist ontvangen privégegevens uit het scherm; een eerder gestart antwoord kan die gegevens daarna niet terugzetten.

Na definitieve wedstrijdbevestiging opent **Deel uitslag of speel revanche** de voorvertoning. Kies het toegestane publiek en eventueel een passend kanaal. Een besloten bron kan niet door alleen de publiekskeuze openbaar worden. Een uitnodigingsevenement blijft afgeschermd, ook wanneer een oude algemene zichtbaarheidsvlag `public` bevat.

Een deelkaart bevat geen volledige wedstrijdpayload in de URL. De server bewaart een intrekbaar deel-ID en haalt bij ieder openen de actuele bevestigde bron en huidige toegangsrechten op. Broncorrecties gebruiken dezelfde identiteit. Intrekken van de kaart, verlies van toegang of intrekken van de openbare bron werkt door op bestaande links. Een openbare kaart bevat de vrijgegeven namen en uitslag; account-ID's, schrijfrechten en privégegevens worden niet meegegeven. De bestaande profielvoorkeur voor openbare statistieken wordt opnieuw toegepast.

**Revanche** maakt een nieuwe vrije, besloten lobby met dezelfde ondersteunde spelinstellingen en een verwijzing naar de vorige partij. De originele officiële wedstrijd, historie en competitiestand worden daarbij niet gewijzigd. Bij een landelijke ontmoeting met vier singles is geen fictieve revanchepartij voor de hele teamontmoeting beschikbaar.

## Persoonlijke speeldag, favorieten en oefenen

Vandaag en **Mijn speeldag** tonen gegevens uit de bestaande wedstrijden en de nieuwe seizoensplanning. De vervolgactie volgt de actuele toestand: deelname bevestigen, check-in, starten, hervatten, uitslag bevestigen of een beoordeling bekijken. De maximaal twee acties boven My Feed komen uit dezelfde persoonlijke projectie en verschijnen alleen voor de betrokken gebruiker.

Een speler kan zichzelf op pauze zetten en weer beschikbaar maken. Check-in opent volgens de afspraak en de ingestelde termijn. Een QR van een toegewezen baan opent de bestaande officiële partij; de vrije lobby neemt die toewijzing niet over. Na reconnect worden de geaccepteerde stand, schrijver en laatste beurt opnieuw uit de servergegevens gehaald.

Bij **Favoriete banen** bewaart iedere speler zijn eigen banen en laatste spelkeuze. Toegang tot een baan blijft een aparte servercontrole. Een bewaarde favoriet geeft geen toegang tot een inmiddels afgeschermde baan en geeft geen voorrang op een reservering of lopende partij.

**Training op maat** biedt First 9 en checkouttraining. Het advies start een opgeslagen oefensessie in de bestaande oefenengine. Voortgang vergelijkt voltooide sessies van dezelfde focus; oefenresultaten worden niet aan competitie- of onderlinge wedstrijdstatistieken toegevoegd. Het persoonlijke weekdoel is instelbaar. Onvolledige meetgegevens worden niet als een volledig gemiddelde gepresenteerd.

## Rollen en seizoenbeheer

| Rol | Bevoegdheden |
| --- | --- |
| Speler | Eigen kanaalvoorkeuren, berichten waar toegestaan, eigen beschikbaarheid en check-in, toegewezen partij, eigen uitslag en toegestane deelkaart. |
| Schrijver | Scores voor de toegewezen partij volgens de bestaande score- en correctieregels; geen account- of teambeheer door die aanwijzing. |
| Captain of aangewezen vervanger | Eigen teamopstelling, toegestane tijdvoorstellen, teamuitslag bevestigen en een dispuut melden. Het actuele clublidmaatschap blijft vereist. |
| Clubbeheer of interne competitieleiding | Eigen interne seizoenen, toelating, indeling, vrijgave, planning, bevoegde beslissingen en clubkanalen. |
| Landelijke competitieleiding | Landelijke seizoenen, clubteams en officiële uitzonderingen vanuit de bestaande vertrouwde platformrol. |
| Baan- of locatiebeheer | Gekoppelde Oche Live-apparaten en scherminstellingen binnen de bestaande baanrechten. Een gewone speler krijgt die beheerrechten niet. |
| Bezoeker | Uitsluitend een expliciet vrijgegeven openbare projectie of geldige openbare deelkaart. |

### Interne competitie

1. Maak via **Competities** een intern seizoen voor de eigen vereniging aan. Kies een naam, divisies, reglement en zichtbaarheid.
2. Kies vaste speelblokken of flexibele rondevensters, startdatum, tijdzone, beschikbare banen en puntentelling. X01 gebruikt de bestaande startscore en double-out-engine; kies best of of een ondersteund aantal vaste legs.
3. Open de inschrijving en voeg toegelaten spelers toe. Controleer wachtlijst, divisie, actuele speelgerechtigdheid en beschikbaarheid.
4. Genereer het programma en controleer conflicten met spelers, schrijvers, andere competities, toernooien en bestaande baanreserveringen. Publiceer daarna het gecontroleerde programma. Geef rondes afzonderlijk vrij wanneer rondevrijgave is ingeschakeld.
5. Laat de spelers inchecken. Wijs bij de partij een toegestane fysieke baan en schrijver aan. De score-invoer en Oche Live gebruiken hetzelfde wedstrijd-ID.
6. Handel uitslagen af via het bestaande wedstrijdpad. Een bevoegde correctie gebruikt het seizoensbesluit en hervat dezelfde opgeslagen partij. Het opnieuw publiceren van die bron mag geen tweede uitslag of extra Feed-kaart maken.
7. Rond openstaande ontmoetingen af vóór archivering. Export en kalender komen uit het toegestane seizoen; een seizoenskopie begint als nieuw concept met een nieuwe identiteit.

Een gepubliceerd of gestart reglement kan niet stil worden herschreven. Beslissingen over tijd, indeling en uitslag krijgen waar vereist een reden en actor. Bij een reeds bestaande partij loopt een baanwissel via onderbreken en hervatten, met behoud van de geaccepteerde score.

### Landelijke vier-singlespilot

De speelbare pilot bestaat uit vier singles per ontmoeting, met vier spelers uit een goedgekeurde selectie van vier tot acht. De captain en vervanger komen uit die selectie. Een speler vertegenwoordigt binnen één landelijk seizoen één vereniging. Het uitgangspunt is één team per club; aanvullende teams volgen de expliciete seizoeninstelling.

1. De landelijke leiding maakt het seizoen, divisies, reglement en speelvensters aan.
2. Bevoegd clubbeheer schrijft het team, de selectie, captain en vervanger in. De server controleert actuele clubrechten en dubbele representatie.
3. Na publicatie dienen beide captains hun vier slots in. De tegenpartij krijgt een nog niet onthulde opstelling niet via de gewone projectie. Na beide definitieve inzendingen worden de slots gekoppeld. Een gemotiveerde reservewissel volgt de bevoegdheden van de leiding.
4. Leiding en spelers volgen de toewijzing, check-in en rondevoorwaarden. Slot 1 speelt tegen slot 1, enzovoort; twee slots hebben een thuisstarter en twee een uitstarter. Het standaardreglement is 501 dubbel uit, best of 5.
5. De singles worden op hun normale scorekaart gespeeld en bevestigd. De nationale ontmoeting blijft voorlopig tot beide bevoegde kanten bevestigen of de leiding een geldig besluit neemt. Een dispuut houdt de ontmoeting buiten de definitieve stand en de daarvan afhankelijke projecties.

**Rekenvoorbeeld:** 3–2, 2–3, 3–0 en 1–3 geven 2–2 in gewonnen singles en 9–8 in gegooide legs. Bij het standaardreglement voor een gelijkspel krijgt ieder team één competitiepunt. Een administratief toegekend slot kan het partijresultaat beïnvloeden, maar verzint geen gegooide legs, beurten of persoonlijke AVG.

De vastgelegde rangorderegels worden uit definitieve bronnen berekend. De interface kan gedeelde posities tonen; er wordt geen extra gespeelde uitslag verzonnen om een gelijke stand te breken.

### Officiële QR en spelerspincode

De bestaande vaste baan-QR blijft de ingang. Bij een toegewezen officiële partij kan de bevoegde huidige schrijver een reeds opgestelde speler met gebruikersnaam en spelerspincode laten inchecken voor die partij. De server controleert onder meer de actuele toewijzing, schrijver, speler, opstelling, ronde, PIN-versie en geldigheid van de baansessie.

Deze controle wisselt de aangemelde gebruiker niet en geeft geen account-, selectie- of schemarechten. Een PIN maakt een niet-opgestelde speler niet speelgerechtigd. De pincode wordt gemaskeerd en na iedere poging gewist. Dit officiële check-in-pad vervangt de vereiste officiële uitslagbevestiging niet. Voor vrij lokaal spelen blijft het bestaande v19-pad voor twee profielen op één telefoon beschikbaar.

## Oche Live installeren en beheren

1. Open **Schermbeheer** als bevoegd baan- of locatiebeheerder. Controleer de baan en bestaande apparaatkoppelingen.
2. Open de vaste `/oche-live/<baanId>/` op het schermapparaat. Gebruik bij een afgeschermde baan de bestaande eenmalige apparaatkoppeling. Deel de koppelcode of apparaattoegang niet in een Feed-bericht.
3. Kies op een ondersteund apparaat **Installeer dit baanscherm**, of volg de aangeboden instructie voor een beginschermsnelkoppeling. De vaste baanroute en PWA-identiteit blijven behouden.
4. Kies de passende rotatie: 0°, 90° rechtsom of 270°. De bestaande Chromecast-opstelling gebruikt standaard 90° rechtsom. De instelling verandert de baanidentiteit, QR en wedstrijd niet.
5. Controleer gekoppelde baan, laatste contact, actieve partij en rotatie. De verbindingsstatus volgt de recente heartbeat van een geldige koppeling. Een verlopen of ingetrokken koppeling is geen bevoegd actief scherm.
6. Trek een koppeling in wanneer een apparaat wordt vervangen. Controleer bij hervatten de actuele schrijver, beurt en laatste geaccepteerde worp.

De bestaande Oche Live-regels voor stand-by, scorekaart, inactiviteit, vrijgeven en onderbroken officiële duels blijven van toepassing. Fysieke installatie, kioskstart na stroomuitval en de gemonteerde schermoriëntatie moeten op het eigen apparaat worden gevalideerd; softwaremetingen alleen bewijzen die bediening niet. De eerdere apparaat- en kioskinstructies staan in de bestaande Oche Live-documentatie.

## Technische aansluiting

| Onderdeel | Productiebron |
| --- | --- |
| Authenticatie en transport | Bestaande sessie, autorisatie en CSRF-/bodycontroles in `app/api/[...path]/route.ts`; routeherstel via `lib/config.ts`. |
| Nieuwe Feed | `lib/feed.ts`, `lib/feed-types.ts` en `components/feed-workspace.*`. Private kanaalvoorkeuren, berichten, reacties, deel-ID's en aanvraagbewijzen. |
| Bestaande community | `lib/community.ts` en `community_posts` als bestaande bron voor compacte club- en evenementgesprekken; dezelfde post- en reactie-identiteiten blijven gekoppeld. |
| Seizoenen | `lib/seasons.ts`, `lib/seasons-domain.ts`, `lib/seasons-types.ts` en `components/season-workspace.*`. Planning, rollen, beslissingen en definitieve stand. |
| Officiële PIN-check-in | `lib/season-pin.ts` hergebruikt de private v19-PIN-verifier en bestaande limitering uit `lib/player-pin.ts`. |
| Kalender | `lib/season-calendar.ts` projecteert het toegestane programma naar iCalendar. |
| Vandaag, speeldag en voorkeuren | `lib/player-experience.ts`, `lib/player-experience-store.ts`, `lib/player-experience-types.ts` en `components/player-experience.*`. |
| Score en wedstrijdafronding | Bestaande `lib/domain.ts`, `lib/db.ts`, `matches`, `visits` en unieke `match_results`. Seizoen, QR, schrijver, scorekaart en scherm verwijzen naar dezelfde partij. |
| Statistieken | Bestaande centrale rekenbron in `lib/player-statistics.ts` en `lib/player-statistics-db.ts`; gespeelde definitieve bronnen worden gescheiden van oefenen, administratieve besluiten en voorlopige nationale ontmoetingen. |
| Oche Live en schermbeheer | Bestaande schermcomponenten en `lib/board-screens.ts`, met private schermvoorkeuren en apparaat-heartbeats. |

De resultaatschrijflaag verwerkt een geaccepteerde uitslag binnen dezelfde transactie als de relevante seizoenprojectie. `captureFeedResult` en `captureSeasonFeedSources` bewaren een private verwijzing naar de bevestigde bron en revisie. De Feed leest de actuele bron opnieuw; een opgeslagen kaart verleent dus geen permanent leesrecht. Upserts van meerdere bronkaarten gebruiken een vaste ID-volgorde om tegengestelde lockvolgordes te vermijden.

De algemene legacy-competitiecommando's beheren geen nieuw seizoen buiten de nieuwe seizoensflow om. Beschikbaarheid, toewijzing en afronding blijven serverbeslissingen. Aanvraagbewijzen, verwachte revisies en transacties maken een retry herhaalbaar zonder dubbele partij of uitslag.

## Migraties en configuratie

Pas deze drie migraties in bestandsvolgorde toe via de bestaande migratie- en releaseprocedure:

1. `supabase/migrations/20261113021017_competition_seasons.sql` — private seizoenen, representatie, aanvraagbewijzen en officiële PIN-bewijzen; de beperkte heropening van seizoensresultaten.
2. `supabase/migrations/20261113021043_feed_channels_and_result_shares.sql` — private Feed-tabellen, kanaalbeleid, reacties, intrekbare deel-ID's en idempotentie.
3. `supabase/migrations/20261113021253_player_experience_and_screen_presence.sql` — persoonlijke voorkeuren, schermrotatie en apparaatstatus.

De featuremarkers zijn respectievelijk `competition_seasons=1`, `feed_channels=1` en `player_experience=1`. Nieuwe opslag blijft in `dartflow_private`, met RLS en alleen de benodigde runtimegrants. De applicatie hergebruikt stabiele profiel-, baan-, evenement- en wedstrijd-ID's.

Er zijn **geen nieuwe GitHub-secrets, GitHub-variabelen of provideraccounts** nodig. De bestaande v19-PIN-configuratie blijft vereist. Namen en beheer van `DARTFLOW_PLAYER_PIN_PEPPERS`, `DARTFLOW_PLAYER_PIN_PEPPER_VERSION` en de bestaande optionele KDF-/limietinstellingen staan in [infra/V19-PIN.md](../infra/V19-PIN.md). Bewaar de bestaande peppers in de beschermde runtimebundels en bijbehorende private back-up; publiceer geen waarden en genereer geen vervangende PIN's voor bestaande spelers.

Gebruik voor staging en productie de DG Webservices-releaseflow met één gecontroleerde bron-SHA: CI, migraties en back-up volgens het runbook, stagingacceptatie en daarna productie met dezelfde SHA. Voer de lokale alles-herhalende `npm run db:migrate` niet als alternatieve hosted migratie- of deployroute uit. De feitelijke toepassing en eventuele herstelhandelingen worden vastgelegd in [v20-uitrol.md](v20-uitrol.md).

## Lokale verificatie opnieuw uitvoeren

Gebruik de repositorycheckout met de bestaande ondersteunde Node-/npm-versies en een afzonderlijke lokale PostgreSQL-configuratie. De testbestanden laden `.env.local` wanneer die bestaat. Configureer `DARTFLOW_DATA_MODE=local`, een loopback `DARTFLOW_DATABASE_URL`, een loopback `DARTFLOW_DATABASE_ADMIN_URL` en de bestaande lokale PIN-configuratie. Neem geen hosted credentials over als testconfiguratie.

```sh
npm ci
npm run db:start
npm run db:migrate
npx tsx --test --test-concurrency=1 tests/feed.test.ts tests/feed-db.test.ts tests/seasons.test.ts tests/seasons-db.test.ts tests/player-experience.test.ts
npm run typecheck
npm run lint
npm run build
npm run start
```

De gerichte browsertests draaien tegen de lokale appbuild. Start deze in een aparte terminal terwijl de lokale server actief is:

```sh
npx playwright test tests/e2e/feed-additions.spec.ts tests/e2e/seasons-workspace.spec.ts tests/e2e/player-experience.spec.ts
```

Voer daarna de bestaande volledige verificatie uit volgens het repository- en uitrolrunbook, waaronder `npm test`, `npm run test:e2e` en de toepasselijke deploy-/bootstrapcontracten. Draai geen tweede build in dezelfde checkout terwijl browsercontroles de vorige build gebruiken. Laat tijdens database-regressies geen achtergrond-appworker met dezelfde lokale klokfixtures meedraaien.

De nieuwe DB-tests maken per run eigen UUID's en rollen aan en ruimen uitsluitend die fixtures op. Dezelfde tests zijn daardoor reproduceerbaar zonder vaste productieaccounts of een globale database-reset. Ze slaan DB-scenario's over wanneer de expliciete lokale configuratie ontbreekt; een overgeslagen DB-test is geen geslaagde DB-validatie.

| Testdoel | Bestanden en relevante controle |
| --- | --- |
| Feed en delen | `tests/feed.test.ts`, `tests/feed-db.test.ts`: scoped kanalen, volgen zonder inschrijven, rollen, likes/reacties met retry, bestaande community-identiteiten, tijdgebonden pin, microsecondenpaginering, bronprivacy, intrekking, gecorrigeerde revisie en nieuwe revanche-identiteit. |
| Seizoensdomein | `tests/seasons.test.ts`: instellingen, formats, kalender, programma en berekende stand. |
| Officiële integratie | `tests/seasons-db.test.ts`: rolgebonden transacties, selectie/opstelling, toegewezen PIN-check-in, dezelfde scorekaart, bevestiging, correctie, nationale 2–2/9–8, conflicten en archief/kopie/export. |
| Spelerservaring en schermen | `tests/player-experience.test.ts`: veilige login-terugkeer, tijdzoneweek, gerichte training, persoonlijke voorkeuren, actuele baanrechten en schermkoppeling/rotatie. |
| Browser | `tests/e2e/feed-additions.spec.ts`, `tests/e2e/seasons-workspace.spec.ts`, `tests/e2e/player-experience.spec.ts`: normale ingangen, publiekskeuze, formulieren, rolweergaven, smalle mobiele viewport en desktop. Deze bevatten ook expliciete lokale transportfixtures; zij vervangen geen volledige provider- of apparaatproef. |

Raadpleeg [v20-uitrol.md](v20-uitrol.md) voor de daadwerkelijk uitgevoerde selectie, aantallen, screenshots, resultaten, CI-run en geteste release-SHA. Gebruik de bovenstaande tabel niet als zelfstandige claim dat ieder scenario is uitgevoerd.

## Bewuste grenzen en vervolg

Het seizoensmodel kan aanvullende formats als concept bewaren. De servercapaciteitscontrole voorkomt publicatie of start wanneer de huidige score- of toewijzingslaag het gekozen format nog niet kan uitvoeren:

- **Koppels, zeven-slotteamformats en teamgames:** vereisen aan individuele spelers toegeschreven teambeurten en passende score-/statistiekverwerking.
- **Clubbeker, ladder, instuif en Champions Cup:** vragen hun eigen bracket-, uitdagings-, instroom- of kwalificatieregels. Gebruik waar passend de bestaande toernooiroute; een conceptseizoen simuleert deze verwerking niet.
- **Officiële remote clubontmoetingen:** vereisen twee geregistreerde fysieke baankoppelingen en passende schrijverkoppelingen. De nieuwe seizoenspilot speelt lokaal; bestaande vrije thuis- en hybridepartijen behouden hun eigen route.
- **Automatische competitieopvolging:** bewaarde promotie-, degradatie-, inhaal- en termijninstellingen zijn op zichzelf geen bewijs van automatische promotie, nieuwe kwalificaties of een escalatiejob. Bevoegde leiding handelt de huidige beslissingen via de aangeboden acties af; verdere automatisering vraagt afzonderlijke implementatie en acceptatie.
- **Echte apparaten en providers:** PWA-installatie, kioskherstart, fysieke QR-scan, de gemonteerde Chromecast en echte Google-/e-mailverificatie worden alleen als uitgevoerd gerapporteerd wanneer daarvan afzonderlijk bewijs is vastgelegd.

De actuele UI toont waar een format ontbreekt een concrete reden. Een niet-ondersteund concept hoort niet als speelbare of afgeronde competitie in de acceptatie te worden gepresenteerd.
