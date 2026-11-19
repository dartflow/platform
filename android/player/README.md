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
- Solo, lokale schrijver en thuis/hybride; scoreconsole met totalen of waargenomen pijlen voor dubbel-in, afwijkende uitregels en Cricket. Cricket toont marks, punten en MPR; dubbels en teams tonen partners, zijden en de actuele werper uit de serverprojectie.
- Wedstrijdkaart, scorekaart, uitslagbevestiging, servergestuurde inactiviteit en Doorspelen. Bij een onduidelijke verzenduitkomst wordt dezelfde aanvraagidentiteit herhaald.
- Vrienden, uitnodigingen, spelerskamers en wedstrijdchat; communityfeed; toernooi- en competitieoverzichten met de beschikbare inschrijf-, check-in- en wedstrijdacties.
- Profielstatistieken, tegenstanders, oefensessies en wedstrijdhistorie; Oche Live-apparaatbeheer en koppelen van een scherm.
- Lokale QR-scanner met Camera2 en ZXing; camerabeelden en scanresultaten worden niet aan een scannerprovider aangeboden of opgeslagen. Er is geen Google Play services-/ML Kit-scanner meer aanwezig.
- WebRTC-camera/microfoon met camera wisselen. Een videopreview sluiten bewaart de verbinding tijdens het scoren; de verbinding stopt bij de expliciete stopactie, een andere partij of wanneer de app naar de achtergrond gaat.
- Native toernooiwizard met persoonlijke/club/platformeigenaar, zichtbaarheid, spelregels en handicap; wedstrijdleiding met aanmeldingen, check-in, loting, banen, schrijvers en gemotiveerde walkovers. Persoonlijke toernooien krijgen geen officiële rankingbestemming.
- Competitieconcepten voor individuele divisies, teams, dubbels, cup, ladder, vrije inloop en clubkampioenen. Vier- en zevenpartijenformats, twee- of vierspelersopstellingen, reservewissels, transfers, oproep, tijdvoorstel, bezwaar, programma en beheerbesluiten volgen de actuele serverrechten. Ratingplaatsing, kwalificatiebewijs en promotieplannen blijven aan hun gepubliceerde bronrevisie gekoppeld.
- Clubrating en circuitbeheer met herkenningsaanvragen, gemotiveerde besluiten, gepubliceerde bestemmingsregels en eigen instemming; circuiteindstand en broncorrecties gebruiken de centrale serververwerking.
- Organisatieconcepten op het account hervatten en voor bevoegde cluborganisatoren delen, met expliciet revisiebeheer en behoud van invoer bij conflicten. De lokale toernooiwizard blijft beschikbaar naast deze gedeelde concepten.
- Correcties na definitieve ondertekening met onafhankelijke beoordeling, werkelijke herinvoer en nieuwe ondertekening; de server verwerkt de gevolgen voor rating en circuiteindstand.
- Afzonderlijke eigen teambijdragen en Cricket-statistieken; gezamenlijke scores worden geen individuele X01-prestatie.
- Landelijke spelersrating met serverfilters voor actieve/voorlopige/inactieve spelers, eigen positie en mutatiehistorie; eigen instemming vóór de partij.
- Platformbeheerders kunnen hulpconcepten bewerken, als tekst bekijken, publiceren en eerdere publicaties herstellen met een motivering en versiecontrole.
- Dezelfde gepubliceerde Help/FAQ als de website, ook vóór aanmelden; zoeken op alle woorden en synoniemen, deeplinks en een zichtbaar gemarkeerde offlinekopie met inhoudsversie.
- Dubbel in, straight/master uit en handicap gebruiken ingevoerde pijlen waar de server die nodig heeft. De server bepaalt de geldige opening, bust, finish en definitieve restscore.
- Communityregels en 13+-bevestiging vóór het plaatsen van berichten; gebruikers, posts, reacties en chatberichten melden; blokkeren en deblokkeren met bevestiging.
- Accountverwijdering aanvragen na recente eigen verificatie; na serveracceptatie worden de lokale sessie, wachtrij en media onmiddellijk gewist/gestopt. Beoordelaarstoegang gebruikt uitsluitend een afzonderlijk server-side ingericht account.

De toernooiwizard bewaart tussentijdse invoer per account op het apparaat. Via Bewaar accountconcept wordt dit expliciet naar de gedeelde serverconcepten opgeslagen. Accountconcepten, opstellingsconcepten en seizoensconcepten gebruiken centrale revisies en actuele organisatierechten. De app bewaart de navigatiebestemming bij procesherstel en de formulier-/scrolltoestand bij terugnavigatie.

