# DartFlow Speler · native Android

Een zelfstandige Kotlin/Jetpack Compose-app met ingebouwde spelersschermen. De app gebruikt dezelfde DartFlow-accounts, wedstrijd-ID's, score-engine, baanrechten en definitieve statistieken als de website en Oche Live. De Android-client bepaalt nooit zelf wie mag scoren of welke score definitief is.

Zie de [oplevering met installatiebestanden en testresultaten](../../docs/player-android/oplevering.md) voor de actuele ondertekende release en eerdere versies. De native veiligheidsflows staan in [Play-gereedheid](../../docs/player-android/play-readiness-native.md).

## Identiteit en builds

| Variant | applicationId | Backend | Gebruik |
| --- | --- | --- | --- |
| production | `nl.dartflow.app` | `https://dartflow.nl` | Afzonderlijke toekomstige Play-vermelding DartFlow |
| staging | `nl.dartflow.app.staging` | `https://staging.dartflow.nl` | Integratie met de stagingbackend |
| developmentDebug | `nl.dartflow.app.dev` | `http://127.0.0.1:3000` | Uitsluitend lokale fixtures met `adb reverse` |

De drie identiteiten en Oche Live kunnen naast elkaar worden geïnstalleerd. Development heeft geen releasevariant. Alleen de developmentvariant laat HTTP naar loopback toe. Productie en staging gebruiken uitsluitend HTTPS. De pakketnamen zijn in het project vastgelegd; een nieuwe Play-app wordt pas door de eigenaar aangemaakt en gekoppeld bij een eerste upload.

## Ingebouwde spelersflows

- E-mailcode en Google met PKCE, Android Keystore-sessieopslag, refresh, uitloggen en terugkeer naar de aangevraagde baan of wedstrijd.
- Profiel afronden met unieke gebruikersnaam, weergavenaam en spelerspincode; naam- en privacyinstellingen, PIN wijzigen of opnieuw instellen na recente verificatie.
- Vandaag, wedstrijden hervatten, baanfavorieten, vaste baan-QR, korte uitnodigingscode, lokale en online lobby, tweede profiel toevoegen met spelerspincode.
- Solo, lokale schrijver en thuis/hybride; volledige scoreconsole met cijfers, wissen, bevestigen, checkoutdarts, correctie en gedeelde serverstand.
- Wedstrijdkaart, scorekaart, uitslagbevestiging, servergestuurde inactiviteit en Doorspelen. Bij een onduidelijke verzenduitkomst wordt dezelfde aanvraagidentiteit herhaald.
- Vrienden, uitnodigingen, spelerskamers en wedstrijdchat; communityfeed; toernooi- en competitieoverzichten met de beschikbare inschrijf-, check-in- en wedstrijdacties.
- Profielstatistieken, tegenstanders, oefensessies en wedstrijdhistorie; Oche Live-apparaatbeheer en koppelen van een scherm.
- Lokale QR-scanner met Camera2 en ZXing; camerabeelden en scanresultaten worden niet aan een scannerprovider aangeboden of opgeslagen. Er is geen Google Play services-/ML Kit-scanner meer aanwezig.
- WebRTC-camera/microfoon met camera wisselen. Een videopreview sluiten bewaart de verbinding tijdens het scoren; de verbinding stopt bij de expliciete stopactie, een andere partij of wanneer de app naar de achtergrond gaat.
- Communityregels en 13+-bevestiging vóór het plaatsen van berichten; gebruikers, posts, reacties en chatberichten melden; blokkeren en deblokkeren met bevestiging.
- Accountverwijdering aanvragen na recente eigen verificatie; na serveracceptatie worden de lokale sessie, wachtrij en media onmiddellijk gewist/gestopt. Beoordelaarstoegang gebruikt uitsluitend een afzonderlijk server-side ingericht account.

De app gebruikt ingebouwde schermen. Google-accountselectie opent in een beveiligde browsertab; het privacybeleid en gedeelde openbare links gebruiken de daarvoor bestemde Android-acties. Meldingen worden in de app opgehaald. Er is in deze versie geen FCM-pushdienst of achtergrondvideo toegevoegd.

## Beginscherm en scorebevestiging vanaf 0.1.3

Vandaag combineert directe speelacties, een eventuele actieve partij en maximaal vijf actuele communityberichten. De volledige feed, reacties, berichtplaatsing en meld-/blokkeeropties gebruiken dezelfde bestaande routes en rechten. Evenementen en verenigingen krijgen eigen groepen; het scrollbare Meer-menu groepeert spelen, community, schermbeheer en accountinstellingen. De navigatie gebruikt één familie ingebouwde iconen en markeert ook bij detailpagina's de bijbehorende hoofdtab.

