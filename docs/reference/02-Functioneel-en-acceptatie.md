# Dartflow | Functionaliteit en acceptatie

Dit document beschrijft het gedrag van het prototype en de beoogde stagingpilot. De inventaris is gebaseerd op de code van prototypeversie 10, commit `1c461a6`. Op die revisie slaagt `npm test` met 26 van 26 testonderdelen. De overige onderdelen van dit pakket beschrijven de definitieve versie, de mobiele controles, de serverinrichting en de inlogflows.

## 1. Product en rolverdeling

Dartflow is een dartsplatform voor spelers, verenigingen en wedstrijdleiding. Spelers kunnen oefenen, onderling wedstrijden spelen en deelnemen aan competities en toernooien. Op locatie kan een organisator een speeldag aansturen en een baan koppelen aan score-invoer op telefoons en een publiek scherm.

Voor staging krijgt iedere speler één account voor dashboard, club, wedstrijd en Baanmodus. Een account kan tegelijk lid zijn van meerdere verenigingen. De gekozen omgeving bepaalt de zichtbare gegevens en het standaardteam voor nieuwe acties. De eigenaar van een evenement, kamer of wedstrijd ligt vast op het record. Een directe link opent de juiste context als de gebruiker daar toegang heeft.

| Rol | Bediening voor de pilot | Controle in staging |
| --- | --- | --- |
| Speler | Eigen programma, inschrijving, check-in, uitnodigingen, eigen historie, score bevestigen | De server controleert lidmaatschap, deelname en schrijfstatus per actie |
| Clubbeheerder | Leden, rollen, aanvragen, activiteiten en clubkamers beheren | Rechten gelden per vereniging. Een beheerder van club A kan een besloten club B alleen openen met een passende eigen rol |
| Wedstrijdleider | Inschrijvingen, check-in, bordoproepen, schrijver, schema en uitslagen | Verifieer de bevoegdheid voor het specifieke evenement. Een publiek scherm mag uitsluitend de openbare weergave lezen |
| Schrijver | Scores invoeren en corrigeren voor de toegewezen actieve partij | De server controleert de schrijver bij iedere score of overdracht |
| Kijker | Openbare stand, gepubliceerde uitslag en een vrijgegeven scherm bekijken | De openbare response bevat alleen vrijgegeven velden. Schrijfrechten en uitnodigingscodes horen bij beschermde acties |

Lidmaatschap van een club en deelname aan een evenement zijn aparte relaties. De organisator kan gasten toelaten volgens de instellingen van het evenement. Vrij spelen kan vanuit de platformomgeving ook met leden van verschillende clubs. Inloggen loopt in de serverversie via e-mail-OTP of Google. Gebruik de uitwerking van identiteit en serverrechten uit de bijbehorende hoofdstukken van dit pakket.

## 2. Routekaart van het prototype

De onderstaande hash-routes zijn de concrete ingangen in de aangeleverde referentie. Als de serverapp andere paden krijgt, leg de oude en nieuwe paden vast en test expliciet wat er gebeurt bij een bestaande QR-code, uitnodiging of toernooilink.

