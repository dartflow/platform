# Dartflow overdracht naar Codex

Dit pakket bevat het werkende Dartflow-prototype als bronreferentie en de bouwopdracht voor de eerste stagingversie. De mobiele prototype-update heeft een eigen release. De stagingopdracht verplaatst de kernketen naar één servergestuurde identiteit en wedstrijdstroom.

**Begin hier.** Pak het archief uit, voeg de map toe aan de Codex-workspace en geef Codex het bestand `01-Codex-masterprompt.txt`. Laat Codex de bestaande doelrepo en DG-inventaris eerst controleren. De masterprompt werkt ook als losse opdracht, met de documenten in dit pakket als naslag.

| Bestand of map | Gebruik |
|---|---|
| `01-Codex-masterprompt.txt` | Complete opdracht, bouwvolgorde en oplevercriteria |
| `02-Functioneel-en-acceptatie.md` | Routes, modules, pilot en regressies |
| `03-Authenticatie-data-en-realtime.md` | E-mail-OTP, Google Auth, clubrollen en transacties |
| `04-Infra-CICD-en-runbook.md` | DG-hostinrichting, releaseketen, monitoring en rollback |
| `05-Deelprompts.md` | Los uitvoerbare opdrachten per bouwfase |
| `06-Mobiele-controle.md` | Geteste viewports, schermvoorbeelden en stagingtestmatrix |
| `07-Releasebewijs.md` | Exacte prototypeversie, broncommit en uitgevoerde controles |
| `voorbeelden/` | Omgevingsvariabelen, testcasegegevens en acceptatierapport |
| `standaarden/` | De twee aangeleverde DG-documenten van 4 november 2026 |
| `prototype/` | Tracked broncode van de prototype-update, inclusief demo, vormgeving, tests en voorbeelddata |

De map `prototype/` is de referentie voor werking en UI. Gebruik Node 22.13 of nieuwer met de ingebouwde SQLite-module voor de lokale demo. Draai daar `npm test` en `npm run dev`. Gebruik het adres dat de server toont. De testopslag is lokaal en bevat demogegevens. De meegeleverde hostingconfiguratie hoort bij het bestaande prototype.

Voor de eerste stagingpilot is één clubavond bij Duindorp SV de voorgestelde scope. Gebruik twee spelers, een wedstrijdleider, een schrijftelefoon die kan overdragen en het verticale zaalscherm. Gebruik uitsluitend afgesproken testaccounts en ontvangers.
