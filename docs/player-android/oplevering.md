# DartFlow Speler · native Android-opleveringen

## Actuele release · 0.6.1 (10)

DartFlow Speler **0.6.1**, versionCode **10**, pakket **`nl.dartflow.app`**, hoort bij productbron [`d1adf84c08061f606ccbd11b5abaec5c5bda5289`](https://github.com/dartflow/platform/commit/d1adf84c08061f606ccbd11b5abaec5c5bda5289), normaal gemerged via [PR 27](https://github.com/dartflow/platform/pull/27). Desktop en mobiele web/PWA zijn op staging en productie geaccepteerd. De Android-bestanden zijn met de bestaande uploadsleutel ondertekend en op **22 november 2026 om 20:58:24 UTC** als [GitHubrelease android-player-0.6.1-10](https://github.com/dartflow/platform/releases/tag/android-player-0.6.1-10) geleverd; De [onafhankelijke Play-nacontrole](https://github.com/dartflow/platform/actions/runs/45069821263) bevestigt op **22 november 2026 om 21:03:44 UTC** intern en productie elk alleen **code 10 `completed`**. Google-goedkeuring en ontvangst op een specifieke telefoon zijn niet afzonderlijk gemeten. De [volledige releasebeschrijving](../releases/0.6.1.md) en het [uitgiftebewijs](../evidence/release-0.6.1-2026-11-22.json) houden productbron, CI, hosting, signing en distributie apart.

X01 opent standaard met een schermvullend beurtotaal over **drie pijlen**. Het gebruikte aantal is aanpasbaar; een finish vereist een expliciete keuze en toepasselijke uitgooibevestiging. Via **Instellingen → Score-invoer** kies je voor X01 en leguitdagingen afzonderlijk totaal of per pijl. Dit wordt per account **op dit toestel** bewaard en niet naar browsers of andere telefoons gesynchroniseerd. Cricket, Tactics en doelspellen behouden hun pijl-/doelregistratie. De kernroutes voor double-in, straight-out en master-out blijven werkelijke treffers vereisen; Play kan na openen totalen toestaan. Een leguitdaging die pijlen vergelijkt vereist altijd pijlregistratie.

De scoreweergave omvat wedstrijden, vrije partijen en oefeningen, bestaande trainingen en offline hervatten. Grote cijferknoppen met een aparte segmentkeuze voorkomen afgebroken labels. Terug/heropenen en invoerwissels bewaren een niet-verzonden concept. Een sessieverlenging behoudt het Play-concept; een geaccepteerde beurt reset het voor de nieuwe werper. Serverrechten en offline replay blijven bepalend.

| Controle op 0.6.1 (10) | Werkelijk resultaat |
| --- | --- |
| [Player MAIN CI 45064499653](https://github.com/dartflow/platform/actions/runs/45064499653) | SUCCESS op de exacte productbron. Verify-producer uit **poging 1**: **157 JVM-methoden per variant / 471 uitvoeringen**, lint en builds. UI-producer uit **poging 3**: **90 werkelijk uitgevoerde methoden**, nul fouten/skips; eerdere 89 behouden. Poging 1 en 2 faalden vóór UI-uitvoering op publieke Maven-resolutie; normale herhaling na afkoeling, zonder bron- of dependencywijziging. |
| Bron- en artifactbinding | **145** native bronbestanden plus **drie** CI-gates gecontroleerd; build- en UI-archives met hun eigen producerpoging, grootte en digest geverifieerd. |
| Visuele controle | **21 echte PNG's, alle 21 individueel bekeken**, van een API 36 google_apis x86_64-emulator met synthetische fixtures. Compacte/grote tekst, scoresysteem, instellingen, thema's en bestaande navigatie-/supportschermen beoordeeld. |
| [Web MAIN CI 45064499677](https://github.com/dartflow/platform/actions/runs/45064499677) | Poging 1: **909** servertests, **47** prototypetests, **130** browsercases en afzonderlijk **5** overlappende Feed/chat-cases geslaagd, zonder skips of browserretries; typecheck/lint/build geslaagd. |
| Ondertekening | Bestaande uploadsleutel; CI-AAB-payload buiten ondertekening bytegelijk. Universele APK uit dezelfde ondertekende AAB, **zonder hercompilatie**. Bundlevalidatie, jarsigner/apksigner, AAB `PAGE_ALIGNMENT_16K`, APK ZIP-uitlijning en 64-bit-ELF-loadsegmenten geslaagd. |
| Staging-APK | Exact CI-debugbestand, `nl.dartflow.app.staging`, **0.6.1-staging/code 10**, ingebouwde stagingbackend en handtekening gecontroleerd. SHA-256 `7eaefe6f02dbf4198c83f38bed2b957123510b561c2b35e7d5fe79417f3c6ec5`; niet opnieuw gebouwd of fysiek geïnstalleerd. |
| Staging / productiebackend | [45068084137](https://github.com/dartflow/platform/actions/runs/45068084137) / [45068534584](https://github.com/dartflow/platform/actions/runs/45068534584), dezelfde bron; health/ready, beschermde review-account-GETs en elk twaalf individueel bekeken openbare desktop-/mobiele browserbeelden geslaagd. |
| GitHublevering | Alle **11 assets** vers gedownload en op grootte, SHA-256 en GitHubdigest gecontroleerd: drie APK/AAB-bestanden en acht controlebestanden. De 21 emulatorbeelden zijn afzonderlijk in het CI-bewijs bewaard. |
| Google Play | Alle vier normale acties, elk poging 1, geslaagd: [toegangscontrole](https://github.com/dartflow/platform/actions/runs/45069431546), [interne upload](https://github.com/dartflow/platform/actions/runs/45069535417), [productiepromotie](https://github.com/dartflow/platform/actions/runs/45069697519) en [onafhankelijke nacontrole](https://github.com/dartflow/platform/actions/runs/45069821263). Laatste read **21:03:44 UTC**: intern/productie elk alleen **code 10 `completed`**, met dezelfde productbron en AAB. |
| Fysieke toestellen | Niet uitgevoerd. Gehoste scoremutaties, nieuwe OTP-/Google-aanmelding, camera/video, installatie en pushontvangst zijn niet uit bovenstaande controles afgeleid. |

| Ondertekend bestand | Grootte | SHA-256 |
| --- | --- | --- |
| [app-production-release.aab](https://github.com/dartflow/platform/releases/download/android-player-0.6.1-10/app-production-release.aab) | 28.527.374 bytes | `d53d57fe77c3a2db2d114ac5a908ca2c7555796a2bf5b86828e10b8401bdadfb` |
| [app-production-release.apk](https://github.com/dartflow/platform/releases/download/android-player-0.6.1-10/app-production-release.apk) | 50.661.129 bytes | `d03c4fdcc0433e6fb8c2e97206e024a59890c6579c801bc36bc2e40743eb16a9` |
| [release-evidence.json](https://github.com/dartflow/platform/releases/download/android-player-0.6.1-10/release-evidence.json) | Ondertekeningsbewijs | `e16d17192c8206dae9f0626eae8a442888139b79d8709f1b8f039e2f8d6bf660` |
| [release-receipt.json](https://github.com/dartflow/platform/releases/download/android-player-0.6.1-10/release-receipt.json) | Bron-/versie-/certificaatbinding | `b376aee1458d27a326d4ec4bdc60d84528cd0e3ec4a652e4d26d6854512bc60d` |

Het uploadcertificaat blijft `97:C8:A2:78:FF:67:14:BD:E4:F1:BC:B5:4E:BA:15:12:28:D4:2E:83:8F:11:D4:3B:CF:6E:71:C7:DE:08:A0:09`; het afzonderlijke Play App Signing-certificaat blijft `DE:54:EB:62:ED:D3:10:AA:F9:39:0F:47:6D:AF:73:E2:94:13:75:CE:EE:BE:DC:0B:89:D8:8D:E2:D4:EC:3E:F1`. De 16KB-ELF-controle geldt voor arm64-v8a en x86_64; de bestaande 32-bit-WebRTC-loadsegmenten zijn 4KB. Het bevroren signingreceipt heeft `playUpload=false` als status van het ondertekenmoment; latere Play-handelingen krijgen eigen bewijs.

De vorige geverifieerde productuitgifte is **[0.6.0/code 9](../releases/0.6.0.md)**, bron `f527ed618b18a12d588b8bdc6fa12edc6f47cbdb`, toen intern/productie op Play `completed`. De secties hieronder bewaren oudere native opleveringen en hun eigen hashes. Oche Live is in deze Player-release niet opnieuw gepubliceerd.

## Historische ondertekende release · 0.1.3 (4)

DartFlow Speler **0.1.3**, versionCode **4**, pakket **`nl.dartflow.app`**, is ondertekend gepubliceerd als [GitHubrelease `android-player-0.1.3-4`](https://github.com/dartflow/platform/releases/tag/android-player-0.1.3-4). De exacte applicatiebron is [`4a234040109b0c5f1dd8118462a0dea3ae062994`](https://github.com/dartflow/platform/commit/4a234040109b0c5f1dd8118462a0dea3ae062994), met de scorewijziging uit [PR #14](https://github.com/dartflow/platform/pull/14), de nieuwe startpagina uit [PR #15](https://github.com/dartflow/platform/pull/15) en de footercontroles uit [PR #16](https://github.com/dartflow/platform/pull/16) en [PR #17](https://github.com/dartflow/platform/pull/17). Beide backends draaien dezelfde bron. De Play-API bevestigt versiecode **4** op intern en productie; Google-goedkeuring en openbare beschikbaarheid zijn niet vastgesteld. Het [samengevoegde releasebewijs](../evidence/player-home-score-2026-11-18.json) houdt de applicatiebron apart van een latere documentatiecommit.

### Wat verandert in 0.1.3

- **Community als startpagina:** maximaal vijf echte berichten, met dezelfde reacties, moderatie en plaatsingsrechten als de bestaande feed. De actieve partij, baan-QR en Vrij spelen blijven direct bereikbaar. Community en speelacties laden onafhankelijk; een feedfout blokkeert spelen niet. De feedcache staat alleen in het geheugen en wordt onder meer bij aanmelden, accountwissel en uitloggen gewist. Automatische HOME-reads staan minimaal 15 seconden uit elkaar; terugkeren en handmatig verversen halen direct op. De gewone live poll-tick blijft behouden.
- **Duidelijkere navigatie:** consistente pictogrammen, een scrollbaar Meer-menu en de juiste geselecteerde hoofdrubriek op detailpagina's. De snelkoppelingen Statistieken en Historie blijven op één regel en krijgen bij grote systeemtekst elk een volle rij met een aanraakvlak van minimaal 48dp. De algemene verkleining van koppen en kaarten hoort bij de historische 0.1.2 hieronder.
- **Sneller verder na een worp:** de app verwerkt de geaccepteerde serverresponse direct, inclusief Dartbotbeurt en actuele rechten. Het blokkerende pad gaat van vijf naar één HTTP-request. Oude polls en herhaalde responses kunnen een nieuwere stand niet terugdraaien. De gerichte trainingsprojectie verstuurt geen volledige undo-snapshots; undo blijft op de server werken. De app berekent geen voorlopige score.
- **Volledige beurttekst onder 501:** de scorekaarten reserveren ruimte voor naam, restscore en beurtstatus, inclusief grotere systeemtekst.

De [lokale benchmark](../evidence/native-player-score-latency-2026-11-18.json) mat met synthetische ontwikkeldata **575 → 23 databasequeries** in het blokkerende trainingspad. Dit is geen gemeten mobiele of productievertraging: netwerk, TLS en gehoste Auth vallen buiten die meting. Er zijn geen nieuwe migraties, secrets of authenticatiewijzigingen nodig.

| Controle op 0.1.3 (4) | Werkelijk resultaat |
| --- | --- |
| Worker-lokale Kotlin/JVM | **53 geslaagd**, 0 mislukt, 0 overgeslagen; alle **28** UI-tests compileren. De worker heeft geen lokale emulatorproef uitgevoerd. |
| Lokale gerichte API-regressies | **29 geslaagd**, 0 mislukt, 0 overgeslagen; typecheck en lint van de gewijzigde backendbestanden geslaagd. |
| [Native CI](https://github.com/dartflow/platform/actions/runs/44411071496) | Geslaagd: lint en builds voor de drie varianten, **53 JVM-tests per variant / 159 uitvoeringen** en **28 uitgevoerde native UI-tests**; 0 mislukte of overgeslagen tests. |
| [Web-CI](https://github.com/dartflow/platform/actions/runs/44411071479) | Geslaagd: **474** applicatietests, **46** prototypetests, **5** aparte Feed/chat-browserproeven, **72** volledige browserproeven en **166** Python-regressies; typecheck, lint, build en packaging geslaagd. |
| [Oche Live-CI](https://github.com/dartflow/platform/actions/runs/44411071592) | Geslaagd: lint/tests/debugbuild en telefoon-/Android TV-proeven. Dit controleert de afzonderlijke app; er is geen Oche Live Play-release uitgevoerd. |
| Native visuele releasecontrole | **PASS / GO**: zes synthetische PNG's met volledige fixturebreedte; alle zes gemeten binnen het fysieke emulatoroppervlak. De HOME-footer slaagt ook met systeemtekst **1,6×**; de scorestatus is volledig bij **1,0× en 1,3×**. |
| Ondertekening en bundelcontrole | Geslaagd: bestaande uploadsleutel, jarsigner/apksigner, bundletoolvalidatie, package/versie/productiehost, AAB `PAGE_ALIGNMENT_16K`, APK ZIP-uitlijning en alle 64-bit-ELF-loadsegmenten. |
| [Staging](https://github.com/dartflow/platform/actions/runs/44413151778) | Geslaagd: release `44413151778-1`, config `staging-2026-11-18-play-safety-1`; exacte bron hierboven, health `ok`, ready `ready`, database `ok`, Auth `reachable`. |
| [Productiebackend](https://github.com/dartflow/platform/actions/runs/44413713570) | Geslaagd: release `44413713570-1`, config `production-2026-11-18-play-safety-1`; dezelfde bron, health `ok`, ready `ready`, database `ok`, Auth `reachable`. |
| Publieke releasepreflight | Geslaagd: beide backends en native capabilities; productie-App Links met het Play-certificaat en de vier juridische pagina's. De anonieme gerichte trainingsread geeft op beide omgevingen **401**. Deze controles zijn alleen-lezen. |
| [Play interne upload](https://github.com/dartflow/platform/actions/runs/44414825686) | Geslaagd: API-edit gecommit voor versiecode **4**, exacte AAB-hash door de workflow gecontroleerd. |
| [Play productiepromotie](https://github.com/dartflow/platform/actions/runs/44415019037) | Geslaagd: API-edit gecommit voor dezelfde versiecode **4** en AAB-hash. |
| [Afzonderlijke Play-trackcontrole](https://github.com/dartflow/platform/actions/runs/44415166749) | Geslaagd op **18 november 2026 om 22:50:12 UTC**: `internal` en `production` bevatten elk alleen versiecode **4**, API-status **`completed`**. Dit bewijst geen Google-goedkeuring of openbare beschikbaarheid. |
| Fysieke toestellen | Niet uitgevoerd. Echte aanmelding, QR-camera, videobelverbinding en systeemtekst op echte telefoons blijven apparaatcontroles. |

De vijf gerichte Feed/chat-browserproeven overlappen de volledige browsersuite en zijn afzonderlijk herhaald.

| Bestand van `android-player-0.1.3-4` | Grootte | SHA-256 |
| --- | --- | --- |
| [app-production-release.aab](https://github.com/dartflow/platform/releases/download/android-player-0.1.3-4/app-production-release.aab) | 26.336.260 bytes | `faf386e230345ea5d1c4eccfd36194a55c416f10c53f4f4b49cdb791b37ab251` |
| [app-production-release.apk](https://github.com/dartflow/platform/releases/download/android-player-0.1.3-4/app-production-release.apk) | 49.621.844 bytes | `44c80f67d8e81dbb7936ab8b1dc258c080087a12790b19b245facc685be089a8` |
| [release-evidence.json](https://github.com/dartflow/platform/releases/download/android-player-0.1.3-4/release-evidence.json) | 8.571 bytes | `bd37a2b85c8f1513af81641c445d09479442af1b44c454841005dcd0136c6eb4` |
| [release-receipt.json](https://github.com/dartflow/platform/releases/download/android-player-0.1.3-4/release-receipt.json) | 667 bytes | `90a9b22a8a5a38ba18c71dc28f3ab4593bc7f32a18c5bce986da27d72d7f029d` |

Alle tien releaseassets — de vier bestanden hierboven en zes PNG's — zijn op grootte en SHA-256 vergeleken met de GitHubassetdigests. De universele APK is uit de exacte ondertekende CI-AAB gemaakt, zonder hercompilatie. Het uploadcertificaat is ongewijzigd: `97:C8:A2:78:FF:67:14:BD:E4:F1:BC:B5:4E:BA:15:12:28:D4:2E:83:8F:11:D4:3B:CF:6E:71:C7:DE:08:A0:09`. Het afzonderlijke Play App Signing-certificaat staat in het releasebewijs. Het bevroren receipt bewaart `playUpload=false` van het ondertekenmoment; de latere Play-upload staat afzonderlijk in het samengevoegde bewijs.

De zes gepubliceerde beelden zijn [aanmelden](https://github.com/dartflow/platform/releases/download/android-player-0.1.3-4/compact-login.png), [schermbeheer](https://github.com/dartflow/platform/releases/download/android-player-0.1.3-4/compact-screens.png), [evenementen](https://github.com/dartflow/platform/releases/download/android-player-0.1.3-4/compact-events.png), [community-home](https://github.com/dartflow/platform/releases/download/android-player-0.1.3-4/compact-home-feed.png), [scorestatus](https://github.com/dartflow/platform/releases/download/android-player-0.1.3-4/score-status-default.png) en [scorestatus met grotere tekst](https://github.com/dartflow/platform/releases/download/android-player-0.1.3-4/score-status-large-font.png). De eerste vijf meten **360 × 640 pixels**, de laatste **390 × 844**. Ze tonen synthetische offline Compose-fixtures op een API 36 x86_64-emulator, ingesteld op 480 × 1000 pixels bij 160dpi. De grotere HOME-footer op 1,6× is door een geslaagde instrumentationtest gecontroleerd en heeft geen afzonderlijke zevende PNG. De onderste locatiekeuze bij schermbeheer vereist scrollen. Deze beelden bewijzen geen fysieke toestelwerking, echte providerlogin of gemeten netwerkvertraging.

De 16KB-ELF-controle geldt voor arm64-v8a en x86_64. De meegeleverde 32-bit-WebRTC-bibliotheken behouden 4KB-loadsegmenten; daarvoor wordt geen 16KB-ELF-compatibiliteit geclaimd. De releaseflow behoudt `ERROR_IF_IN_REVIEW` en heeft een lopende beoordeling niet omzeild. Zie de [GitHub/Google Play-releaseprocedure](github-play.md).

## Historische ondertekende release · 0.1.2 (3)

DartFlow Speler **0.1.2**, versionCode **3**, applicationId **`nl.dartflow.app`**, is ondertekend gepubliceerd als [GitHubrelease `android-player-0.1.2-3`](https://github.com/dartflow/platform/releases/tag/android-player-0.1.2-3). De geteste applicatiebron is [`6694643c74c39699d5e9e0a14de023054eaf71a8`](https://github.com/dartflow/platform/commit/6694643c74c39699d5e9e0a14de023054eaf71a8), samengevoegd via [PR #10](https://github.com/dartflow/platform/pull/10) en de viewport- en exportcontroles uit [PR #11](https://github.com/dartflow/platform/pull/11) en [PR #12](https://github.com/dartflow/platform/pull/12). Bij die oplevering draaiden beide backends diezelfde SHA. Het [samengevoegde controlebewijs](../evidence/player-compact-ui-2026-11-18.json) onderscheidt de applicatiebron van een eventuele latere documentatiecommit. De afzonderlijke Play-uitkomst staat hieronder; een GitHubrelease of gezonde backend bewijst geen beschikbaarheid van de Android-update in Google Play.

### Compactere interface en leesbare koppen

- Een gemeenschappelijke Compose-`Surface` geeft alle spelersschermen de juiste tekstkleur. Paginakoppen krijgen lime `#B5F52B`, ook op het aanmeldscherm; kaarttitels gebruiken de lichte tekstkleur `#F2F5EF`.
- Paginakoppen gaan van 36 naar 28sp; kaarttitels van 21 naar 18sp. Compactere marges, tekst en tussenruimte laten meer inhoud tegelijk zien.
- De onderste navigatie gaat van 80 naar minimaal 56dp; bij standaardtekstgrootte blijven alle labels op 360dp breedte volledig leesbaar. De aanmeldknoppen blijven minstens 48dp hoog.
- Android gebruikt lichte statusbalkiconen boven de donkere appachtergrond.
- De wijziging behoudt de bestaande aanmeld-, score-, privacy- en beoordelaarsflows. Er zijn hiervoor geen nieuwe databasemigraties of secrets nodig.

| Bestand voor 0.1.2 (3) | Status | Grootte | SHA-256 |
| --- | --- | --- | --- |
| [app-production-release.aab](https://github.com/dartflow/platform/releases/download/android-player-0.1.2-3/app-production-release.aab) | Ondertekende bundel voor Google Play | 26.293.611 bytes | `6c8ba503326a493b4db75bba162e0ade79de4dc4b28f3472ed43278782e7b1be` |
| [app-production-release.apk](https://github.com/dartflow/platform/releases/download/android-player-0.1.2-3/app-production-release.apk) | Ondertekende universele APK uit dezelfde AAB | 49.605.460 bytes | `25d36f4a0fadba87bc1d7eed7a6975c35b105a152fafe90af9da9ee27b587b75` |
| [release-evidence.json](https://github.com/dartflow/platform/releases/download/android-player-0.1.2-3/release-evidence.json) | Definitief artifact-, bron- en testbewijs | 7.747 bytes | `446e85d8ed0f1f839eb14d837d821b8abe95bd9434cfcec7f6f5b457639cf083` |
| [release-receipt.json](https://github.com/dartflow/platform/releases/download/android-player-0.1.2-3/release-receipt.json) | Definitieve bron-/versie-/certificaatbinding | 667 bytes | `301b1d325d3c276aef2a572a96a7de1415e91c89fc8e412a3a7df16301112fa0` |

De vier bestanden zijn bevroren; hun lokale hashes en groottes komen overeen met de GitHubassetdigests. De AAB komt uit de volledige geslaagde native CI en is lokaal ondertekend met de bestaande spelersapp-uploadsleutel. De universele APK is met bundletool uit diezelfde AAB gemaakt, zonder hercompilatie. Het uploadcertificaat blijft `97:C8:A2:78:FF:67:14:BD:E4:F1:BC:B5:4E:BA:15:12:28:D4:2E:83:8F:11:D4:3B:CF:6E:71:C7:DE:08:A0:09`; het afzonderlijke Play App Signing-certificaat blijft `DE:54:EB:62:ED:D3:10:AA:F9:39:0F:47:6D:AF:73:E2:94:13:75:CE:EE:BE:DC:0B:89:D8:8D:E2:D4:EC:3E:F1`.

| Controle op 0.1.2 (3) | Werkelijk resultaat / open bewijs |
| --- | --- |
| Lokale Kotlin- en instrumentation-testcompilatie | Geslaagd; alleen compilatie, geen uitgevoerde emulatorproeven |
| Worker-lokale dependencyquery | Geslaagd zonder broncompilatie; zes Gradle-invoerhashes vastgelegd. ZXing en WebRTC aanwezig; GMS, MLKit, Firebase, datatransport, Ads, Billing en Crashlytics ontbreken in de gecontroleerde runtimegraaf |
| [Native CI](https://github.com/dartflow/platform/actions/runs/44375702068) | Geslaagd: lint voor alle drie varianten, **34 JVM-tests per variant / 102 uitvoeringen**, builds en native telefoonproeven; 0 mislukte of overgeslagen tests |
| Native Compose-regressies; vijf compacte fixtures meten expliciet 360 × 640dp | **18 geslaagd**, 0 mislukt, 0 overgeslagen; onder meer leesbare koppen, compact aanmelden, Oche Live-schermbeheer, volledige navigatielabels en de bestaande scoreconsole |
| [Web-CI](https://github.com/dartflow/platform/actions/runs/44375702239) | Geslaagd: **471** applicatietests, **46** prototypetests, **5** aparte Feed/chat-browserproeven, **72** volledige browserproeven en **166** Python-regressies; typecheck, lint, build, packaging en databaseopruiming geslaagd |
| Ondertekening, manifest en 16KB-uitlijning | Geslaagd op de nieuwe bestanden: jarsigner/apksigner, bundletoolvalidatie, package/versie/productiehost, AAB `PAGE_ALIGNMENT_16K`, APK ZIP-uitlijning en alle 64-bit-ELF-loadsegmenten gecontroleerd |
| [Staging](https://github.com/dartflow/platform/actions/runs/44377944190) | Geslaagd: release `44377944190-1`, config `staging-2026-11-18-play-safety-1`, exacte applicatiebron hierboven; health `ok`, ready `ready`, database `ok`, Auth `reachable`, juiste omgeving |
| [Productiebackend](https://github.com/dartflow/platform/actions/runs/44378566429) | Geslaagd: release `44378566429-1`, config `production-2026-11-18-play-safety-1`, dezelfde applicatiebron; health `ok`, ready `ready`, database `ok`, Auth `reachable`, juiste omgeving |
| Publieke releasepreflight | Geslaagd voor beide backends, native capabilities, Auth-projecten, App Links met het Play-certificaat en de vier juridische pagina's |
| [Google Play interne upload, versiecode 3](https://github.com/dartflow/platform/actions/runs/44380265441) | Geslaagd: API-edit gecommit, exacte ondertekende AAB-hash bevestigd; de afzonderlijke API-nacontrole bevestigt `internal` op versiecode **3**, status **`completed`** |
| [Google Play productiepromotie, versiecode 3](https://github.com/dartflow/platform/actions/runs/44380533558) | Geslaagd: API-edit gecommit; de afzonderlijke API-nacontrole bevestigt `production` op versiecode **3**, status **`completed`**. Dit bewijst geen Google-goedkeuring of openbare beschikbaarheid |
| Fysieke toestellen | Niet uitgevoerd; uiteindelijke leesbaarheid, systeemtekstgrootte en echte aanmeld-/cameraflows blijven toestelcontroles |

De drie PNG's in het native CI-artifact zijn uitsluitend diagnostische opnamen. De CI-emulator heeft een oppervlak van **320 × 640 pixels bij 160dpi**, terwijl de compacte Compose-fixtures op **360 × 640dp** worden gemeten. De PixelCopy-export naar 360 pixels breed kan hierdoor schalen of buitenmarges afsnijden. Deze opnamen bewijzen daarom geen volledige, onafgesneden schermranden en zijn niet als releasepreview gepubliceerd. De productweergave behoudt **16–20dp buitenmarges**; de geautomatiseerde semantiek- en viewportcontroles en uiteindelijke toestelvalidatie hebben elk hun eigen bewijsgrens.

De 16KB-ELF-controle geldt voor arm64-v8a en x86_64. De meegeleverde 32-bit-WebRTC-bibliotheken behouden 4KB-loadsegmenten; daarvoor wordt geen 16KB-ELF-compatibiliteit geclaimd.

De eerste productierelease **0.1.1 (2)** is door de eigenaar ter beoordeling ingediend; de eerdere API-controle meldde versiecode 2 op productie als `completed`. De update **0.1.2 (3)** is inmiddels gecommit voor zowel intern als productie. De [geslaagde afzonderlijke trackcontrole](https://github.com/dartflow/platform/actions/runs/44380730912) bevestigt op **18 november 2026 om 19:28:06 UTC** beide tracks op versiecode **3**, status **`completed`**. Google-goedkeuring en openbare beschikbaarheid zijn niet aangetoond. De releasehelper behoudt `ERROR_IF_IN_REVIEW` om een eventuele lopende beoordeling te beschermen; deze controle is niet omzeild. Zie de [GitHub/Google Play-releaseprocedure](github-play.md).

## Historische ondertekende release · 0.1.1 (2)

De bevroren [GitHubrelease `android-player-0.1.1-2`](https://github.com/dartflow/platform/releases/tag/android-player-0.1.1-2) bevat DartFlow Speler **0.1.1**, versionCode **2**, applicationId **`nl.dartflow.app`**. De exacte applicatiebron is maincommit [`20db906c3c646caba2d9a6e09f0429b20e865564`](https://github.com/dartflow/platform/commit/20db906c3c646caba2d9a6e09f0429b20e865564). Beide bestanden gebruiken de productiebackend `https://dartflow.nl`; minSdk is 26 en targetSdk/compileSdk zijn 36.

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

Voor rechtstreeks installeren van deze historische release:

```sh
adb install -r app-production-release.apk
```

### Werkelijke Google Play-status

De eigenaar heeft de eerste AAB handmatig opgeslagen. De [echte GitHub-toegangsproef](https://github.com/dartflow/platform/actions/runs/44326068767) en [idempotente interne uitrol](https://github.com/dartflow/platform/actions/runs/44326658372) zijn geslaagd: Google meldt versiecode **2** als `completed` op de interne track en dezelfde AAB-SHA-256 als hierboven. De herhaling voerde geen bundleupload, trackwijziging of editcommit uit. De eigenaar heeft daarna de eerste productierelease ter beoordeling ingediend. De [latere API-controle](https://github.com/dartflow/platform/actions/runs/44328517736) bevestigt versiecode **2** als `completed` op de productietrack; dit bewijst geen goedkeuring of openbare beschikbaarheid.

Het bevroren `release-receipt.json` bewaart `playUpload=false` van het moment van ondertekening: de generator had toen niet naar Play geüpload. Die historische receipt blijft ongewijzigd. De latere eigenaarupload en API-proeven staan in het [actuele uitrolbewijs](../evidence/player-play-ready-2026-11-18.json).

## Historische release · 0.1.0 (1)

De onderstaande secties bewaren de eerdere oplevering en haar toenmalige uitrol-/configuratiestatus. De actuele **0.6.1 (10)**-status staat bovenaan; de oudere ondertekende bestanden houden hun eigen historische secties.

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

De eerste bouwcontrole gebruikte applicatiebron `267fa5c76baed699214bdbd957a042ba901a5559`. Onderstaande debug-APK's en ongetekende AAB zijn de oorspronkelijke controlebestanden. De 0.1.0-productie-APK en ondertekende AAB van 18 november hierboven waren de daaropvolgende oplevering; de bevroren 0.1.1-bestanden staan in hun eigen sectie en de historische 0.1.3 staat in haar eigen sectie. De actuele 0.6.1-status staat bovenaan.

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
