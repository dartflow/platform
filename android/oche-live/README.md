# DartFlow Oche Live · Android

Zelfstandige Kotlin/Jetpack Compose-app; geen WebView en geen spelerslogin. De productievariant gebruikt `https://dartflow.nl`, staging `https://staging.dartflow.nl`. De voorgestelde productiepackage is `nl.dartflow.ochelive`; de eigenaar moet deze vóór de eerste Play-upload in Play Console vastleggen. Staging heeft `nl.dartflow.ochelive.staging` en eigen opslag en links.

## Bouw

JDK 17, Android SDK 36, Build Tools 36.0.0. De Gradle 8.13 wrapper controleert de distributie-SHA-256; AGP 8.13.2, Kotlin/Compose compiler 2.2.20 en Compose BOM 2025.09.01 zijn vastgezet. Minimum Android 8/API 26 is een gekozen ondergrens; bevestig de werkelijke TV-vloot vóór Playpublicatie.

```sh
cd android/oche-live
./gradlew :app:lintStagingDebug :app:testStagingDebugUnitTest :app:assembleStagingDebug
./gradlew :app:lintProductionRelease :app:testProductionReleaseUnitTest :app:bundleProductionRelease
```

Een lokale release zonder signingconfiguratie levert bewust een **ongesigneerde** AAB op, geschikt voor technische inspectie, niet voor upload. CI gebruikt `-PocheRequireSigning=true -PocheVersionCode=<unieke code> -PocheVersionName=<versie>` en weigert ontbrekende signingwaarden. De signingnamen staan in het repositoryrunbook. APK's, AAB's, keystores, SDK en Gradle-caches horen niet in Git.

## Gedrag en beveiliging

- Native telefoon/tabletweergave gebruikt de beschikbare oriëntatie; TV gebruikt het liggende 16:9-signaal. De browserrotatie van de bestaande fysieke baanroute wordt niet op Android toegepast.
- De nieuwe installatie toont één tijdelijke code en een QR naar `/koppel-scherm#code=...`. Het installatiegeheim komt niet in de QR of URL. De QR om **te spelen** komt uitsluitend uit de serverprojectie van een publiek scanbare baan.
- Installatiegeheim en roterende tokens staan in een AES-GCM-versleutelde privéblob. De sleutel wordt in Android Keystore gegenereerd. Back-up en device transfer zijn uitgeschakeld. Appdata wissen of herinstalleren vereist opnieuw koppelen.
- De app bewaart start-, redeem- en refresh-nonces vóór verzending en hergebruikt ze na onduidelijke netwerkfouten. Een succesvolle tokenrotatie en het verwijderen van de oude nonce worden samen opgeslagen.
- Iedere 2 seconden wordt `/events` opnieuw geautoriseerd; eerste opening en reconnect halen een volledige snapshot. Er is geen langdurig kanaal met gecachte rechten. Timeout per HTTP-verzoek is 8 seconden; bij verbindingsproblemen geldt exponentiële back-off tot 30 seconden, met `Retry-After` als minimum. De laatste publieke snapshot staat samen met de schermcredentials in de versleutelde privéopslag. Na procesdood of herstart blijft deze als OFFLINE zichtbaar totdat de server de actuele toegang en toewijzing bevestigt. Een herstelde snapshot speelt geen oude viering of aftelling af. Bij ingetrokken toegang verdwijnt ook de opgeslagen snapshot.
- De server bepaalt deadlines, toewijzing, scores en vrijgave. De aftelling gebruikt het ontvangen servertijdstip plus Androids monotone klok. Bij nul wordt op de actuele serverstatus gewacht. Deze generieke schermsessie is alleen-lezen: **Doorspelen gebeurt op de bevoegde telefoon**.
- Nieuwe events worden aan de hand van sessie, revisie en event-ID gededupliceerd. Een reconnect, eerste snapshot, undo of bust speelt geen oude 180-animatie af. De scorekaart gebruikt de serverbeurten van de actuele leg.
- Pauze en onderbreking behouden de score zonder actieve beurtaanduiding of vrijgavewaarschuwing. Een uitslag toont de door de server aangewezen winnaar en onderscheidt voorlopig, bevestigd en in behandeling. De finishroute komt uit dezelfde snapshot. Single/double-in en straight/double/master-out volgen de serverinstellingen; een handicap toont per zijde de echte startscore, ook in de gespiegelde kaart. Een lange scorekaart opent bij de laatste vijf regels en biedt bij teruglezen **Terug naar live**. Alleen een publiek scanbare vrije baan heeft de 5/10/15-seconden-carrousel.
- Schermbeheerders kiezen via DartFlow → Schermen de huisstijl DartFlow of Onze Trots. De native weergave volgt de versie1-projectie met aangeleverde woordmark/crest en donkerblauwe kleuren, ook vanuit de versleutelde offlinecache. Een onbekend thema of een onbekende themaversie valt terug op DartFlow.
- Een publieke vooroproep toont de namen en eventuele schrijver voor de volgende partij met de expliciete melding dat definitieve toewijzing nog volgt. Deze verwachting vervangt de actuele score, partij of beurt niet.
- Officiële teamontmoetingen tonen de canonieke teamtussenstand, de echte legs en het actuele onderdeel apart van de lopende partij. Alleen de publieke ontmoetingprojectie wordt gelezen.
- Dubbels en teams tonen de servernamen, partners en actuele werper. Cricket gebruikt de echte marks, punten en MPR en krijgt geen X01-maximum- of hoge-finishanimatie.
- TV-knoppen zijn met D-pad bereikbaar en hebben een zichtbare focusrand; Terug opent een sluitbevestiging. Tijdens een actieve wedstrijd en een geldige koppelcode blijft het scherm wakker, alleen zolang de Activity op de voorgrond staat. Stand-by respecteert TV-ambient/screensaver. Dit is geen apparaatbeheer- of kioskapp; automatisch starten na stroomuitval wordt door het beheerde apparaat ingesteld.
- Info bevat versie, beheerinstructie en de privacylink. De app vraagt geen camera, locatie, opslag of accountrechten.

## App Links en controle

Het manifest claimt uitsluitend exact `/oche-live`, **niet** `/oche-live/<baanId>/`, `/baan/...` of `/koppel-scherm`. Staging heeft zijn eigen host. De backend moet `/.well-known/assetlinks.json` met de echte Play **app-signing**-SHA-256 serveren; een uploadcertificaat of debugcertificaat bewijst de Play-appkoppeling niet.

Unit tests controleren de versieerbare projectie, vijf scorekaartrijen, links/rechts, solo, bust, nul, meer dan vijf beurten, legwissel, timers en eventdeduplicatie. `OcheUiTest` bevat echte Compose-instrumentatietests voor de koppel- en herstelflow. Een aanwezige emulator of hardware is nodig om deze uit te voeren.

Open vóór publicatie nog op echte telefoon en TV: D-pad/focus/overscan, grote systeemletters, pairing/QR, offline/restart/update met behoud van koppeling, leesbaarheid, privacylink, ambient en Play App Links. Playbeschikbaarheid, TV-distributie, review en ondertekening vereisen de eigenaarstoegang uit het centrale runbook.
