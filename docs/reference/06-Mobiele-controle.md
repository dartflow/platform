# Mobiele controle en voorbeelden

Dartflow gebruikt een gestapelde opmaak op smalle schermen. Koppen en knopgroepen mogen omlopen, formulieren krimpen binnen hun kolom en tweekoloms formulieren schakelen op de smalste breedtes naar één kolom. Dialogen hebben een begrensde zichtbare hoogte en scrollen intern. Brede wedstrijdoverzichten behouden hun eigen scrollzone. Op een kort liggend scherm krijgt chat een bereikbare invoerzone.

De mobiele laag staat in `prototype/public/responsive.css`. De gedeelde dashboardrasters staan in `workspace.css`, het menu en de veilige schermranden in `navigation.css`, en de telefoon- en zaalweergaves in `baan-phone.css` en `baan.css`. De laatste release koppelt de mobiele laag via `index.html`.

## Uitgevoerd in Chrome

De genoemde afmetingen zijn testviewports in een browser. Een zichtbare scrollbar kan de gemeten inhoudsbreedte verkleinen. De controle keek naar de viewport en de scrollbreedte van de hele pagina.

| Viewport | Gecontroleerde schermen | Waarneming |
|---|---|---|
| 320 × 568 | Vandaag, Verenigingen, Voorkeuren, Training, Wedstrijdkamer, Baanmodus-telefoon, Speeldag en Schema | De pagina past in de viewport. De trainingstabel is horizontaal navigeerbaar binnen het paneel. |
| 390 × 844 | Evenementen | De pagina past. De kaartinhoud en knoppen lopen om waar nodig. |
| 360 × 780 | Baanmodus-hub | De pagina past, ook met de uitgeschreven baanknoppen. |
| 667 × 375 | Chatkamer in landschap | Het chatpaneel past binnen de pagina en heeft een composer. |
| 768 × 900 | Spelersweergave op locatie en organisatoroverzicht | De pagina past in beide rollen. |
| 390 × 693 | 9:16-baanscherm | De scorekaart past en volgt de telefooninvoer. |

Aanvullend geopend en bediend

- Club oprichten op 320 px. Het formulier bleef binnen de dialoogbreedte en kon verticaal scrollen.
- Oefenpartij via het telefoonprofiel op 320 px. De cijferknoppen maten 45 px hoog. Een beurt van 180 verscheen als 321 resterend op het zaalscherm.
- Dubbel-uit op dezelfde testbaan. Het scherm vroeg bevestiging bij 40 en liet na akkoord leg 2 op 501 zien.
- Organisatorrol met de tab Borden op 320 px en Schema naast het 768 px cluboverzicht. De pagina’s vertoonden geen horizontale uitloop.

## Open de voorbeelden

Start `npm run dev` in de map `prototype/`. Voeg het fragment toe aan de lokale URL of gebruik de live prototypebasis uit 07.

| Fragment | Voorbeeld |
|---|---|
| `#home` | Vandaag met een korte agenda. Kies De Puinruimers voor de langere agenda en uitgelijnde panelen. |
| `#events` en `#clubs` | Gedeelde kaarten, formulieren, lijsten en kleinere navigatie. |
| `#match/1` | Scorepaneel in een gewone wedstrijdkamer. |
| `#baan` | Testbaan openen, twee telefoons koppelen en de 9:16-link openen. |
| `#operations`, `#venue` en `#venue/schedule` | Zet Organiseren aan om regie, check-in en het toernooischema te bekijken. |

## Stagingcriteria op echte toestellen

Test met iOS Safari en Android Chrome op echte toestellen. De prototypecontrole is uitgevoerd in Chrome met nagebootste viewports. Herhaal login, toetsenbord, rotatie, terugnavigatie, QR-scan vanuit de camera, herstel van sessie en een volledige scorepartij op staging.

- Bij 320 px blijft de primaire actie bereikbaar. De pagina heeft geen horizontale scroll. Een brede tabel heeft een zichtbare en bedienbare eigen scrollzone.
- Met het toetsenbord open blijft de actieve OTP-invoer zichtbaar en kun je foutmeldingen, opnieuw sturen en bevestigen bereiken. Ondersteun plakken en mobiele OTP-autofill waar de browser die aanbiedt.
- Lange clubnamen, foutteksten en extra acties duwen de pagina niet buiten het scherm. Test tabvolgorde en zichtbare focus zonder touch.
- Een nieuwe draaihoek wist geen ingevoerde score. De actuele partij en revisie worden opnieuw gelezen na achtergrondgebruik of verbindingsverlies.
- Een fysiek 9:16-scherm blijft leesbaar op afstand en toont de status tijdens uitval en herstel. Voer de pilot uit op gescheiden apparaten, inclusief een tweede verbinding als beschikbaar.
