# DartFlow Speler · eerste native Android-versie

Opgeleverd op 15 november 2026: versie **0.1.0 (1)**, Kotlin/Jetpack Compose, met applicationId **`nl.dartflow.app`**. De spelersschermen zijn ingebouwd in de app. De bestaande DartFlow-server blijft verantwoordelijk voor accounts, rechten, geaccepteerde scores, resultaten en statistieken.

Geteste applicatiebron: `267fa5c76baed699214bdbd957a042ba901a5559`. De latere opleverdocumentatie verandert deze bouwbron niet. De code staat in [PR #1](https://github.com/dartflow/platform/pull/1), als concept voor beoordeling; er is geen merge, hosted uitrol of Play-publicatie uitgevoerd.

## Wat is gebouwd

- Native aanmelding met e-mailcode en Google PKCE, versleutelde sessieopslag in Android Keystore, refresh en terugkeer naar de oorspronkelijke baan of wedstrijd.
- Profiel, gebruikersnaam, weergavenaam en spelerspincode. Een bestaand bevestigd account zonder PIN behoudt de normale eigen spelersflow.
- Vandaag, spelen, QR-scanner, korte en bestaande uitnodigingen, baancontext, lobby en een tweede profiel met spelerspincode op één telefoon.
- Schermvullende scoreconsole voor solo, lokaal, thuis en hybride; eigen beurt, lokale schrijver, checkoutdarts, correcties, scorekaart, uitslag en servergestuurde Doorspelen-waarschuwing.
- Vrienden, spelerskamers en wedstrijdchat, community, evenementen/toernooien/competities, profielstatistieken, tegenstanders en oefensessies.
- Oche Live-apparaatbeheer en native camera/microfoon met WebRTC en camera wisselen via de bestaande mediarechten en TURN/signaleringsroutes.
- Een begrensde bearer-API `/api/player/v1` om bestaande domeinfuncties, zonder tweede wedstrijdopslag. Browserauthenticatie en CSRF blijven intact. Afgewezen of herhaalde scores gebruiken dezelfde serverregels als de website.

Deze eerste versie levert de spelersomgeving; er is geen volledige native vervanging van platformbeheer. Meldingen worden in de app opgehaald. FCM-push op de achtergrond en achtergrondvideo zijn niet toegevoegd.

## Lokale installatie

De lokale backend is bereikbaar via `http://127.0.0.1:3000`; de ontwikkelapp gebruikt uitsluitend loopback en de bestaande ontwikkelaccounts. Start zo nodig vanaf de repositoryroot `npm run db:start` en `npm run start` na een build, of `npm run dev` tijdens ontwikkeling.

```sh
adb reverse tcp:3000 tcp:3000
adb install -r artifacts/player-android-0.1.0/app-development-debug.apk
```

Open op Android **DartFlow · Development**. Development heeft package `nl.dartflow.app.dev`. De aparte stagingapp heet **DartFlow · Staging**, package `nl.dartflow.app.staging`, en kan naast development, productie en Oche Live worden geïnstalleerd. De stagingapp kan pas aanmelden wanneer de nieuwe server-API op staging is uitgerold.

De lokaal gecontroleerde bestanden staan buiten Git in `artifacts/player-android-0.1.0/`:

| Bestand | Gebruik | SHA-256 |
| --- | --- | --- |
| `app-development-debug.apk` | Lokale fixtures, debugondertekend | `4f5478e46fbb118c8ba8268fc17d430e97871887ce549a9908474ca26bcae842` |
| `app-staging-debug.apk` | Staging na serveruitrol, debugondertekend | `286054759ec89a9b5c927e1ae64ac6dbb90f9451864f86b57f3eae54c5636cfb` |
| `app-production-release.aab` | Ongetekende productiebouwcontrole | `c901e5a8a447e5b2363c82ef2adf043f04e6bcc222f1e793dd0ec96c22e7af2d` |

De ongetekende AAB is niet gereed voor upload naar Play. De [Android-workflow](https://github.com/dartflow/platform/actions/runs/43721440238) levert daarnaast een [downloadpakket met APK's, AAB en bouwrapporten](https://github.com/dartflow/platform/actions/runs/43721440238/artifacts/14164917790), bewaard gedurende 30 dagen. Die PR-bouw gebruikt mergecommit `9b6dcb130279fe4aaf6d2f2659efb61f6d9e09e2`; de volledige bronboom daarvan is gelijk aan de geteste applicatiebron. Debughandtekeningen kunnen per bouwomgeving verschillen; de bovenstaande hashes horen uitsluitend bij de lokaal geleverde bestanden.

## Uitgevoerde controles

Uitsluitend lokale ontwikkeldata en geïsoleerde fixtures zijn gebruikt. De Android-compilatie vond plaats in een aparte ontwikkelmap op de VPS; live webservices, signingbestanden en hosted databases zijn niet gewijzigd.

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

De volledige bouwcontrole, artifactgroottes, hashes en uitslagen staan in [builds/0.1.0-1.json](builds/0.1.0-1.json). De [native CI-workflow](https://github.com/dartflow/platform/actions/runs/43721440238), [web-CI](https://github.com/dartflow/platform/actions/runs/43721440279) en [Oche Live-CI](https://github.com/dartflow/platform/actions/runs/43721440261) zijn geslaagd. Het [native UI-rapport](https://github.com/dartflow/platform/actions/runs/43721440238/artifacts/14165546070) bevat de acht werkelijke emulatoruitslagen: aanmelden, profielafronding/PIN, bestaand PIN-loos account, 360×640-scoreconsole zonder scrollen, beurtbevoegdheid, checkoutdarts, vijf scorekaartrijen en de waarschuwing met bereikbaar toetsenblok. Het toetsenblok behoudt in die waarschuwing minstens 40dp toetsruimte. Het HTML-rapport staat in `connected/debug/flavors/development/nl.dartflow.app.PlayerUiTest.html`.

De regressies controleren onder meer voorloopnul in de pincode, afgewezen schrijfrechten, gelijktijdige dubbele scoreaanvragen, stale revisies, gewogen statistieken, eigen uitslag in beide profielen, een late 401 na accountwisseling en het behouden van bestaande lobbylinks. De backendflows gebruiken de echte routehandlers, lokale database en score-engine; externe login is daarbij een lokale testadapter.

## Configuratie en vervolg naar toestellen

Er zijn **geen nieuwe databasemigraties of hosted serversecrets** nodig. De adapter gebruikt de bestaande omgevings-, Supabase- en PIN-configuratie. Zie het [backendcontract](backend-api.md) voor routes en verificatie.

1. Rol de serverwijziging via de bestaande DG Webservices-releaseflow naar staging uit. Controleer `/api/player/v1/capabilities` en de Supabase-redirectallowlist voor de omgevingsspecifieke HTTPS-authcallback met `native_client` en state. Er is daarvoor nog geen dashboardwijziging uitgevoerd.
2. Installeer de staging-APK en test echte e-mail/Google-aanmelding, terugkeer, sessieherstel, QR, twee deelnemers, camera wisselen en video/audio. De lokale fixturetests bewijzen deze provider- en apparaatwerking niet.
3. Richt voor **de spelersapp** eigen signing in: `PLAYER_UPLOAD_KEYSTORE_PATH`, `PLAYER_UPLOAD_STORE_PASSWORD`, `PLAYER_UPLOAD_KEY_ALIAS`, `PLAYER_UPLOAD_KEY_PASSWORD`. Bouw met `-PplayerRequireSigning=true` en een oplopende `-PplayerVersionCode`. Gebruik geen sleutelwaarden in Git of chat. De Oche Live-signingconfiguratie is ongemoeid gelaten.
4. Maak/koppel de afzonderlijke Play-app `nl.dartflow.app`, upload de ondertekende AAB naar intern testen en voeg het echte spelersapp-Play-App-Signing-certificaat aan Android App Links toe. Het Oche Live-certificaat en debugcertificaten vervangen dat niet.

De workflow vraagt geen wijziging van het GitHub-abonnement en bevat geen automatische Play-upload.
