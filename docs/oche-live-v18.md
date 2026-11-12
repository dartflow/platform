# Oche Live en unieke gebruikersnamen

Deze wijziging bouwt door op de bestaande Next-app, vaste fysieke banen, spelerstoegang, wedstrijdverwerking en DG Webservices-releaseflow. Het schermontwerp gebruikt de officiële logo’s en de fonts uit de opgegeven Oche Live-demo. Voorbeeldscores zijn uitsluitend testdata.

## Openen en bedienen

- Open **Locaties & banen** op `/app/locations`. Bij een baan staan de effectieve status, actieve partij, gekoppelde banen en geldende reservering.
- **Open Oche Live** opent `/baanscherm/<onveranderlijk-baan-ID>`. De bestaande alias `/oche-live/<baan-ID>/` en het eigen baanmanifest blijven werken. De vaste spelers-QR opent `/baan/<baan-ID>`.
- Een open, vrije en publiek scanbare baan draait de drie slides van **5, 10 en 15 seconden**. Bij een lobby, partij, reservering of sluiting volgt direct de bijbehorende weergave. Terug naar een open vrije baan begint weer bij slide 1.
- Gebruik het installatie-icoon in de schermbediening om deze baan toe te voegen aan het beginscherm. Een afgeschermd scherm koppelt de leiding eenmalig via de bestaande **Scherm koppelen**-functie. De openbare weergave is alleen-lezen; alleen een geldig gekoppeld apparaat kan tijdens een waarschuwing Doorspelen gebruiken.
- De telefoon opent bij een actieve partij de bestaande schermvullende scoreconsole. **Terug** bewaart de partij. Bij thuis/hybride voert iedere speler zijn eigen beurt in; lokaal blijft de schrijverflow gelden.

De bestaande [installatiehandleiding voor spelers en baanschermen](installatie-speler-en-baanschermen.md) beschrijft ook de apparaattoegang, alternatieve beginschermsnelkoppeling, offlinegedrag, wakker houden en kioskstart na stroomuitval.

## Liggend Cast-signaal op een verticaal scherm

De vaste routes `/oche-live/<baan-ID>/` en `/baanscherm/<baan-ID>` draaien het complete baanscherm direct bij laden **90° rechtsom**. Bij een signaal van 1920×1080 wordt de inhoud eerst in een vlak van **1080×1920** opgebouwd en daarna gedraaid naar alle vier de randen van het signaal. Stand-byslides, beide QR’s, live scorekaart, meldingen en bediening gebruiken dezelfde container. Fullscreen verandert deze oriëntatie niet. De spelersroute, bestaande token-/toeschouwerschermen en de algemene `/scorebord`-fallback behouden hun eigen weergave.

Het downloadpictogram staat in de footer en heet **Installeer dit baanscherm**. In een gewone browser blijft het ook in fullscreen zichtbaar. De browser opent zijn native installatievenster als dat beschikbaar is; anders verschijnen de beginscherminstructies en de vaste baanlink. In een reeds zelfstandig gestarte PWA blijft de installatieknop verborgen. De installatie-ID, start-URL en baanbinding zijn ongewijzigd.

De Oche Live-QR gebruikt een bron van 1024×1024 pixels met vier modules vrije rand. Het automatisch scrollen van de scorekaart gebruikt de logische, ongedraaide coördinaten zodat ook een zesde en volgende beurt na rotatie in beeld komen. De browserproeven bewijzen de geometrie en de softwarematige QR-weergave; een echte Chromecast en de fysieke montage zijn niet vanuit de worker bediend.

## De vier beheeracties

**Openen** laat nieuwe partijen toe zodra de baan vrij is en de reservering dat toestaat. **Reserveren** opent de bestaande aanvraag met locatie en voorkeursbaan geselecteerd; de bestaande organisatierechten, UTC-tijdvakken, goedkeuring en capaciteit blijven gelden.

**Sluiten** blokkeert nieuwe partijen. Een lopende partij mag uitspelen; beheer toont de geplande sluiting. Een vrije baan of nog niet gestarte wachtlobby wordt direct gesloten. **Geforceerd vrijgeven** vraagt de baannaam, de huidige partij, een reden en bij remote spel bevestiging van de gevolgen voor beide banen. Een oude bevestiging kan een volgende partij niet vrijgeven.

## Inactiviteit

De server bewaart één tijdlijn voor de wedstrijd en alle gekoppelde fysieke banen. Na 120 seconden zonder geaccepteerde worp verschijnt een aftelling van 60 seconden op Oche Live en de telefoons. De score-invoer blijft bereikbaar. **Doorspelen** begint opnieuw met 120 seconden; er zijn maximaal twee gezamenlijke verlengingen per wedstrijd. Een geldige worp, ook nul of bust, begint een nieuwe termijn. Refresh, undo, correcties en dubbele aanvragen doen dat niet.

