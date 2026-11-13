# Oche Live in de browser

## Openen en koppelen

Open `https://dartflow.nl/oche-live` op het doelscherm. Voor de stagingomgeving gebruik je `https://staging.dartflow.nl/oche-live`. De zelfstandige browserweergave vraagt geen spelerslogin op het doelscherm. Een eerder gekoppeld browserprofiel herstelt de toegewezen stand via zijn beperkte schermcookie.

Een nieuw scherm toont **Koppel dit scherm**, een code met acht Crockford Base32-tekens in twee groepen en een QR-code. De code is tien minuten geldig. De QR verwijst naar `/koppel-scherm#code=…` en bevat uitsluitend de tijdelijke gebruikerscode. Deze koppel-QR heeft een ander doel dan de vaste speel-QR van een baan.

1. Scan de koppel-QR met je telefoon, of open **Schermen → Koppel scherm** in DartFlow en typ de code.
2. Log zo nodig in met de bestaande Google- of e-mailflow. De bevestigingspagina verwijdert het fragment direct. Tijdens het inloggen bewaart alleen dit tabblad de openbare, tijdelijke code; de login-URL bevat geen code.
3. Kies **Mijn scherm thuis** of een locatie waarvoor je schermbeheer hebt. Geef het scherm een herkenbare naam. Voor een locatie kies je nu een bestaande baan of wijs je die later toe.
4. Vink de expliciete bevestiging aan en kies **Dit scherm koppelen**. De QR openen alleen koppelt nog niets.
5. Het doelscherm haalt zelf zijn leesrechten op. Een thuisscherm zonder geselecteerde sessie en een locatiescherm zonder baan tonen een wachtstatus.

**Nieuwe code** trekt de vorige code in. Andere tabbladen van hetzelfde browserprofiel nemen de actuele code over en maken geen extra installatie aan. Cookies zijn nodig voor herstel. Een privévenster, gewiste browserdata of een ander browserprofiel kan als nieuw scherm worden gezien; vervang dan zo nodig de eerdere installatie expliciet.

## Schermen beheren

Open `/app/schermen` met je eigen DartFlow-account. Hier staan de naam, het platform, de toewijzing, de laatste activiteit en online/offline-status. Je kunt een scherm hernoemen, een locatiescherm een andere baan geven of de toegang intrekken. **Vervangen** opent de koppelflow, waar je het bestaande scherm expliciet aanwijst.

Een thuisaccount heeft één schermplek. Kies onder **Mijn scherm thuis** zelf de eigen wedstrijd, lobby of oefensessie die het thuisscherm volgt. Deelname aan een wedstrijd verleent geen locatiebeheer. Op het thuisscherm wordt geen fictieve fysieke baan-QR gemaakt.

Een fysieke locatie heeft standaard twee schermplekken. Android-installaties en browserprofielen delen deze capaciteit. Een offline scherm houdt zijn plek. Bevoegde centrale beheerders kunnen het maximum per locatie als positief geheel getal wijzigen. Bij verlaging onder het actieve aantal toont de UI **Boven limiet**; nieuwe koppelingen en vervanging zijn dan geblokkeerd totdat voldoende schermen zijn ontkoppeld.

Voor nieuwe schermregistraties blijft bij expliciete vervanging het oude scherm werken totdat het nieuwe scherm de bevestigde koppeling daadwerkelijk inwisselt. De server wisselt beide dan atomair om. Herhalen van dezelfde handeling behoudt dezelfde aanvraagidentiteit.

## Oudere baanschermkoppelingen

Het onderdeel **Bestaande baanschermkoppelingen** toont nog geldige registraties uit het eerdere baangebonden model. Die tellen mee voor de capaciteit. Laat deze bestaan als de oude opstelling nog moet blijven draaien. Voor overgang naar het nieuwe model ontkoppel je de oude koppeling expliciet en koppel je daarna via de nieuwe code. Deze overgang gebruikt twee bewuste stappen; de atomische vervanging hierboven geldt voor registraties van het nieuwe model.

De vaste openbare baanroute, speel-QR en bestaande routes onder `/oche-live/<baanId>/` blijven beschikbaar. De bestaande Chromecast-route behoudt zijn ingestelde rotatie. De nieuwe korte route `/oche-live` gebruikt de werkelijke oriëntatie: liggend op een 16:9-scherm en staand op een portretscherm. De fullscreenknop gebruikt dezelfde weergave.

## Alleen lezen en verbinding herstellen

