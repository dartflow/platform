# Deelprompts voor Codex

Gebruik één opdracht per fase. Geef in de Codex-workspace steeds toegang tot de relevante pakketbestanden en de doelrepo. Kopieer de tekst in het blok.

## 1 Doelrepo en releasegrondslag

```text
Inventariseer de Dartflow-doelrepo en de geautoriseerde DG-infra read-only. Lees de twee meegeleverde standaarden en 04-Infra-CICD-en-runbook.md. Controleer het releasecontract, toolchain, runneridentiteit, deploywrapper en geïsoleerde stagingwaarden. Run npm test in prototype/. Lever een technische besluitlijst met bronbewijs, ontbrekende waarden, testplan en eerstvolgende bouwstap. Gebruik geen verzonnen host, poort, label of wrapperflag.
```

## 2 Mobiele UI en navigatie

```text
Port de Dartflow-workruimtes naar de Next.js-doelrepo aan de hand van prototype/public, 02-Functioneel-en-acceptatie.md en 06-Mobiele-controle.md. Hergebruik de visuele tokens en SVG-assets. Bouw eerst Vandaag, Baanmodus telefoon en 9:16, evenementdetail en wedstrijdleiding. Meet de layout op 320, 360, 390, 768 en 1440 px. Test ook een korte liggende viewport en een echte telefoon met geopend toetsenbord. Bewaak horizontale overloop, zichtbare acties, focus, veilige schermranden en de diepe QR-route. Lever een routevergelijking met meetresultaten.
```

## 3 Login en clubrechten

```text
Implementeer e-mail-OTP en Google OAuth volgens 03-Authenticatie-data-en-realtime.md. Gebruik afzonderlijke stagingproviders en testontvangers. Verifieer de actuele Supabase en Next.js contracten, validatie van terugkeerpad, SSR-sessie en rolcontroles. Maak migraties en voer negatieve tests uit met gewone speler, clubbeheerder en speler uit een tweede club. Geef Baanmodus hetzelfde account-ID als de rest van Dartflow. Toon in een bewijsverslag beide loginroutes, foutstatussen, sessieverval, logout en het hervatten van de gescande QR-partij. Laat waarden uit de kluis buiten de uitvoer.
```

## 4 Wedstrijdtransacties en zaalscherm

```text
Bouw het servergestuurde wedstrijdmodel voor de eerste pilot. Gebruik 02, 03 en voorbeelden/wedstrijd-fixture.json als startpunt. Behoud de bestaande spelregels en test uit het prototype. Verbind check-in, bordoproep, partij-ID, QR, score, revisie, schrijfrecht, bevestiging en definitieve uitslag. Verwerk een gelijktijdige score, overname en retry met geldige revisies. Schrijf bij dubbele bevestiging de stand maximaal één keer. Maak een test voor een onderbroken verbinding, terugkeer na herladen en afgewezen mutatie vanuit een tweede club. De televisie volgt de autoritatieve stand en toont herstel bij een onderbreking.
```

## 5 Native stagingrelease

```text
Bereid een Dartflow-stagingrelease voor volgens de DG Webservices VPS-standaard. Gebruik 04 en voorbeelden/release-acceptatie.md. Draai CI op de volledige SHA. Verifieer runner, UID, target en bron; laat de geverifieerde wrapper met stagingconfiguratie bouwen. Registreer actieve SHA via loopback en HTTPS. Doorloop de pilot op twee testtelefoons en één 9:16-scherm. Noteer Pass, Fail, Open of N.v.t. per testcase, bewijslinks en rollbackproef. De geaccepteerde SHA is de bron voor een latere productierelease volgens de DG-flow.
```

## 6 Review voor uitrol

```text
Review de stagingdiff en het acceptatierapport alsof je beheerder van DG Webservices bent. Zoek naar verkeerde omgevingswaarden, overmatige rechten, ontbrekende clubafbakening, herhaalde score of dubbel toegepaste uitslag, regressies op mobiel en ongedocumenteerd herstel. Herhaal de relevante tests. Geef per bevinding bewijs, ernst, bestand of route en concrete oplossing. Onderbouw elk Pass-oordeel met de daadwerkelijk geteste omgeving en commit.
```
