# Interne clubcompetities

De zesstappenwizard publiceert bestaande DartFlow-seizoenen. De landelijke en oudere seizoensroutes blijven beschikbaar; wedstrijd-ID's, score-engine, bevestiging, correctie en rankingregels worden hergebruikt.

## Rechten en locaties

`competitions.manage` geeft toegang tot de eigen clubwizard. Een concept houdt één vaste vereniging en wordt alleen door actuele competitiebeheerders gelezen of gewijzigd. Kopiëren naar een andere vereniging vereist expliciet beheerrecht op beide verenigingen en wist de oude speler-, team- en baanselectie.

Een fysieke locatiebeheerder verleent apart `planning.grant`, met concrete banen, weekvensters en eventuele geldigheidsgrenzen. Alleen die beheerder kan de koppeling wijzigen of intrekken. Dezelfde eigenaar, een oud bezoek of een bestaande clubbaan maakt geen automatische koppeling. De competitieplanner krijgt hiermee geen apparaat- of locatiebeheer. Een locatiebeheerder die geen competitieleider is, ontvangt geen private leden of concepten.

## Contract

- `GET /api/competition-wizard/:clubId` levert `CompetitionWizardContext` uit `lib/competition-wizard-types.ts`: actuele leden/teams, toegestane locaties/banen, eigen fysieke beheerlocaties en opgeslagen concepten.
- `POST /api/competition-wizard` ontvangt `{requestId, action}`. Acties zijn `wizard.save`, `wizard.copy`, `wizard.preview`, `wizard.publish`, `planning.grant` en `planning.revoke`.
- Opslaan gebruikt een UUID, `expectedRevision`, `step` (1–6) en versie-1-configuratie. De eerste opslag accepteert een vooraf gekozen UUID met revisie 0. Een oude revisie overschrijft geen ander toestel.
- Preview gebruikt het opgeslagen concept. `issues` blokkeren; `warnings` hebben een code die de gebruiker bij publicatie expliciet bevestigt. Elke melding bevat een stap en veldpad. `configurationHash` hoort bij de opgeslagen configuratie.
- Publicatie gebruikt dezelfde aanvraag-ID bij herstel na een verloren antwoord. Een receipt herstelt de succesvolle uitkomst, met opnieuw gecontroleerd actueel beheerrecht. Een hergebruikte aanvraag met andere inhoud wordt geweigerd.

De nieuwe wizard ondersteunt 2–32 entries: individuele spelers, vaste koppels of eigen teams in iedereen-tegen-iedereen; individuele spelers ook in knock-out. Deze expliciete grens beperkt de omvang van de complete, gedeelde web/Android-roosterrespons. Bestaande seizoenscapaciteiten veranderen niet. Teams en koppels komen uit actieve eigen Clubhouse-teams. De wizard bewaart het volledige roster inclusief apart gemarkeerde reserves; publicatie controleert de bron en ieder actief lid opnieuw.

## Planning en publicatie

Het rooster gebruikt de bestaande Berger-indeling. Een oneven aantal geeft een zichtbare vrijronde, zonder wedstrijd of punten. Heen en terug keert iedere echte ontmoeting om. De planner verdeelt daadwerkelijke fixtures over alleen de gekozen banen, speeldagen, pauzes en uitgesloten datums. Een te korte periode blokkeert publicatie.

IANA-tijdzones, standaard `Europe/Amsterdam`, bepalen UTC-tijdstippen. Niet-bestaande lokale tijden worden geweigerd. Een dubbele wintertijd vereist voor het betreffende lokale begin- of eindtijdstip een expliciete geldige offset; deze staat in de gepubliceerde configuratie. Agenda en meldingen gebruiken dezelfde canonical UTC-fixtures.

Preview reserveert niets. Publicatie hercontroleert onder locks: clubbeheer, account/lidmaatschap, eigen teams, actuele expliciete locatiekoppelingen, actieve banen, openingsvensters, bestaande boekingen en gelijktijdige spelersinzet. SeasonState, het echte centrale event, fixtures, roster/reglement, fysieke reserveringen en meldingsgebeurtenissen worden in één transactie vastgelegd. Er blijven bij een fout geen gedeeltelijke competitie of boekingen achter. Fysieke boekingstriggers beschermen ook de bestaande reserveringsroute tegen overlap bij accepteren of wijzigen; pending aanvragen mogen elkaar blijven overlappen.

Het gepubliceerde concept is immutable. Latere bronteam- of lidmaatschapswijzigingen wissen de competitiesnapshot en gespeelde historie niet. Een gemotiveerde `season.fixture`-herplanning controleert de actuele planningsscope en conflicten opnieuw, behoudt fixture-ID en oude boekingsversie, en schrijft een nieuwe boeking en auditbeslissing. Gestarte partijen blijven onder de bestaande onderbreek-/hervatprocedure vallen.

Alleen ronde 1 staat aanvankelijk open. Bij handmatige voortgang geeft leiding volgende rondes expliciet vrij. Automatische voortgang vereist definitieve voorafgaande resultaten; een heropende bron sluit afhankelijke latere rondes opnieuw. Scores leveren pas na de bestaande bevestigingen een definitieve stand op. Wizardpublicatie zelf boekt geen ratingpunten.