Het generieke scherm kan niet scoren, geen account beheren en geen inactiviteitsverlenging geven. Bij de bestaande waarschuwing staat **Tik op Doorspelen op je telefoon**. De geautoriseerde spelers- en oudere bevoegde baaninterfaces houden hun bestaande bediening.

De browser haalt iedere twee seconden de geautoriseerde actuele projectie op. De server controleert de grant bij elke aanvraag. Bij bereikbare intrekking verdwijnt de eerder ontvangen private stand binnen het afgesproken venster van vijf seconden. Bij netwerkverlies blijft alleen de laatst ontvangen stand in het geheugen zichtbaar, met een offline-aanduiding. De stand wordt niet in clientopslag of een serviceworkercache bewaard. Herstel en terugkeer naar de voorgrond halen de actuele toewijzing en stand opnieuw op; de baan kan ondertussen een andere partij hebben gekregen.

Webtoegang en refresh zijn HttpOnly-cookies. JavaScript bewaart alleen openbare coördinatiegegevens en willekeurige aanvraagnonces, geen installatiegeheim of toegangstoken. De refreshnonce blijft beschikbaar totdat het rotatieantwoord is bevestigd, zodat ook na een verloren antwoord en een paginaherstart dezelfde serverontvangst kan worden hervat. Tabs serialiseren installatie en refresh op browserprofielniveau.

Waar beschikbaar vraagt de browser een scherm-wakkerhouder aan. De browser of het besturingssysteem kan dit weigeren of onderbreken. Automatisch openen na een stroomonderbreking moet op het vaste apparaat via zijn eigen kiosk- of opstartinstellingen worden ingericht met de exacte `/oche-live`-URL. Een gekoppeld browserprofiel moet daarbij behouden blijven.

## Lokale verificatie op 13 november 2026

`tests/e2e/oche-device.spec.ts` gebruikt uitsluitend loopback, de bestaande lokale testaccounts **Michael de Groot** en **Danny Goldenbelt**, en geïsoleerde lokale schermen, locatie en oefenpartij. De tests bewaren geen externe accountgegevens en voeren geen hosted schrijfacties uit.

- Twee gelijktijdig geopende tabbladen maken één installatie. Nieuwe code wordt in beide zichtbaar; de eerdere code wordt geweigerd.
- QR-fragment wordt direct verwijderd, overleeft de bestaande login via tabbladopslag en vereist daarna expliciete bevestiging. Een volgende QR op dezelfde bevestigingspagina opent een nieuw formulier.
- Een server-gecommitteerd inwisselantwoord wordt bewust verloren. Herhalen herstelt dezelfde schermregistratie zonder tweede capaciteitsslot.
- Een server-gecommitteerd refreshantwoord en de nieuwe cookies worden bewust verloren. Na pagina herladen wordt dezelfde openbare nonce gebruikt en dezelfde grant hersteld.
- Een geselecteerde eigen solo-501 volgt 180 en 60, de 180-animatie, offline laatste stand, reconnect en herstart zonder een oude animatie opnieuw af te spelen. Hernoemen werkt; intrekking wist de private scoreweergave binnen vijf seconden. Daarna kan een nieuwe code worden gemaakt en na herladen hersteld.
- Locatiekoppeling met en zonder baan, maximum twee, centrale verhoging naar drie, verlaging naar twee met **Boven limiet**, blokkade van nieuwe koppelingen en expliciete vervanging bij geldige volle capaciteit zijn in de echte lokale UI gecontroleerd.
- Een afzonderlijke lokale versie-1-renderfixture controleert 1920×1080, 1080×1920, 720×1280 en 390×844, vijf scorekaartrijen, geen horizontale overloop, een volledig zichtbare scorekaart, een uitsluitend lezende waarschuwing en het wissen van de stand na intrekking. Dit is een rendercontrole met testdata, geen hardwaretest.

De screenshots en geometrie staan in `artifacts/oche-device-web/`. De pure tests in `tests/oche-device-client.test.ts` controleren normalisatie en validatie van codes, het wissen van het QR-fragment vóór opslag/navigatie, en capaciteit/overlimiet-selectie. De backend heeft afzonderlijke transactionele en autorisatietests.

Echte Android TV-/Google TV-afstandsbediening, Play-installatie/App Links, update van een eerder geïnstalleerde native build, iOS-beginschermgedrag en hervatten na stroomuitval moeten op de betreffende apparaten worden gecontroleerd. Deze browsercontroles vormen daarvoor geen vervanging. Release-SHA, staging-/productiestatus en de complete testuitvoer worden in het overkoepelende opleverrapport vastgelegd.
