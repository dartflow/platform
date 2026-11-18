# DartFlow Oche Live · oplevering

> Android-status op 18 november 2026: de ondertekende **1.0.1 (1014)** staat in de [Android-release](https://github.com/dartflow/platform/releases/tag/android-2026-11-18). De aangeleverde Play Console-beelden tonen **1.0.0 (1009)** onder Productie. Voor de nieuwe update zijn op verzoek van de eigenaar geen Play-upload, Play-publicatie of Publisher-inrichting uitgevoerd.

## Release en openen

Applicatiebron voor de eerste gesigneerde AAB: `b7648e62a5cd03f73e0590327ff93b4da963bc3a`. De afzonderlijke CI-correcties `b3462738255c33ab21ad885baf4c7246e583893d` en `2bfa40f75bd11fb44d3b05b08cbb73f2741b95d0` bereiden de tijdelijke GitHub TV-runner voor met voldoende opslag en wachten op de Android-services vóór de tests. Android-bron, fixtures en Android-workflow zijn tussen de geslaagde `2bfa40f`-run en deze broncommit ongewijzigd.

Webuitrolstatus op 18 november 2026 voor mainbron `092c8c1e1cca403fbc29ab0679f7efcfc7bb915a`; de workflow- en endpointcontroles staan in [het uitrolbewijs](../evidence/native-player-deployed-2026-11-18.json). De applicatiebron hierboven hoort bij de eerste Android-AAB.

| Omgeving | Openen | Release / workflow | Configuratie | Status |
| --- | --- | --- | --- | --- |
| Staging | https://staging.dartflow.nl/oche-live | [44221218169-1](https://github.com/dartflow/platform/actions/runs/44221218169) | staging-2026-11-12-v19-pin-1 | Geverifieerd: 23/23 rookproeven geslaagd |
| Productie | https://dartflow.nl/oche-live | [44221637689-1](https://github.com/dartflow/platform/actions/runs/44221637689) | production-2026-11-12-v19-pin-1 | Geverifieerd: 23/23 rookproeven geslaagd |

De eerdere webreleases [43533172175-1](https://github.com/dartflow/platform/actions/runs/43533172175) (staging) en [43533760901-1](https://github.com/dartflow/platform/actions/runs/43533760901) blijven historisch bewijs.

Koppelen: `/koppel-scherm`. Beheren en eigen thuissessie kiezen: `/app/schermen`. Lokaal draait de gebouwde applicatie op http://127.0.0.1:3000. De bestaande baanroutes en speel-QR blijven bestaan. De generieke nieuwe schermsessie is alleen-lezen; Doorspelen blijft op de bevoegde telefoon.

## Implementatie

- Kotlin/Jetpack Compose voor telefoon, tablet en TV, met Keystore-opslag, herstel, D-padbediening en native scorekaart.
- Dezelfde versie-1-projectie voor web en Android, met bestaande baanstatussen, scorekaart, stand-by, deadlines en geaccepteerde score-events.
- Expliciete bevestiging via bestaande accountauth, achttekencode met tien minuten geldigheid, gedeelde quota, hernoemen, baantoewijzing, intrekken en atomisch vervangen.
- Thuis één scherm; fysieke locatie standaard twee. Centrale limietaanpassing geeft geen locatiebeheersrechten. Oudere private koppelingen tellen mee.
- Duurzame nonces, herstel na verloren antwoorden, canonieke UUID-locks, actuele grantcontrole bij elke poll en behoud van de laatste stand bij tijdelijke verbindingsfouten.

## Migratie en configuratie

`supabase/migrations/20261113162231_oche_display_installations.sql` is uitbreidend. Alle acht nieuwe tabellen hebben RLS; anon, authenticated en service_role kunnen ze niet lezen. De beperkte serverrol heeft de benodigde DML-rechten. De featuremarker is `oche_display_devices=1`.

De migratie is op staging en productie toegepast. De featuremarker en alle acht tabellen zijn na toepassing gecontroleerd op RLS en rolrechten. Er zijn geen nieuwe security-advisors; de bestaande meldingen bleven gelijk.

Voor beide omgevingen is vóór de migratie een consistente applicatieback-up gemaakt en onafhankelijk gecontroleerd op vijf checksums en volledige decodeerbaarheid. Dit was geen herstelproef. Supabase Auth en providerconfiguratie vallen buiten deze applicatieback-up.

Er zijn geen nieuwe verplichte runtime- of GitHub-secrets nodig voor de webrelease. Optioneel kan `DARTFLOW_SCREEN_PAIRING_SECRET` als afzonderlijk servergeheim worden ingericht. De schermcryptografie gebruikt afzonderlijke HMAC-doelsleutels uit de reeds aanwezige `DARTFLOW_MAIL_WORKER_TOKEN`. Rotatie kan codes, toegang en herstelgegevens ongeldig maken; plan en controleer het herstel.

## Uitgevoerde controles

- Web-CI [43468797827](https://github.com/dartflow/platform/actions/runs/43468797827) op de exacte applicatie-SHA: typecheck, ESLint en productiebuild geslaagd; 419/419 unit-/integratietests, 46/46 prototypetests, 15/15 Play-pipelinetests en 64/64 deployertests geslaagd.
- Volledige browserregressie: 69/69 geslaagd (8,2 minuten), plus 5/5 afzonderlijke Feed-/chatregressies.
- Nieuwe lokale browserproeven omvatten QR/login-terugkeer, twee tabs, quota 2→3→2, atomisch vervangen, verloren redeem-/refreshantwoorden, offline/herstel, intrekken binnen vijf seconden en herstel na 503 met Retry-After.
- Regressies voor gelijktijdige claims met verschillende UUID-hoofdletters en een thuispoll met negen van tien databaseverbindingen bezet slagen.
- Browserlayout gecontroleerd op 1920×1080, 1080×1920, 720×1280 en 390×844: vijf scorekaartrijen en geen horizontale overflow.
- Native lokale build: 24 JVM-tests geslaagd, APK/AAB gebouwd, lint zonder fouten, bundletoolvalidatie en 16KB-uitlijning voor alle vier ABI’s geslaagd. Native CI en telefoon/TV-runtime: [43472411503](https://github.com/dartflow/platform/actions/runs/43472411503) op de pipeline-SHA `2bfa40f` is volledig geslaagd. Alle vier instrumentatietests zijn zowel op de Android 36-telefoonemulator als op de Android 36 TV-emulator uitgevoerd en geslaagd; geen app-tests overgeslagen. Ze controleren koppelscherm/nieuwe code, live spelersnamen en spiegelkaart, herstelactie na intrekken en versleutelde Keystore-opslag. De Play-signing/publicatiejob is bewust overgeslagen omdat die nog niet is ingericht.

De lokale CI-samenvatting staat in `artifacts/oche-android/ci-2bfa-results.json`; de HTML-rapporten staan onder `ci-phone-ui-2bfa40f/` en `ci-tv-ui-2bfa40f/` in dezelfde map. De TV-servicecontrole slaagde op 141 seconden; alle vier app-tests zijn daarna uitgevoerd.

Alle volledige score-, quota-, race- en koppelproeven gebruiken lokale synthetische gegevens. De lokale browserproeven gebruiken Michael de Groot en Danny Goldenbelt, zonder echte mail of externe gebruikersaccounts. De hosted smoke controleert alleen publieke endpoints en tijdelijke, anonieme koppelingen; zij maakt geen account, actief schermgrant of wedstrijd aan.

Staging: 26/26 hosted controles geslaagd op `bee3dc43`, waaronder health/readiness, API-versie, read-onlyrechten, CSRF, achttekencode, tien minuten geldigheid, herladen, nieuwe code binnen dezelfde installatie, QR-fragment wissen, verplichte login en geen automatische koppeling en HttpOnly/Secure/SameSite-cookies. Er waren geen browserfouten.

Productie: dezelfde 26/26 hosted controles geslaagd op exact dezelfde applicatie-SHA. Health en readiness bevestigen release `43471693074-1` en de productieconfiguratie. De volledige account-/wedstrijdmutaties zijn bewust uitsluitend lokaal uitgevoerd.

De TV-runner is daarbij aangepast na twee eerdere infrastructuurfouten vóór app-installatie: onvoldoende schijfruimte en een te vroege ADB-ontgrendeling. De definitieve run gebruikt dezelfde vier app-tests en vereist expliciet nul fouten en nul overgeslagen tests.

## Android-artefacten

De lokale staging-debug-APK staat in `artifacts/oche-android/oche-live-staging-debug.apk`.
SHA-256: `05f22e9c0a4cf227c94da9d48949152a5c151e14c01d4be4ee03910fe36f0f6b`.

De technische productie-AAB in `artifacts/oche-android/oche-live-production-release-unsigned.aab` is **ongesigneerd** en niet geschikt voor Play-upload.
SHA-256: `1d2670dc5c5d336807dcf2fda1c4ca62a5764190db7f08e35242fc0a1926a9cf`.

Deze eerdere lokale build gebruikt versie 1.0.0, lokale versionCode 1, compile/target SDK 36 en min SDK 26. Hij is niet naar Play geüpload. Staging gebruikt `nl.dartflow.ochelive.staging`; de eerste gesigneerde productiebuild hieronder gebruikt `nl.dartflow.ochelive` en versionCode 1009.

## Historisch: eerste ondertekende appbundel

[Historische download `oche-signed-aab` (ZIP)](https://github.com/dartflow/platform/actions/runs/43618459740/artifacts/14123204748). Aanmelden op GitHub met leesrechten voor de repository is vereist. Deze eerste build van 14 november blijft beschikbaar tot 12 februari 2027.

- Versie **1.0.0 (1009)**, package `nl.dartflow.ochelive`, productiebackend `https://dartflow.nl`.
- AAB: 2.704.145 bytes, SHA-256 `b6ae4521a4ea90aedc00f29810d6a9d258ebb36a6b09f554711a0b7195c5fcb1`.
- [Workflow 43618459740](https://github.com/dartflow/platform/actions/runs/43618459740): alle vier jobs geslaagd; 15 Play-pipelinetests, lint/bouw/JVM-tests, vier telefoon- en vier TV-instrumentatietests uitgevoerd en geslaagd. De Google-authenticatie- en Play-uploadstappen zijn overgeslagen.
- Onafhankelijk na download: 15/15 controles geslaagd. GitHub-archiefdigest en AAB-handtekening gecontroleerd; signer komt overeen met het eigen uploadcertificaat. Bundletool valideert package/versie, min SDK 26 en target SDK 36. De bundle bevat `PAGE_ALIGNMENT_16K`; alle native ELF-bestanden van arm64-v8a, armeabi-v7a, x86 en x86_64 zijn op 16KB-uitlijning gecontroleerd.
- Het [buildbewijs van 14 november](builds/1.0.0-1009.json) bevat de broncommit, checksums, artifactgegevens en testuitslagen van de signing-only run. De aangeleverde Play Console-beelden bevestigen inmiddels 1009 onder Productie; het historische buildbewijs blijft bewaard.

## Ondertekende update van 18 november 2026

De update behoudt `enableEdgeToEdge` en `safeDrawing`, stelt de systeembalkstijl expliciet in voor de donkere interface en schakelt geoptimaliseerde R8-resourcereductie in. De Android Gradle Plugin blijft op de bestaande versie. De Play Console-waarschuwingen zijn pas na een nieuwe Play-upload opnieuw te beoordelen.

- [Download de Android-release](https://github.com/dartflow/platform/releases/tag/android-2026-11-18): **DartFlow-Oche-Live-1.0.1-1014.aab**, package `nl.dartflow.ochelive` en productiebackend `https://dartflow.nl`. Repositorytoegang is vereist.
- Lokaal gesigneerd op `main`-SHA `092c8c1e1cca403fbc29ab0679f7efcfc7bb915a`. De volledige Git-bronboom is gelijk aan de geteste PR-commit `65a842a44c69cff3d1b55f93dca87461195e3bb1`. [PR-CI 44216973667](https://github.com/dartflow/platform/actions/runs/44216973667) slaagde voor lint, bouw, unit tests en telefoon-/TV-instrumentatie.
- Versiecode `1014 = 1000 + 14`, ontleend aan [main-workflow 44219479004](https://github.com/dartflow/platform/actions/runs/44219479004). De ondertekende AAB is lokaal gebouwd; release-lint en **12/12 productie-unit-tests** zijn geslaagd.
- AAB: **2.699.733 bytes**, SHA-256 `8832dafd2fdffb012b695b5470eef849c66a5600809b8be66a48fd9b47b387dd`.
- **17/17 onafhankelijke controles** geslaagd: uploadcertificaat, pakket/versie, SDK 26/36, bundletoolvalidatie en 16KB-uitlijning van alle vier ABI’s. De AAB-metadata bevestigt geoptimaliseerde R8-resourcereductie en codeoptimalisatie.
- Het [buildbewijs](builds/1.0.1-1014.json) legt lokale herkomst, testboom, checksums en controles vast. Play-upload en -publicatie van deze update vallen buiten deze oplevering.

## Google Play en vervolgstappen

De uploadkeystore en vier signingsecrets zijn sinds 14 november ingericht; de versleutelde herstelkopie is geverifieerd. Zie het [runbook](google-play-runbook.md#2-uploadsleutel-en-eerste-aab). Google-authenticatie en Play-tracks zijn niet in GitHub ingericht; `OCHE_PLAY_ENABLED=false`. Voor deze oplevering zijn geen Publisher-accountinstellingen, abonnementen of Play-publicaties gewijzigd.

| Naam | Plaats | Status |
| --- | --- | --- |
| OCHE_JAVA_VERSION | Repository variable | 17 |
| OCHE_VERSION_CODE_BASE | Repository variable | 1000 |
| PLAY_PACKAGE_NAME | Repository variable | nl.dartflow.ochelive |
| OCHE_SIGNING_ENABLED | Repository variable | true |
| OCHE_PLAY_ENABLED | Repository variable | false |
| ANDROID_UPLOAD_KEYSTORE_BASE64 | Secret in play-internal | Ingericht; waarde blijft geheim |
| ANDROID_UPLOAD_STORE_PASSWORD | Secret in play-internal | Ingericht; waarde blijft geheim |
| ANDROID_UPLOAD_KEY_ALIAS | Secret in play-internal | Ingericht |
| ANDROID_UPLOAD_KEY_PASSWORD | Secret in play-internal | Ingericht; waarde blijft geheim |
| PLAY_WIF_PROVIDER | Variable per Play-environment | Alleen bij optionele latere API-automatisering |
| PLAY_SERVICE_ACCOUNT | Variable per Play-environment | Alleen bij optionele latere API-automatisering |
| PLAY_INTERNAL_TRACKS | Repository variable | Alleen bij optionele latere API-automatisering |
| PLAY_PRODUCTION_TRACKS | Repository variable | Alleen bij optionele latere API-automatisering |
| PLAY_APP_SIGNING_SHA256 | Repository variable en publieke certificaatconfig | Werkelijk Play App Signing-certificaat nodig |

Een eventuele volgende Play-upload of promotie gebeurt handmatig in Play Console. Het echte **Play-appsigningcertificaat** is nog niet vastgelegd in `config/android-app-links.json`; de uploadcertificaatfingerprint vervangt dit certificaat niet. Certificaatconfiguratie en Publisher-automatisering vallen buiten deze oplevering.

`/.well-known/assetlinks.json` geeft bewust HTTP 200 met `[]` tot een echt certificaat beschikbaar is. Er is geen debug- of uploadcertificaat als Play-appverificatie gepubliceerd. De huidige private GitHub-repository ondersteunt volgens de API geen beschermde tag-rulesets op het huidige abonnement; automatische productiepromotie weigert een onbeschermde `oche-v*`-tag. De gekozen handmatige Console-route heeft die bescherming niet nodig.

Echte telefoon/TV, afstandsbediening, grote systeemletters, ambient, herstart na stroomuitval, een Play-update met behoud van koppeling en Play App Links test de eigenaar later, zoals afgesproken. De debug-APK is een stagingtest; de uiteindelijke Play-build heeft eigen signing.

## Handleidingen en fase 2

- [Browser en wedstrijdleiding](browser-installatie.md)
- [Native bouwen en installeren](../../android/oche-live/README.md)
- [Google Play en GitHub](google-play-runbook.md)
- [Versie-1-API en toekomstige spelersapp](backend-api.md)
- [Contract en gedeelde fixtures](../../contracts/README.md)

De management-API gebruikt nu dezelfde geauthenticeerde browsercookies en Origin-controle als DartFlow. Een latere native spelersapp kan de bevestigingslink openen en dit beheercontract hergebruiken met een eigen, expliciet ontworpen accountauth-integratie. Een Oche-displaytoken wordt nooit een spelerssessie.