## Lokale verificatie

`tests/competition-wizard.test.ts` controleert onder meer oneven aantallen, heen/terug, concrete capaciteit, pauzes, DST, toekomstige knock-outfixtures en daadwerkelijke tiebreakberekening. `tests/competition-wizard-db.test.ts` gebruikt alleen eigen loopback-fixtures en de beperkte runtime-rol voor echte concept-, scope-, publicatie-, race-, boekings-, score-, undo-, bevestigings- en correctieflows. Browserbediening, Androiduitvoering en daadwerkelijke hosted release worden afzonderlijk bewezen.

## Gedeelde schermen en privacy

Een fysieke locatiebeheerder kan in Schermen expliciet een gepubliceerde premium-clubstijl kiezen. De keuzelijst bevat alleen actieve clubs met een effectieve premiumperiode en een actuele expliciete planningskoppeling aan die locatie. Een clubrol, persoonlijke themavoorkeur of dezelfde eigenaar maakt geen schermrecht. Thuisschermen gebruiken de bestaande schermstijlen.

De bestaande deviceactie `theme` accepteert hiervoor `theme:'club'` en `clubId`. De opgeslagen keuze blijft behouden bij tijdelijke intrekking, terwijl elk publiek schermbericht opnieuw de locatiekoppeling, clubstatus, publicatie en premiumperiode controleert. Bij ongeldigheid volgt standaard DartFlow. Het publieke themapakket bevat uitsluitend de clubnaam, het veilige logo, de brandingrevision en semantische lichte/donkere kleuren. Het bevat geen accountgegevens, persoonlijke voorkeur of club-ID. `validUntil` begrenst offline gebruik tot maximaal vijf minuten en tot een eerdere grant- of premiumeinddatum. Standaard- of catalogusstijl kiezen wist de opgeslagen clubkeuze.

De bestaande bevestigde accountwisprocedure verwijdert ook eigen kanaalinhoud, feedbijlagen, polls/stemmen, thema-/agendatoegang, ongepubliceerde eigen wizardconcepten en bijbehorende herstelreceipts. De worker moet eerst de bestaande exacte joblease aantonen. Alleen een wisaanvraag vernietigt deze inhoud nog niet. Gedeeld clubeigendom, branding, gepubliceerde competitieconfiguratie en officiële uitslag-ID's blijven behouden; de bestaande verwerking anonimiseert persoonslabels op basis van vaste IDs. De beperkte webrol kan de privileged cleanup niet rechtstreeks uitvoeren.

`tests/clubhouse-privacy-db.test.ts` controleert de echte geleasede wisprocedure, behoud van gedeelde bronnen en een andere speler met dezelfde displaynaam. `tests/oche-club-branding-db.test.ts` controleert actuele fysieke autorisatie, expliciete selectie, idempotentie, publicatie, intrekking, herstel en het publieke pakket zonder privé-identiteit.

## Korte beheerroute

1. Een platformbeheerder opent **Premiumrechten** (`/app/premium`) en kent de bedoelde vereniging een begin- en eindtijd toe. Dit registreert `association.branding.global`; het maakt geen betaling, abonnement of contributie aan. Intrekken stopt de effectieve uitstraling, met behoud van het ontwerp.
2. De clubeigenaar of expliciete `branding.manage`-beheerder opent **Verenigingsbeheer → Clubhuisstijl**, kiest primaire/secundaire kleur en veilig logo, bekijkt licht/donker en kiest **Ontwerp opslaan**. Pas **Publiceren** verandert de gedeelde stijl; daarvoor moet premium op dat moment effectief zijn.
3. De speler kiest in de persoonlijke weergavevoorkeur **Standaard DartFlow**, **Automatisch bij één beschikbare vereniging** of één expliciete beschikbare club. De voorkeur wordt op de server bewaard. Bij meerdere clubs kiest automatisch geen willekeurige club. De expliciete clubpagina gebruikt haar eigen geschikte stijl; verlies van lidmaatschap of premium valt veilig terug.
4. De fysieke locatiebeheerder verleent in **Locaties & banen** apart planningstoegang aan de bedoelde club: concrete banen, weekdagen/tijdvensters en een reden. De competitieleider gebruikt daarna uitsluitend die actuele selectie in de wizard. Deze koppeling geeft geen locatie- of schermbeheerrecht; intrekken vóór publicatie blokkeert de publicatie zonder het concept te wissen.
5. Voor een gedeeld Oche-scherm kiest de fysieke beheerder in **Schermen** expliciet een beschikbare gepubliceerde clubstijl. Persoonlijke voorkeuren kleuren dat scherm nooit. Controleer na wijzigen of intrekken het publieke schermbericht; een offline pakket vervalt uiterlijk na vijf minuten.

Een beheerder die een revisionconflict ziet, laadt de actuele versie of maakt bewust een kopie. Gebruik bij een verloren publicatieantwoord hetzelfde bewaarde verzoek; maak niet een tweede competitie aan. Een gepubliceerde configuratie blijft historische bron: wijzig een geplande fixture via gemotiveerde herplanning, en behandel gestarte partijen via de bestaande onderbreek-/hervat- en correctieprocedure.