Vanaf de absolute deadline van 180 seconden weigert de server verdere scores en verlengingen voor die sessie. De eerstvolgende succesvolle workertick of bewaakte aanvraag verwerkt de vrijgave. Een afgebroken vrije partij verliest de voorlopige scores en telt niet mee in historie, statistieken of uitslagen. Een officiële partij wordt onderbroken: voortgang en schema blijven bewaard. De leiding kan de partij via de bestaande wedstrijdpagina opnieuw oproepen, waarna beide spelers weer akkoord geven.

De serverworker verwerkt verlopen sessies ook zonder geopende telefoons of schermen. Een herstart gebruikt dezelfde opgeslagen deadline. De job draait per seconde; een latere uitvoering verlengt de deadline niet. Score, verlenging en vrijgave vergrendelen dezelfde actuele toewijzing en controleren servertijd binnen de transactie.

## Gebruikersnamen

**Naam op het scorebord** heet nu **Gebruikersnaam**. De naam is uniek onder alle spelers in dezelfde DartFlow-omgeving, ongeacht vereniging. Hoofdletters, herhaalde witruimte en canoniek equivalente Unicode leveren geen tweede claim op. Namen met spaties en internationale letters blijven ondersteund; de bestaande grens van 80 tekens blijft gelden.

Een unieke database-index voorkomt dubbele claims bij gelijktijdig registreren. De API antwoordt bij een bezette naam met `username_taken` en HTTP 409. Namen van Google blijven een voorstel dat de speler moet bevestigen. Bestaande conflicterende of ongeldige namen worden uitsluitend onbevestigd gemaakt; account-ID, opgeslagen naam, historie en rechten blijven behouden. Vóór spelen moet de speler een unieke naam bevestigen. Gepubliceerde uitslagen blijven hun oorspronkelijke snapshot houden. Staging en productie behouden hun afzonderlijke databases.

## Lokaal uitvoeren

De lokale preview luistert op **127.0.0.1:3000 op de dev-VPS**. Gebruik de browserpreview van de VPS of stuur die poort door via SSH. Na een portforward naar poort 3000 zijn deze vaste voorbeelden beschikbaar:

| Baan | Oche Live | Spelers-QR / telefoon |
| --- | --- | --- |
| Baan 04 | [Baanscherm](http://localhost:3000/baanscherm/0d68f40f-ef9e-48cc-bea0-1d85f5342a27) | [Open de baan](http://localhost:3000/baan/0d68f40f-ef9e-48cc-bea0-1d85f5342a27) |
| Baan 05 | [Baanscherm](http://localhost:3000/baanscherm/43f036ae-bbaa-4505-88c8-a8b740c65920) | [Open de baan](http://localhost:3000/baan/43f036ae-bbaa-4505-88c8-a8b740c65920) |

Deze banen staan bij **Oche Live · lokale acceptatie**. Het lokale testaccount **Danny Goldenbelt** kan ze beheren via `/app/locations`. Op Baan 04 is de echte voorbeeldpartij 148–188 aangemaakt en de worp 60 → 88 gevolgd door undo gecontroleerd. Dit is een gewone actieve sessie: na 180 seconden zonder worp verloopt de voorbeeldpartij en keert de baan terug naar de slides. De vaste links blijven geldig; start via de telefoonlink een nieuwe partij.

Gebruik de bestaande lokale configuratie en loopbackdatabase:

```sh
npm run db:start
npm run db:migrate
DARTFLOW_BOARD_ACTIVITY_WORKER=1 npm run dev
```

De twee aanvullende migraties zijn `20261112183944_board_activity_sessions.sql` en `20261112184741_globally_unique_usernames.sql`. Ze ondersteunen bestaande actieve partijen met één gecontroleerde overgangstermijn. Herhaald uitvoeren geeft bestaande sessies geen extra tijd. Readiness vereist beide nieuwe featuremarkers.

Bij de lokale productiepreview (`npm run build` gevolgd door `npm run start`) start de worker automatisch. Zonder webserver kan `npx tsx scripts/board-activity-worker.ts` de lokale baanjob uitvoeren. Gebruik tijdens tests met een gestuurde databaseklok geen tweede worker.

De normale release blijft de bestaande native DG Webservices-flow volgen, inclusief migraties, build, readiness en omgevingsscheiding. Er zijn geen nieuwe secrets nodig voor deze wijziging. De geïsoleerde lokale acceptatie en eventuele apparaatbeperkingen staan in het [testverslag](oche-live-v18-tests.md).