| Werkruimte | Referentieroute | Wat de gebruiker ziet |
| --- | --- | --- |
| Vandaag | `/#home` | Lopende partij of actie, komende wedstrijden, agenda en snelkoppelingen |
| Spelen | `/#play` | Vrij spelen, training, Baanmodus en invoer van een wedstrijdcode |
| Vrij spelen | `/#practice` en `/#lobby` | Wedstrijdvorm kiezen, uitnodigen en de wachtkamer openen |
| Training | `/#training` | Solo x01, Dartbot, dubbels en 170-challenge |
| Wedstrijdhistorie | `/#mymatches` | Actieve partijen, uitslagen en historie in de gekozen omgeving |
| Wedstrijdkamer | `/#match/{matchId}` | Lobby, scorekaart, acties en resultaat |
| Kijkersmodus en wedstrijd-overlay | `/#spectator/{matchId}` en `/#overlay/{matchId}` | Afzonderlijke leesweergaven voor gewone wedstrijden |
| Camera en apparaten | `/#camera` | Lokale camera- en microfoontest en demonstratie van een tweede apparaat |
| Evenementen | `/#events` | Overzicht van competitie, toernooi en geplande speeldagen |
| Competitie | `/#leagues` | Stand, fixtures, voorstellen, teams, uitnodigingen en uitslagen |
| Toernooizaal | `/#hall` | Toernooi kiezen en deelnemers, poules, knock-out, partijen of toernooikamer openen |
| Toernooibeheer | `/#tournaments` | Toernooi aanmaken, wijzigen, filteren en deelname aanvragen |
| Organisator | `/#dashboard`, `/#operations` en `/#manage` | Werkvoorraad, wedstrijdleiding en clubbeheer |
| Toernooiregie | `/#venue` | Regietafel van de gekozen speeldag |
| Speeldagdetail | `/#venue/entries`, `/#venue/boards` en `/#venue/schedule` | Inschrijving en check-in, bordbeheer, poules en schema |
| Bord en uitslag | `/#venue/board-B1` en `/#venue/result/{matchId}` | Schrijversscherm en controle van de uitslag |
| Baanmodus | `/#baan` | Eigen testbaan, QR, telefoonlinks en vaste baan bij Duindorp SV |
| Publieke baanscorekaart | `/#baan-screen/duindorp-baan-1` | 9:16-scherm van de vaste demonstratiebaan. Test en speel op een eigen `demo-{id}` |
| Telefoonscorekaart | `/#baan-phone/{boardId}` | Inloggen met demoprofiel, deelnemen, scoren of bevestigen. `?device=2` simuleert een tweede toestel in dezelfde browser |
| Schermstudio | `/#venue-cast/studio` | Voorvertoning, programma, scènes, uitgangen en camerabord |
| Zaal, publiek en OBS | `/#venue-cast/hall`, `/#venue-cast/public`, `/#venue-cast/board-B1` en `/#venue-cast/obs` | Afzonderlijke schermen met status, agenda, bordstand of programma-overlay |
| Verenigingen en kamers | `/#clubs`, `/#clubs/{idOfCode}`, `/#community` en `/#community/{idOfCode}` | Lid worden, clubactiviteiten, lidmaatschappen, chats en uitdagingen |
| Vrienden en beheer | `/#friends`, `/#players`, `/#registrations` en `/#reports` | Vriendschappen, profielen, aanvragen en meldingen |
| Statistiek en voorkeuren | `/#rankings`, `/#statistics` en `/#settings` | Ranglijsten, clubstatistieken en voorkeuren |

In de demo mogen `/#pools`, `/#knockout` en `/#matches` ook rechtstreeks worden geopend. Voor de stagingnavigatie blijven ze onder hun evenement of speeldag vallen. De demo-rolschakelaar wisselt de zichtbare werkruimte. Productierechten komen uit de serversessie en de rol binnen de betreffende club of speeldag.

## 3. Gedrag per onderdeel

### Spelen, Vandaag en agenda

- Vandaag hervat een lopende partij vóór een wachtkamer en laat een bevestigingsactie zien als die voor de speler openstaat.
- De agendalijst gebruikt de actieve club of het platform. Een agendalink opent de betreffende competitie, het programma of het gekozen toernooi in de juiste omgeving.
- Vrij spelen biedt vier opstellingen. Ieder vanuit huis, samen aan één bord, twee borden op locatie en club met thuis.
- De wachtkamer gebruikt een wedstrijdcode. Het gekozen speltype bepaalt de voorwaarden voor gereedmelding en controle van het bord. Tijdens de partij zijn beurtcontrole, checkouttips, scorecorrectie, pauze en hervatten aanwezig.
- De gewone wedstrijdkamer heeft lokale simulaties voor een tegenstander, netwerkonderbreking, chat en camerabeeld van de andere kant. De camera en microfoon van het eigen apparaat kunnen na toestemming lokaal worden bekeken.
- Mijn wedstrijden hoort in staging de bevestigde baanpartijen van hetzelfde account te tonen. Het prototype toont Baanmodus-historie apart via het baanprofiel.

### Gedeelde spelregels