De speelcontext en feed laden onafhankelijk. Een onbereikbare feed blokkeert spelen niet; de accountgebonden feedcache staat uitsluitend in geheugen en wordt bij een accountwissel gewist. Het beginscherm ververst hoogstens elke vijftien seconden automatisch en direct bij opnieuw openen of handmatig verversen. De actieve scoreconsole houdt zijn bestaande snellere verversing.

Na een worp past de console de volledige serverbevestiging direct toe, inclusief een eventuele Dartbotbeurt. Verouderde achtergrondaanvragen kunnen die stand niet overschrijven. De app rekent geen voorlopige scores uit. De status onder de restscore krijgt ruimte op basis van de werkelijke teksthoogte en systeemtekstgrootte.

## Lokaal starten

Gebruik dezelfde Node/npm-versies en lokale PostgreSQL-fixture als de repository. Hostedgegevens en providercredentials zijn voor fixtureproeven niet nodig.

```sh
npm run db:start
npm run db:migrate
npm run db:seed
npm run dev
```

De server moet in `DARTFLOW_DATA_MODE=local` op loopback draaien. Gebruik een Android-emulator of via USB aangesloten toestel:

```sh
adb reverse tcp:3000 tcp:3000
cd android/player
./gradlew --no-daemon :app:assembleDevelopmentDebug
adb install -r app/build/outputs/apk/development/debug/app-development-debug.apk
```

De ontwikkelapp toont uitsluitend de vier bestaande lokale testaccounts. Staging en productie bieden die keuze niet. `GET /api/player/v1/capabilities` moet voor de gekozen omgeving beschikbaar zijn; de nieuwe servercode moet via de bestaande DG Webservices-releaseflow worden uitgerold voordat een staging-/productiebuild deze API kan gebruiken. Het bouwen van de app activeert geen webrelease.

## Controleren en delen

JDK 17, Android SDK 36, build-tools 36.0.0 en de vastgelegde Gradle-wrapper zijn vereist. De versies sluiten aan op de Oche Live-bouwomgeving. Houd Gradle- en SDK-opslag buiten de Git-checkout.

```sh
./gradlew --no-daemon --max-workers=2 \
  :app:lintDevelopmentDebug :app:testDevelopmentDebugUnitTest :app:assembleDevelopmentDebug \
  :app:lintStagingDebug :app:testStagingDebugUnitTest :app:assembleStagingDebug \
  :app:lintProductionDebug :app:testProductionDebugUnitTest :app:bundleProductionRelease
./gradlew --no-daemon :app:connectedDevelopmentDebugAndroidTest
```

De afzonderlijke workflow `player-android-ci.yml` bouwt APK's, een ongetekende productiebundel en voert native telefoonproeven uit. Hij publiceert niets naar Google Play. Een debug-APK is voor rechtstreeks installeren; de ongetekende AAB is een bouwcontrole en kan niet naar Play worden geüpload.

Voor een later ondertekende release gebruikt dit project eigen configuratienamen: `PLAYER_UPLOAD_KEYSTORE_PATH`, `PLAYER_UPLOAD_STORE_PASSWORD`, `PLAYER_UPLOAD_KEY_ALIAS`, `PLAYER_UPLOAD_KEY_PASSWORD`, met `-PplayerRequireSigning=true -PplayerVersionCode=<oplopende-versie>`. Sleutels staan buiten Git. De Oche Live-signingconfiguratie wordt niet gewijzigd. Inrichting van een spelersapp-uploadsleutel en Play-publicatie zijn afzonderlijke vervolgstappen.

Zie het [backend- en authcontract](../../docs/player-android/backend-api.md) voor API-mapping, Supabase-redirectconfiguratie en rechten. App Links vereisen later het echte **Play App Signing-certificaat van DartFlow Speler**; het Oche Live-certificaat of een debugcertificaat vervangt dit niet.

## Acceptatie op echte apparaten

Controleer na staginguitrol e-mail/Google-login met terugkeer, camera/microfoon met twee deelnemers, camera wisselen terwijl de ander het nieuwe beeld ziet, QR-scans en Android App Links, sessieherstel, veilig toetsenbordgedrag en leesbaarheid op kleine schermen. Deze proeven moeten werkelijk op apparaten worden uitgevoerd; een geslaagde build of fixturetest geldt daar niet als bewijs voor.
