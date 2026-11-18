# DartFlow Speler · native Android-opleveringen

## Actuele ondertekende release · 0.1.1 (2)

De actuele [GitHubrelease `android-player-0.1.1-2`](https://github.com/dartflow/platform/releases/tag/android-player-0.1.1-2) bevat DartFlow Speler **0.1.1**, versionCode **2**, applicationId **`nl.dartflow.app`**. De exacte applicatiebron is maincommit [`20db906c3c646caba2d9a6e09f0429b20e865564`](https://github.com/dartflow/platform/commit/20db906c3c646caba2d9a6e09f0429b20e865564). Beide bestanden gebruiken de productiebackend `https://dartflow.nl`; minSdk is 26 en targetSdk/compileSdk zijn 36.

Gebruik voor de Play Console het [invulblad voor 0.1.1](play-console-0.1.1.md) en de [GitHub/Google Play-releaseprocedure](github-play.md). Deze oplevering bewijst de ondertekende GitHubbestanden en hun controles. Beschikbaarheid in Google Play volgt uit de afzonderlijke Play-releaseactie. Backenduitrollen en eventuele latere databasemigraties behouden hun eigen bron- en uitrolbewijs; ze veranderen de Android-bron-SHA hierboven niet.

| Bestand | Gebruik | Grootte | SHA-256 |
| --- | --- | --- | --- |
| [app-production-release.aab](https://github.com/dartflow/platform/releases/download/android-player-0.1.1-2/app-production-release.aab) | Ondertekende bundel voor Google Play | 26.312.672 bytes | `dc7e549f49ec4eeeeb8b18316a533058af83b053dc4837c342b6a8c010193c84` |
| [app-production-release.apk](https://github.com/dartflow/platform/releases/download/android-player-0.1.1-2/app-production-release.apk) | Ondertekende universele APK voor rechtstreeks installeren | 49.621.844 bytes | `f3519dfc7f2b1e8f53f1da64f33afad32e2663e4233f7f2fcab80d97170a2113` |
| [release-evidence.json](https://github.com/dartflow/platform/releases/download/android-player-0.1.1-2/release-evidence.json) | Volledig controlebewijs, inclusief CI, manifest, native bibliotheken en hashes | 7.268 bytes | `a28de020ed9ffecfe6f62272f3dcb727e75c5fef65ee6db815240401c84758ff` |
| [release-receipt.json](https://github.com/dartflow/platform/releases/download/android-player-0.1.1-2/release-receipt.json) | Compacte bron-/versie-/certificaatbinding voor de releaseworkflow | 667 bytes | `595a18c13fc6d473bd8baccfca271629d2d06926cb22947051df13f966f925a8` |

De AAB is gebouwd in de [geslaagde Android-CI op exact deze commit](https://github.com/dartflow/platform/actions/runs/44318798401) en daarna lokaal ondertekend met de bestaande afzonderlijke spelersapp-uploadsleutel. De APK is met Google bundletool uit diezelfde AAB gemaakt, zonder hercompilatie van de applicatie. De GitHub-archiefchecksums en ieder uitgepakt bestand zijn vóór ondertekening gecontroleerd. Er is voor deze definitieve bouw geen Android-build op de productie-VPS uitgevoerd. De definitieve opleverbestanden zijn bevroren.

Het uploadcertificaat is ongewijzigd: **`97:C8:A2:78:FF:67:14:BD:E4:F1:BC:B5:4E:BA:15:12:28:D4:2E:83:8F:11:D4:3B:CF:6E:71:C7:DE:08:A0:09`**. Dit is het uploadcertificaat van de spelersapp; het Play App Signing-certificaat blijft een afzonderlijk certificaat.

| Controle op 0.1.1 (2) | Werkelijk resultaat |
| --- | --- |
| Development-, staging- en production-JVM-tests | 34 per variant, **102 geslaagd**, 0 mislukt, 0 overgeslagen |
| Native Compose-proeven | **14 geslaagd**, 0 mislukt, 0 overgeslagen op de Android 16/API 36 `google_apis` x86_64-emulator |
| Lint | Alle drie varianten geslaagd: **0 fouten, 28 waarschuwingen per variant** |
| Releasebuild en R8 | Production-release-AAB geslaagd; development- en staging-APK's gebouwd |
| Ondertekening | AAB gecontroleerd met jarsigner; APK met apksigner; beide certificaten komen overeen met de bestaande spelersapp-uploadsleutel |
| Bundel en manifest | Google bundletool 1.18.3-validatie geslaagd; package/versie/productiehost gecontroleerd; niet debugbaar, back-ups en cleartextverkeer uit |
| 16KB-uitlijning | AAB `PAGE_ALIGNMENT_16K`, APK ZIP-uitlijning en alle 64-bit-ELF-loadsegmenten op arm64-v8a en x86_64 geslaagd |
| Exacte artifactbinding | Bronmanifest van 56 bestanden, GitHub-archiefdigests, uitgepakte bestanden en ondertekende bestandsdigests gecontroleerd; de repositorycontrole `verify_receipt.py` geslaagd |
| Fysieke toestellen en echte providers | Niet door deze CI geverifieerd; echte OTP/Google, QR-camera en video tussen twee fysieke toestellen blijven apparaatcontroles |

De 16KB-ELF-controle geldt voor de 64-bit-ABI's. De meegeleverde 32-bit-WebRTC-bibliotheken voor armeabi-v7a en x86 behouden 4KB-loadsegmenten; voor die bibliotheken wordt geen 16KB-ELF-compatibiliteit geclaimd. De individuele uitlijningen staan in `release-evidence.json`.

### Gewijzigd in 0.1.1

- **Beoordelaarstoegang:** op het aanmeldscherm staat **Toegang voor appbeoordeling** voor de afzonderlijk ingerichte beoordelingsaccounts. De server controleert hun e-mailadres en wachtwoord; gewone spelers blijven e-mailcode of Google gebruiken. Er staan geen beoordelaarswachtwoorden of inlogomwegen in de app. De eigenaar haalt de privégegevens na recente verificatie op in platformbeheer en verstrekt ze uitsluitend via de daarvoor bedoelde Play Console-velden.
- **Accountverwijdering:** **Profiel → Account en gegevens verwijderen** legt gevolgen en bewaarexcepties uit, vraagt bevestiging met `VERWIJDEREN` en verwerkt de serverstatus. Na een geaccepteerde aanvraag wist de app de eigen sessie en stopt de mediaverbinding. Bij vereiste herverificatie meldt de gebruiker zich opnieuw aan. De openbare route is [dartflow.nl/account-verwijderen](https://dartflow.nl/account-verwijderen); de backendafhandeling staat in [account-removal.md](account-removal.md).
- **Gebruikersveiligheid:** melden, blokkeren en deblokkeren zijn bereikbaar bij spelers, communitybijdragen, reacties, chat en wedstrijdopties, met bevestiging en duidelijke feedback. Vóór een nieuwe communitybijdrage zijn de actuele communityregels en een 13+-bevestiging nodig. Score-invoer, melden en blokkeren blijven beschikbaar zonder die UGC-acceptatie. Zie [moderatie en community](moderatie-en-community.md).
- **Media bij ingetrokken toegang:** een permanente signaalweigering stopt camera, microfoon en peerverbinding. Oude signaalreacties en cameracallbacks kunnen een vervangende verbinding niet wijzigen. Een tijdelijke netwerk- of serverfout behoudt het herstelpad; de score blijft bereikbaar.
- **Lokale QR-scanner:** Camera2 en ZXing vervangen de Google Play Services/MLKit-scanner; handmatige invoer en annuleren blijven beschikbaar. De gecontroleerde runtimegraaf bevat geen GMS, MLKit, Firebase, datatransport, Ads, Billing of Crashlytics. De zes Gradle-invoerbestanden van die graaf zijn identiek aan de definitieve releasebron. Ongebruikte notificatierechten zijn verwijderd.
- **Privacy en contact:** de app verwijst naar [privacy](https://dartflow.nl/privacy), accountverwijdering en communityregels. Het contactadres is **info@dartflow.nl**. Details van de native wijzigingen en testgrenzen staan in [play-readiness-native.md](play-readiness-native.md).

Voor rechtstreeks installeren vanaf de actuele release:

```sh
adb install -r app-production-release.apk
```

### Werkelijke Google Play-status

De eigenaar heeft de eerste AAB handmatig opgeslagen. De [echte GitHub-toegangsproef](https://github.com/dartflow/platform/actions/runs/44326068767) en [idempotente interne uitrol](https://github.com/dartflow/platform/actions/runs/44326658372) zijn geslaagd: Google meldt versiecode **2** als `completed` op de interne track en dezelfde AAB-SHA-256 als hierboven. De herhaling voerde geen bundleupload, trackwijziging of editcommit uit. De productietrack is nog leeg; Store-/App-contenttaken en de eerste productiepublicatie blijven eigenaarstappen in Console.

Het bevroren `release-receipt.json` bewaart `playUpload=false` van het moment van ondertekening: de generator had toen niet naar Play geüpload. Die historische receipt blijft ongewijzigd. De latere eigenaarupload en API-proeven staan in het [actuele uitrolbewijs](../evidence/player-play-ready-2026-11-18.json).

## Historische release · 0.1.0 (1)

De onderstaande secties bewaren de eerdere oplevering en haar toenmalige uitrol-/configuratiestatus. Gebruik voor nieuwe uploads de actuele **0.1.1 (2)**-bestanden hierboven.

Op 18 november 2026 zijn de ondertekende productiebestanden van versie **0.1.0 (1)** opgeleverd: Kotlin/Jetpack Compose, met applicationId **`nl.dartflow.app`**. De spelersschermen zijn ingebouwd in de app. De bestaande DartFlow-server blijft verantwoordelijk voor accounts, rechten, geaccepteerde scores, resultaten en statistieken.

> **Webuitrol:** Staging (`44221218169-1`) en productie (`44221637689-1`) draaien maincommit `092c8c1e1cca403fbc29ab0679f7efcfc7bb915a`; beide deployworkflows en alle 23 controles per omgeving zijn geslaagd. Zie [het uitrolbewijs](../evidence/native-player-deployed-2026-11-18.json).

[PR #1](https://github.com/dartflow/platform/pull/1) is samengevoegd. De ondertekende APK en AAB zijn gebouwd vanaf maincommit `092c8c1e1cca403fbc29ab0679f7efcfc7bb915a` (`092c8c1`). De oorspronkelijke bouwcontrole van 15 november blijft hieronder en in haar eigen rapport bewaard. Play-publicatie valt buiten deze oplevering en is niet uitgevoerd.

### Ondertekende 0.1.0-productieversie van 18 november

De [Androidrelease](https://github.com/dartflow/platform/releases/tag/android-2026-11-18) bevat de productie-APK voor rechtstreeks installeren en de ondertekende AAB. Beide gebruiken uitsluitend `https://dartflow.nl` als backend.

| Bestand | Gebruik | Grootte | SHA-256 |
| --- | --- | --- | --- |
| [dartflow-player-0.1.0-1-production.apk](https://github.com/dartflow/platform/releases/download/android-2026-11-18/dartflow-player-0.1.0-1-production.apk) | Rechtstreeks installeren, ondertekend | 49.796.143 bytes | `4c6ce8b29214b2d5cc1f63167517c7b27bcfa809f42e84a3140e0921ecf47888` |
| [dartflow-player-0.1.0-1-production.aab](https://github.com/dartflow/platform/releases/download/android-2026-11-18/dartflow-player-0.1.0-1-production.aab) | Ondertekende productiebundel; niet naar Play geüpload | 26.544.628 bytes | `25924610c74ab42a9add44b7a8ce54b1f2131928c1fadba91d39f37b681187eb` |

Na downloaden kan de productie-APK op een aangesloten Android-toestel worden geïnstalleerd:

```sh
adb install -r dartflow-player-0.1.0-1-production.apk
```

Voor de spelersapp is een eigen RSA-3072-uploadsleutel met alias `player-upload` ingericht. Sleutel en wachtwoord staan afzonderlijk buiten Git. De herstelkopie op `dg-nxttrack-01` is uitsluitend voor root toegankelijk; de keystore, checksum en het overeenkomende certificaat zijn met JDK 17 gecontroleerd. De publieke certificaatfingerprint is `97:C8:A2:78:FF:67:14:BD:E4:F1:BC:B5:4E:BA:15:12:28:D4:2E:83:8F:11:D4:3B:CF:6E:71:C7:DE:08:A0:09`. Dit is het spelersapp-uploadcertificaat. Een later Play App Signing-certificaat wordt afzonderlijk door de Play-inrichting bepaald.

| Controle op deze ondertekende productieversie | Resultaat |
| --- | --- |
| Productierelease bouwen, APK en AAB ondertekenen | Geslaagd vanaf main `092c8c1` |
| Production-release JVM-tests | 24 geslaagd, 0 fouten, 0 overgeslagen |
| Production-release lint | Geslaagd: 0 fouten, 27 waarschuwingen |
| Onafhankelijke artifactcontroles | 26/26 geslaagd, inclusief bronidentiteit, hashes, ondertekening, package/versie, productiehosts, releasebeveiliging, R8 en bundletool |
| 16KB-uitlijning | AAB-configuratie en APK ZIP-uitlijning gecontroleerd; alle native ELF-loadsegmenten op arm64-v8a en x86_64 zijn 16KB-compatibel |
| Fysieke toestellen en echte e-mail/Google-aanmelding | Niet uitgevoerd |

De 16KB-controle van native ELF-loadsegmenten geldt voor de twee 64-bit-ABI's. De meegeleverde 32-bit-WebRTC-bibliotheken voor armeabi-v7a en x86 behouden hun bestaande 4KB-loadsegmentuitlijning; hiervoor wordt geen 16KB-ELF-compatibiliteit geclaimd. De volledige controle en de afzonderlijke uitlijningen staan in [builds/0.1.0-1-signed.json](builds/0.1.0-1-signed.json).

### Wat in 0.1.0 is gebouwd

- Native aanmelding met e-mailcode en Google PKCE, versleutelde sessieopslag in Android Keystore, refresh en terugkeer naar de oorspronkelijke baan of wedstrijd.
- Profiel, gebruikersnaam, weergavenaam en spelerspincode. Een bestaand bevestigd account zonder PIN behoudt de normale eigen spelersflow.
- Vandaag, spelen, QR-scanner, korte en bestaande uitnodigingen, baancontext, lobby en een tweede profiel met spelerspincode op één telefoon.
- Schermvullende scoreconsole voor solo, lokaal, thuis en hybride; eigen beurt, lokale schrijver, checkoutdarts, correcties, scorekaart, uitslag en servergestuurde Doorspelen-waarschuwing.
- Vrienden, spelerskamers en wedstrijdchat, community, evenementen/toernooien/competities, profielstatistieken, tegenstanders en oefensessies.
- Oche Live-apparaatbeheer en native camera/microfoon met WebRTC en camera wisselen via de bestaande mediarechten en TURN/signaleringsroutes.
- Een begrensde bearer-API `/api/player/v1` om bestaande domeinfuncties, zonder tweede wedstrijdopslag. Browserauthenticatie en CSRF blijven intact. Afgewezen of herhaalde scores gebruiken dezelfde serverregels als de website.

Deze eerste versie levert de spelersomgeving; er is geen volledige native vervanging van platformbeheer. Meldingen worden in de app opgehaald. FCM-push op de achtergrond en achtergrondvideo zijn niet toegevoegd.

### Oorspronkelijke oplevering van 15 november

De eerste bouwcontrole gebruikte applicatiebron `267fa5c76baed699214bdbd957a042ba901a5559`. Onderstaande debug-APK's en ongetekende AAB zijn de oorspronkelijke controlebestanden. De 0.1.0-productie-APK en ondertekende AAB van 18 november hierboven waren de daaropvolgende oplevering; de actuele 0.1.1-bestanden staan bovenaan deze pagina.

#### Lokale installatie van de historische ontwikkelbuild

De lokale backend is bereikbaar via `http://127.0.0.1:3000`; de ontwikkelapp gebruikt uitsluitend loopback en de bestaande ontwikkelaccounts. Start zo nodig vanaf de repositoryroot `npm run db:start` en `npm run start` na een build, of `npm run dev` tijdens ontwikkeling.

```sh
adb reverse tcp:3000 tcp:3000
adb install -r artifacts/player-android-0.1.0/app-development-debug.apk
```

Open op Android **DartFlow · Development**. Development heeft package `nl.dartflow.app.dev`. De aparte stagingapp heet **DartFlow · Staging**, package `nl.dartflow.app.staging`, en kan naast development, productie en Oche Live worden geïnstalleerd. De stagingapp gebruikt de server-API op de stagingomgeving; de actuele webuitrol staat bovenaan deze pagina.

De oorspronkelijke lokaal gecontroleerde bestanden staan buiten Git in `artifacts/player-android-0.1.0/`:

| Bestand | Gebruik | SHA-256 |
| --- | --- | --- |
| `app-development-debug.apk` | Lokale fixtures, debugondertekend | `4f5478e46fbb118c8ba8268fc17d430e97871887ce549a9908474ca26bcae842` |
| `app-staging-debug.apk` | Staging na serveruitrol, debugondertekend | `286054759ec89a9b5c927e1ae64ac6dbb90f9451864f86b57f3eae54c5636cfb` |
| `app-production-release.aab` | Ongetekende productiebouwcontrole | `c901e5a8a447e5b2363c82ef2adf043f04e6bcc222f1e793dd0ec96c22e7af2d` |

Deze historische ongetekende AAB is niet geschikt voor een Play-upload. De toenmalige [Android-workflow](https://github.com/dartflow/platform/actions/runs/43721440238) levert daarnaast een [downloadpakket met APK's, AAB en bouwrapporten](https://github.com/dartflow/platform/actions/runs/43721440238/artifacts/14164917790), bewaard gedurende 30 dagen. Die PR-bouw gebruikt mergecommit `9b6dcb130279fe4aaf6d2f2659efb61f6d9e09e2`; de volledige bronboom daarvan is gelijk aan de geteste applicatiebron. Debughandtekeningen kunnen per bouwomgeving verschillen; de bovenstaande hashes horen uitsluitend bij de lokaal geleverde bestanden.

#### Controles bij de oorspronkelijke oplevering

Deze controles van 15 november gebruikten uitsluitend lokale ontwikkeldata en geïsoleerde fixtures. De Android-compilatie vond plaats in een aparte ontwikkelmap op de VPS. De huidige signing- en productiebouwcontroles van 18 november staan hierboven.

| Controle | Werkelijk resultaat |
| --- | --- |
| Applicatie-/databasetests | 433 geslaagd, 0 mislukt, 0 overgeslagen |
| Browserregressies voor login, PIN, QR, lokale/online scoreflow, Oche en retries | 11 geslaagd |
| TypeScript, ESLint, Next-productiebuild | Geslaagd |
| Volledige web-CI op dezelfde bronboom | Geslaagd: 433 applicatie-, 46 prototype-, 69 browserproeven en 5 aparte feed/chat-browserproeven; deployment-regressies ook geslaagd |
| Bestaande Oche Live Android-CI | Geslaagd: bouw/lint en 4 telefoon- plus 4 TV-emulatorproeven; Play-publicatie overgeslagen |
| Android JVM-regressies | 24 afzonderlijke tests, elk geslaagd voor development/staging/production: 72 uitvoeringen |
| Native Compose-schermproeven op Android 16-emulator | 8 geslaagd, 0 fouten, 0 overgeslagen; 19,864 seconden |
| Android lint | Geslaagd voor alle drie debugvarianten |
| Development- en staging-APK, production-release-AAB, instrumentation-test-APK | Gebouwd |
| Onafhankelijke artifactcontroles | 22/22 geslaagd: bronidentiteit, package/callback/hostscheiding, versie, releasebeveiliging, bundletool, debughandtekeningen en uitlijning |
| 16KB-compatibiliteit | Bundle-uitlijning en native ELF-loadsegmenten op arm64-v8a en x86_64 gecontroleerd |
| Fysieke apparaten, echte OTP/Google, QR-camera en twee-toestellenvideo | Niet uitgevoerd |

De historische bouwcontrole, artifactgroottes, hashes en uitslagen staan in [builds/0.1.0-1.json](builds/0.1.0-1.json). De [native CI-workflow](https://github.com/dartflow/platform/actions/runs/43721440238), [web-CI](https://github.com/dartflow/platform/actions/runs/43721440279) en [Oche Live-CI](https://github.com/dartflow/platform/actions/runs/43721440261) zijn geslaagd. Het [native UI-rapport](https://github.com/dartflow/platform/actions/runs/43721440238/artifacts/14165546070) bevat de acht werkelijke emulatoruitslagen: aanmelden, profielafronding/PIN, bestaand PIN-loos account, 360×640-scoreconsole zonder scrollen, beurtbevoegdheid, checkoutdarts, vijf scorekaartrijen en de waarschuwing met bereikbaar toetsenblok. Het toetsenblok behoudt in die waarschuwing minstens 40dp toetsruimte. Het HTML-rapport staat in `connected/debug/flavors/development/nl.dartflow.app.PlayerUiTest.html`.

De regressies controleren onder meer voorloopnul in de pincode, afgewezen schrijfrechten, gelijktijdige dubbele scoreaanvragen, stale revisies, gewogen statistieken, eigen uitslag in beide profielen, een late 401 na accountwisseling en het behouden van bestaande lobbylinks. De backendflows gebruiken de echte routehandlers, lokale database en score-engine; externe login is daarbij een lokale testadapter.

### Toenmalige configuratie en vervolg naar toestellen

Er zijn **geen nieuwe databasemigraties of hosted serversecrets** nodig. De adapter gebruikt de bestaande omgevings-, Supabase- en PIN-configuratie. Zie het [backendcontract](backend-api.md) voor routes en verificatie.

De actuele webuitrol staat bovenaan deze pagina. Voor echte provider- en toestelacceptatie blijven deze controles open:

1. Controleer `/api/player/v1/capabilities` en de Supabase-redirectallowlist voor de omgevingsspecifieke HTTPS-authcallback met `native_client` en state voordat de echte providerproeven beginnen.
2. Installeer de juiste APK en test echte e-mail/Google-aanmelding, terugkeer, sessieherstel, QR, twee deelnemers, camera wisselen en video/audio. De lokale fixturetests en geslaagde builds bewijzen deze provider- en apparaatwerking niet.

De spelersapp-signing is ingericht. Volgende releases gebruiken dezelfde eigen configuratie: `PLAYER_UPLOAD_KEYSTORE_PATH`, `PLAYER_UPLOAD_STORE_PASSWORD`, `PLAYER_UPLOAD_KEY_ALIAS`, `PLAYER_UPLOAD_KEY_PASSWORD`, met `-PplayerRequireSigning=true` en een oplopende `-PplayerVersionCode`. De sleutels en wachtwoorden blijven buiten Git en releasebestanden.

Play-publicatie is uitgesloten van deze oplevering. Een latere publicatie vraagt de afzonderlijke Play-vermelding `nl.dartflow.app`, een upload naar de gekozen testtrack en het echte spelersapp-Play-App-Signing-certificaat voor Android App Links.

De workflow vraagt geen wijziging van het GitHub-abonnement en bevat geen automatische Play-upload.