- x01 ondersteunt 301, 501 en 701 met dubbel uit. De totale bezoekscore moet haalbaar zijn met het ingevoerde aantal darts. Geldige invoer en een finishbevestiging zijn aparte stappen als de eindscore nul wordt.
- Een overschrijding of resterende score van één leidt tot bust. De beginscore van het bezoek blijft staan en de beurt gaat verder volgens de wedstrijdvorm.
- Best-of eindigt zodra de winnende meerderheid is bereikt. Een wedstrijd van acht vaste legs telt alle acht legs en kan eindigen in 4–4. Een knock-outpartij vraagt een winnaar.
- De volgende leg start op het juiste x01-totaal en met de juiste startspeler. Een scorecorrectie herstelt de score, statistieken, beurt en leg- of setcontext van het bezoek.
- Een bevestigde uitslag mag één keer meetellen voor historie, ranglijst en evenementstand. Een betwiste uitslag vraagt beoordeling. De bestaande code bevat oefeningen en scorecorrecties die de scorehistorie intact houden.

### Training

- Solo 301, 501 of 701 en Dartbot gebruiken de x01-motor. Dartbot kiest legale bezoeken passend bij de oefenopstelling.
- Doubles around the board loopt van D1 tot en met bull. Per dubbel zijn drie darts beschikbaar.
- De 170-challenge heeft negen darts. De speler ziet het resultaat, het resterende totaal en de sessiehistorie.
- Trainingen krijgen eigen statistieken. De competitieve telling verwerkt uitsluitend bevestigde competitieve wedstrijden.
- De trainingshistorie en de demoverslagen worden nu lokaal bewaard.

### Competities en toernooien

- Een competitie gebruikt een speelschema met paren per speelronde. Inschrijven, een speeltijd voorstellen, akkoord geven, een wedstrijdkamer openen, teams samenstellen en een stand lezen zijn beschikbaar in de demo.
- Een fixture houdt zijn koppeling met de wedstrijdkamer. De speler kan dezelfde wedstrijd hervatten via Vandaag, de competitie of Mijn wedstrijden.
- De toernooizaal groepeert deelnemers, poules, knock-out, wedstrijdlijst en toernooikamer. Het prototype biedt expliciete simulatieacties om fasen te demonstreren.
- Deelname gaat langs de ingestelde openstelling, capaciteit en aanmeldregels. De aanmeldwerkvoorraad staat bij de relevante club of de platformomgeving.
- Bewaar de bestaande uitkomstregels en de volgorde van de tabel. Leg de tie-breakers vast bij het servermodel en test gelijke punten en legs. De knock-out krijgt uitsluitend bevestigde winnaars.

### Wedstrijdleiding op locatie

- Maak of kies een speeldag met capaciteit, toegankelijkheid, bordoproepduur, rust, cooldown, schrijverbeleid en verwachte eindtijd. Doorloop aanmelding, wachtlijst, check-in en gereedmelding.
- De regie houdt per bord bij of het vrij, gereserveerd, geblokkeerd of actief is. Een opdracht kan voor een bepaalde partij worden gereserveerd. Automatische of handmatige bordtoewijzing kiest een geschikte partij en controleert spelers, schrijver en beschikbaarheid.
- De beproefde statusroute is `waiting → called → playing → pending → confirmed`. Een oproep kan verlopen of opnieuw in de wachtrij komen. Een onopgeloste uitslag kan naar `disputed` en daarna naar `confirmed` via de bevoegde wedstrijdleiding.
- Wedstrijdleiding kan oproepen tijdelijk pauzeren, een no-show verwerken, het schema volgen en de correcte vervolgpartij zichtbaar maken. Het einde van de wedstrijd geeft het bord volgens de gekozen stroom vrij.
- Het lokale offlineprototype bewaart voor één partij score- en undo-acties in een sessiebuffer. Herstel speelt die acties geordend af als de basisversie gelijk is. Een gewijzigde zaalstand leidt tot een zichtbaar conflict met behoud van de bewaarde acties. De stagingpilot moet dit gedrag aantonen met een echte verbroken verbinding.

### Baanmodus en 9:16