De app gebruikt ingebouwde schermen. Google-accountselectie opent in een beveiligde browsertab; het privacybeleid en gedeelde openbare links gebruiken de daarvoor bestemde Android-acties. Kandidaat 0.2.0 voegt een expliciet in te schakelen FCM-achtergronddienst toe naast de gewone inbox. Het [pushcontract en de bewijsgrenzen](../../docs/player-android/achtergrondmeldingen.md) beschrijven de benodigde Firebase-inrichting; echte aflevering is nog niet aangetoond. Achtergrondvideo is niet toegevoegd.

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

## Circuitfinale en bezwaardossier

Een geselecteerd circuit heeft een eigen tab Finalekwalificatie. De app toont de vastgelegde bron- en actuele generatie, grensgelijkheid, werkelijk gespeelde beslissingspartijen en de acht geplaatsten. Alleen actuele serverbevoegdheden bieden aanmaken, verwerken of een afzonderlijke knock-outfinale aan. Een gewijzigde bronstand blokkeert verder handelen op het oude dossier; de bestaande beslissers en finale blijven zichtbaar. De finale voegt geen extra circuitavond toe.

Het bezwaardossier toont categorie, een werkelijk opgeslagen beurt, onderbouwing, reactie- en beroepstermijn, bewaartermijn en tijdlijn. Reageren, eenmalig beroep bij een andere onafhankelijke beoordelaar, sluiten en herindelen gebruiken de actuele servertoestemming. Een tegenpartij kan een reactie toevoegen zonder zichzelf beoordelaar te maken. Late ontdekking krijgt een afzonderlijke motivering. Heropening blijft echte herinvoer met nieuwe ondertekening.

## Doorstroom en vooroproepen

Gekopieerde divisieseizoenen tonen de vastgelegde sportieve volgorde en bronrevisie. De leiding kan een vrijgevallen plaats laten beoordelen, echte beslissers spelen of vooraf een kwalificatiebron binden, daarna de door de server aangewezen rechthebbende bekrachtigen. De client kiest geen vervangende speler. Intrekken gebruikt de actuele servertoestemming en een gemotiveerde bevestiging.

De director kan voor een volgende partij een vooroproep klaarzetten, ook op een nog bezette baan. Vandaag en Oche Live onderscheiden de verwachting van de definitieve oproep. De lopende partij behoudt haar bestaande toewijzing.

Een gewijzigde bezetting voor erkende competitiesingles toont het nieuwe spelerspaar, de reden en de rosterrevisie vóór nieuwe persoonlijke instemming. De app verstuurt alleen de getoonde eigen versies; eerdere instemming geldt niet vanzelf voor een nieuwe tegenstander.

## Fysieke locaties en officiële beeldverbinding

Meer → Locaties en reserveringen beheert eigen thuisbanen en locaties, locatiebeheerders, fysieke banen, opening/sluiting en reserveringsaanvragen met goedkeuring of afwijzing. Reserveringstijden volgen de gekozen locatietijdzone; ongeldige of dubbelzinnige kloktijden worden geweigerd. Geforceerd vrijgeven vraagt de exacte baannaam, reden en expliciete bevestiging van de gevolgen en gebruikt de vastgelegde sessie-id tegen verouderde opdrachten. Eigen thuisbanen blijven privé. Een officiële remote-koppeling geldt als toestemming van de eigenaar voor het afgebakende speelblok; externe locaties gebruiken het reserveringsbesluit.

Alleen de actuele aangewezen mediaoperators krijgen de beeldbediening. Gereedheid voor een verplichte beeldverbinding gebruikt werkelijke recente lokale en ontvangen videoframes, de LIVE-status van de tracks en de WebRTC-transportstatus. De app meldt dit iedere vijf seconden en meldt onmiddellijk ongereed bij camera-/transportverlies of stoppen. De server beslist over start en score. Deze callbacks zijn lokaal gecompileerd en met toestandtests gecontroleerd; een echte tweezijdige camera-acceptatierun blijft vereist.

Schermbeheer biedt de huisstijlen DartFlow en Onze Trots via de bestaande centrale apparaatopdracht.

## Acceptatie op echte apparaten

Controleer na staginguitrol e-mail/Google-login met terugkeer, camera/microfoon met twee deelnemers, camera wisselen terwijl de ander het nieuwe beeld ziet, QR-scans en Android App Links, sessieherstel, veilig toetsenbordgedrag en leesbaarheid op kleine schermen. Deze proeven moeten werkelijk op apparaten worden uitgevoerd; een geslaagde build of fixturetest geldt daar niet als bewijs voor.
