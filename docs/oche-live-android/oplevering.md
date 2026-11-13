# DartFlow Oche Live · oplevering

## Release en openen

Applicatiebron: `bee3dc43ea01e178c8805ffa7b8e2d4a851ad0c4`. De afzonderlijke CI-correcties `b3462738255c33ab21ad885baf4c7246e583893d` en `2bfa40f75bd11fb44d3b05b08cbb73f2741b95d0` bereiden de tijdelijke GitHub TV-runner voor met voldoende opslag en wachten op de Android-services vóór de tests. De 38 Android-buildinvoerbestanden zijn ongewijzigd.

| Omgeving | Openen | Release | Configuratie |
| --- | --- | --- | --- |
| Staging | https://staging.dartflow.nl/oche-live | [43471131093-1](https://github.com/dartflow/platform/actions/runs/43471131093) | staging-2026-11-12-v19-pin-1 |
| Productie | https://dartflow.nl/oche-live | [43471693074-1](https://github.com/dartflow/platform/actions/runs/43471693074) | production-2026-11-12-v19-pin-1 |

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

Deze build gebruikt versie 1.0.0, lokale versionCode 1, compile/target SDK 36 en min SDK 26. Er is nog geen Play-versiecode toegewezen of geüpload. Staging gebruikt `nl.dartflow.ochelive.staging`; het voorgestelde productie-ID is `nl.dartflow.ochelive` en moet vóór de eerste upload in Play worden bevestigd.

## Nog door de eigenaar in te richten voor Google Play

De gebruiker heeft bevestigd dat de Console-app nog niet bestaat. Er is geen Play-track in GitHub geconfigureerd en er is geen upload, review of productiepublicatie uitgevoerd. De beide GitHub Play-omgevingen zijn voorbereid; signing en publiceren staan uit.

| Naam | Plaats | Status |
| --- | --- | --- |
| OCHE_JAVA_VERSION | Repository variable | 17 |
| OCHE_VERSION_CODE_BASE | Repository variable | 1000 |
| PLAY_PACKAGE_NAME | Repository variable | nl.dartflow.ochelive |
| OCHE_SIGNING_ENABLED | Repository variable | false |
| OCHE_PLAY_ENABLED | Repository variable | false |
| ANDROID_UPLOAD_KEYSTORE_BASE64 | Secret in play-internal | Eigen uploadsleutel nog invoeren |
| ANDROID_UPLOAD_STORE_PASSWORD | Secret in play-internal | Nog invoeren |
| ANDROID_UPLOAD_KEY_ALIAS | Secret in play-internal | Nog invoeren |
| ANDROID_UPLOAD_KEY_PASSWORD | Secret in play-internal | Nog invoeren |
| PLAY_WIF_PROVIDER | Variable per Play-environment | Werkelijke Google-provider nog invoeren |
| PLAY_SERVICE_ACCOUNT | Variable per Play-environment | Werkelijk serviceaccount nog invoeren |
| PLAY_INTERNAL_TRACKS | Repository variable | Werkelijke track-ID’s na eerste upload |
| PLAY_PRODUCTION_TRACKS | Repository variable | Werkelijke track-ID’s na eerste upload |
| PLAY_APP_SIGNING_SHA256 | Repository variable en publieke certificaatconfig | Werkelijk Play App Signing-certificaat nodig |

Maak de Console-app en uploadsleutel, vul de vier signingsecrets in en bouw met `signed_bundle=true` eerst een gesigneerde AAB zonder API-upload. Upload die voor het eerst handmatig, activeer Play App Signing, configureer het echte certificaat in `config/android-app-links.json` en deploy die publieke configuratie. Richt daarna WIF, apprechten en de echte tracks in. Activeer publiceren pas na verificatie. De pipeline promoveert dezelfde intern geteste versionCode, zonder herbouw.

`/.well-known/assetlinks.json` geeft bewust HTTP 200 met `[]` tot een echt certificaat beschikbaar is. Er is geen debugcertificaat als productieverificatie gepubliceerd. De huidige private GitHub-repository ondersteunt volgens de API nog geen beschermde tag-rulesets op het huidige abonnement; automatische productiepromotie weigert een onbeschermde `oche-v*`-tag. Het runbook beschrijft de benodigde bescherming.

Echte telefoon/TV, afstandsbediening, grote systeemletters, ambient, herstart na stroomuitval, een Play-update met behoud van koppeling en Play App Links test de eigenaar later, zoals afgesproken. De debug-APK is een stagingtest; de uiteindelijke Play-build heeft eigen signing.

## Handleidingen en fase 2

- [Browser en wedstrijdleiding](browser-installatie.md)
- [Native bouwen en installeren](../../android/oche-live/README.md)
- [Google Play en GitHub](google-play-runbook.md)
- [Versie-1-API en toekomstige spelersapp](backend-api.md)
- [Contract en gedeelde fixtures](../../contracts/README.md)

De management-API gebruikt nu dezelfde geauthenticeerde browsercookies en Origin-controle als DartFlow. Een latere native spelersapp kan de bevestigingslink openen en dit beheercontract hergebruiken met een eigen, expliciet ontworpen accountauth-integratie. Een Oche-displaytoken wordt nooit een spelerssessie.