- De huidige serverdemo gebruikt een gedeelde Worker/D1-opslag. Een scherm kan dezelfde baan volgen als twee telefoons. Lokale preview gebruikt SQLite. Het dashboardprofiel en het baanprofiel zijn in de referentie twee aparte demo-identiteiten.
- Open een eigen testbaan vanuit `/#baan`. Open het 9:16-scherm en scan de QR met beide telefoons. Open **Telefoon 1** en **Telefoon 2** voor een snelle demonstratie binnen één browser.
- Speler 1 kiest een modus. Voor een lokale partij gaat speler 2 naar dezelfde baan en accepteert. Bij een remote partij krijgt de host een uitnodiging. Een solo-oefening begint zonder tweede speler. De beschikbare wedstrijdinstellingen zijn 301, 501 of 701, 1, 3, 5, 7 of 9 legs en 1, 3 of 5 sets.
- Na aanvang kan de aangewezen schrijver de score invoeren. Speler 2 kan de schrijfrol overnemen en dezelfde partij met de actuele stand voortzetten. Gelijktijdige wijzigingen worden getoetst aan de revisie en ieder verzonden verzoek heeft een eigen actie-ID.
- De publieke kaart toont leg, set, actuele stand, laatste bezoeken en checkout. Het scherm heeft een wachtweergave, een actieve stand, een uitslag en een vrije baan. Zodra de actieve fase eindigt moet een volgende groep de QR kunnen gebruiken.
- Een geplande partij wordt door de organisator vanuit een opgeroepen of begonnen bord gekoppeld zolang er geen score is ingevoerd. In de huidige demo zet de eerste speler de wedstrijd klaar, bevestigt speler 2 de deelname en bevestigen beiden de uitslag op hun telefoon. De organisator drukt daarna op **Uitslag ophalen**. De lokale stand verwerkt die uitslag eenmaal.
- Staging koppelt het baanrecord aan dezelfde wedstrijd- en speler-ID's als het schema. Met de tweede bevestiging wordt de definitieve uitslag opgeslagen en komt die automatisch eenmaal in historie, stand en vervolgpartij. Houd het expliciete herstelpad voor een eerder mislukte verwerking beschikbaar voor de wedstrijdleiding.

### Schermstudio, community en beheer

- Schermstudio biedt een preview en een programma-uitgang, scène- en bordkeuze, uitzendingsoverlays, een zaaloverzicht, een publieksweergave met filters en een schrijverslink. Het prototype leest de lokale speeldag. Uitgangen over apparaten heen behoren tot de gedeelde serverstroom.
- Verenigingen hebben leden, rollen, aanvragen, capaciteit, uitnodigingen, nieuws, activiteiten en clubkamers. Een directe link naar een clubactiviteit opent de bijbehorende omgeving. De clubwissel houdt de rolwerkruimte vast.
- Openbare kamers, privékamers, clubkamers en toernooikamers hebben een bezettingslimiet. Een geaccepteerde uitdaging opent een lobby. Host en moderator kunnen dempen, verwijderen, verbannen en rollen beheren binnen hun eigen bevoegdheid.
- Vriendschappen kennen verzoek, acceptatie, verwijderen en blokkeren. Een geblokkeerde speler kan geen nieuwe rechtstreekse uitnodiging starten.
- Werkvoorraad, aanmeldingen, ranglijst, CSV-export, meldingen en voorkeuren hebben een demo-ingang. Valideer dat gepubliceerde cijfers op geautoriseerde resultaten rusten, dat een demoreset beperkt blijft tot demogegevens en dat export alleen data voor de toegestane omgeving meeneemt.

## 4. Scope voor een eerste serverpilot

| Volgorde | Opleveren | Resultaat van de controle |
| --- | --- | --- |
| P0 | Staging-identiteit met OTP of Google, clubcontext en serverrechten | Eén account op dashboard en telefoon. Een directe URL of handmatig verzoek kan de club-, speler- of schrijfrechten niet omzeilen |
| P0 | Eén speeldag bij Duindorp SV, twee spelers, één baan en een publiek scherm | Van inschrijving en check-in naar oproep, QR, eerste bezoek, schrijverovername en bevestigde uitslag |
| P0 | Canonieke wedstrijd en idempotente uitslagstroom | Herhaalde acties, uitval, tabverversing en een handmatige herstelactie leiden tot één definitief resultaat |
| P0 | Dashboard op mobiel en desktop | Actieknoppen, formulierfouten, instellingen, tabbladen, scorekaart en wachtrij blijven bereikbaar |
| P1 | Gedeelde gewone wedstrijdkamers, competities, toernooien en clubbeheer | Geautoriseerde acties en dezelfde planning op meerdere apparaten. De bestaande workflow en rekenregels blijven controleerbaar |
| P1 | Schermstudio, publieke uitgangen en meerdere gelijktijdige speeldagen | Een scherm volgt uitsluitend zijn uitgegeven speeldag of baan. Beheer en preview blijven afgeschermd |
| P2 | Gedeelde aanwezigheid, chat, moderatie en eventueel extern beeld | Bewijs deze functies met echte clients en toon wachttijd, offline of geweigerde toegang expliciet |

Maak twee testverenigingen met afgescheiden clubgegevens. Gebruik minimaal een organisator, twee spelers, een speler van de andere club en een niet-ingelogde kijker. Gebruik aparte browserprofielen of fysieke apparaten zodat tabopslag geen account- of synchronisatieproblemen maskeert. Gebruik de vaste publieke prototypebaan uitsluitend als visuele referentie.

## 5. Acceptatiekaart voor de pilot

| ID | Uitvoeren | Verwacht resultaat |
| --- | --- | --- |
| A01 | Inloggen via e-mail-OTP en Google met testaccounts. Herladen, uitloggen, een verlopen of al gebruikte code testen en een geweigerde providerstroom afbreken | Geldige sessies bereiken de juiste rol. Een fout geeft herstel zonder ongewenste sessie. De identiteit voor baan en dashboard is dezelfde |
| A02 | Wissel club A naar club B en vervolgens platform. Open daarnaast een oude link naar een evenement van club A | Acties en zichtbare gegevens volgen de juiste club of platformscope. De rolwerkruimte blijft passend bij de gebruiker. Onbevoegde directe toegang wordt geweigerd |
| A03 | Vul een speeldag tot de limiet, schrijf een extra speler in, laat een speler terugtrekken en check in bij de speeldag | De extra speler gaat naar de wachtlijst. Bij een vrije plaats volgt promotie volgens de wachtrij. Check-in en gereedmelding werken één keer per speler |
| A04 | Blokkeer een bord, reserveer een tweede bord en plan een geschikte partij. Laat een oproep verlopen en probeer twee borden aan dezelfde partij toe te wijzen | Het systeem respecteert blokkade, reservering, rust en aanwezigheid. Een verlopen oproep krijgt een duidelijke vervolgstatus. Er ontstaat geen dubbele toewijzing |
| A05 | Koppel vóór de eerste worp een eigen live baan, scan op twee toestellen en laat een derde toestel proberen mee te doen | Beide toegewezen spelers landen in dezelfde wedstrijd. Het derde toestel krijgt alleen het toegestane kijkpad. De publieke weergave bevat uitsluitend vrijgegeven scorekaartvelden |
| A06 | Voer op 501 een bezoek van 180 in, laat de andere speler de beurt doen en laat daarna de score-invoer overnemen | Het scherm en beide telefoons tonen dezelfde revisie en 321 na het eerste bezoek. Alleen de actuele schrijver kan de volgende mutatie plaatsen |
| A07 | Simuleer een gelijktijdige score en schrijverovername met dezelfde basisrevisie. Stuur een actie opnieuw met dezelfde ID en probeer daarna te scoren tegen een oude revisie | Er wordt hoogstens één geldige mutatie verwerkt. De andere client kan verversen en doorgaan. Een herhaling geeft dezelfde eerder verwerkte uitkomst |
| A08 | Geef op restscore 40 een score van 39 op, maak daarna D20 met expliciete bevestiging en test een undo voordat de uitslag definitief is | Restscore één veroorzaakt bust. D20 rondt de leg pas na bevestiging af. Undo herstelt de stand, beurt, bezoektabel en statistieken |
| A09 | Laat bij een geplande partij eerst speler 1 en daarna speler 2 de uitslag bevestigen. Herhaal de laatste actie en ververs alle clients | Eén bevestiging blijft in afwachting. Na de tweede verschijnt één uitslag in beide histories, in de stand en in het schema. De vervolgpartij wordt precies één keer bepaald |
| A10 | Onderbreek de internetverbinding van de schrijver na een aantal bezoeken. Herstel eerst zonder en daarna met een concurrerende scorewijziging | De interface toont offline of herstel. Beurten gaan niet verloren en worden nooit dubbel geteld. Een afwijkende basisversie vraagt om zichtbare afhandeling |
| A11 | Controleer regulier 301, 501 en 701, best-of, vaste acht legs met 4–4, meerdere sets en een knock-out met een betwiste uitslag | Spelregels, beurtwisseling, bevestiging en finale standen geven dezelfde uitkomsten als de reken- en domeintests |
| A12 | Open het publieksscherm, de agenda, clubbeheer, de mobiele navigatie, de grootste formulieren en de telefooninvoer op 320, 360, 390, 768 en desktop. Open de baanweergave ook in 9:16 | De pagina kan normaal verticaal scrollen. Brede tabellen scrollen binnen hun eigen paneel. Formuliervelden, fouttekst en primaire actie blijven bereikbaar bij een geopend schermtoetsenbord |
| A13 | Wissel op mobiel tussen Vandaag, Spelen, Baanmodus, Evenementen en Werkvoorraad. Herhaal met een lege en een volle agenda | Actieve navigatie, context en inhoud kloppen. Paarkaarten delen de buitenranden waar er plaats is. Op smalle schermen volgen kaarten in leesvolgorde onder elkaar |
| A14 | Gebruik een ongeldig, verlopen of aangepast baan-ID en heropen een gedeelde link na afloop | Ongeldige of verlopen toegang geeft een veilige, bruikbare terugroute. Een nieuwe groep krijgt een vrije baan zodra die volgens de regels wordt vrijgegeven |

## 6. Codekaart en regressiecontrole

| Gebied | Startbestand in de referentie |
| --- | --- |
| Shell, rol, routes en demo-opslag | `public/app.js`, `public/navigation.js` en `public/navigation.css` |
| Vandaag en dashboards | `public/player-dashboard.js`, `public/dashboard-hubs.js`, `public/organizer-workspace.js` en `public/workspace.css` |
| Vrij spelen, scoring en training | `public/rooms.js`, `public/scoring.js`, `public/training.js` en `public/play.css` |
| Competities, club en community | `public/competitions.js`, `public/clubs.js`, `public/community.js` en `public/portal.js` |
| Regietafel en lokale buffer | `public/venue.js`, `public/venue-engine.js` en `public/venue-offline.js` |
| Schermstudio en overlays | `public/venue-cast.js` en `public/venue.css` |
| Gedeelde baanschermen en API | `public/baan.js`, `public/baan-phone.js`, `public/baan-screen.js`, `public/baan.css`, `public/baan-phone.css`, `worker/baan-api.js`, `worker/baan-domain.js` en `worker/index.js` |
| Lokale en gedeelde opslag | `scripts/dev.mjs`, `scripts/baan-dev-db.mjs` en `drizzle/0000_baanmodus.sql` |

De referentie-API heeft `POST /api/baan/profile` voor het demoprofiel, `GET /api/baan/{boardId}` voor de zichtbare stand, `POST /api/baan/{boardId}` voor een baanactie en `GET /api/baan/qr/{boardId}` voor de QR. Deze routes maken de huidige werkende demonstratie reproduceerbaar. De account- en sessielaag voor staging komt uit de nieuwe inlogstroom.

Voer `npm test` uit op de meegeleverde referentie vóór het overnemen van domeinlogica. Bewaar de testgevallen bij migratie, in het bijzonder scorevalidatie, leg- en setovergang, writer takeover, revisieconflicten, herhaalde verzoeken, scope, moderatie en de eenmalige verwerking van een bevestigde uitslag. Draai daarnaast de build van de nieuwe app en voer de P0-acceptatiekaart uit op de staging-URL. Noteer commit, apparaten, testrollen, uitgevoerde scenario-ID's en uitkomsten. Gebruik afbeeldingen van de referentie om de vormgeving te beoordelen en beoordeel de werking aan de hand van de uitgevoerde scenario's.
