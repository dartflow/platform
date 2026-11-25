# Oche Live · schermindeling en twee scoreborden

De algemene Oche Live-route `/oche-live` en de Android-app ondersteunen een opgeslagen schermindeling. Een horizontale 55-inch-tv tussen twee fysieke dartbanen toont links en rechts een eigen verticaal scorebord, met een gestylede middenstrook voor baannamen, status en speel-QR’s. Iedere baan behoudt zijn eigen wedstrijd en inactiviteitstimer. De bestaande schermkoppeling, accountrechten, wedstrijdprojecties, huisstijlen en fonts blijven de basis.

Dit document beschrijft de bediening en verificatie van 25 november 2026. De additieve databasewijziging is op staging en productie toegepast; zie [database-uitrolbewijs](evidence/oche-splitscreen/database-rollout-2026-11-25.json). Web- en Play-publicatie volgen hun afzonderlijke releasecontroles. Het technische contract staat in [contracts/README.md](../contracts/README.md); de bestaande Android-instructies staan in [android/oche-live/README.md](../android/oche-live/README.md).

## Eerste start op de tv

1. Open de Android-app of `/oche-live` in de tv-browser. **Hoe staat dit scherm?** stelt de gedetecteerde stand voor. Kies **Verticaal** of **Horizontaal** en bevestig.
2. Alleen bij horizontaal volgt **Hoeveel scoreborden wil je tonen?** Kies **Eén scorebord** of **Twee scoreborden**. De miniatuur toont de verdeling. **Terug** bewaart de eerdere selectie. Twee scoreborden vermeldt **Beschikbaar voor locaties**: de bestemming hoeft op dit moment nog niet bekend te zijn.
3. Kies **Opslaan en doorgaan**. De keuze wordt in de lokale installatieopslag bewaard vóór het aanvragen van een koppelcode. Bij een opslagfout blijft de stap herstelbaar. Een mislukte verbinding of verlopen code vereist geen nieuwe indelingskeuze.
4. Een ongekoppeld scherm toont daarna de bestaande korte koppelcode en schermbrede koppel-QR. Scan die met een telefoon of open `/koppel-scherm` en voer de code in. Deze QR koppelt het toestel; de speel-QR hoort later bij een afzonderlijke baan.

De bevestigde keuze blijft behouden bij refresh, herstart, stand-by, reconnect en app-update. De Android-app gebruikt hiervoor de bestaande versleutelde installatieopslag. De browser bewaart de indelingskeuze in het bestaande browserprofiel. Appgegevens wissen of een ander browserprofiel gebruiken is een nieuwe installatie.

Met een afstandsbediening verplaats je de focus met de pijltjes, bevestig je met **OK** en ga je met **Terug** naar de voorgaande stap. De normale wedstrijdweergave werkt automatisch; de scorekaart en speel-QR krijgen daarbij geen blijvende bedieningsfocus.

## Bevestigen op de telefoon

Log in met het bestaande DartFlow-account en controleer het schermvoorstel. Kies **Mijn scherm thuis** of een locatie waarvoor je schermen mag beheren, en geef het scherm een naam.

Voor een locatiescherm met twee scoreborden kies je **Baan links** en **Baan rechts**. Beide banen moeten actief zijn, verschillend zijn en bij dezelfde locatie horen. De miniatuur toont de namen op hun posities. **Wissel links en rechts** verwisselt beide selecties; de bevestiging bewaart de indeling en beide toewijzingen samen. Een nog lege selectie blijft zichtbaar als **Nog geen baan toegewezen** in het betreffende paneel.

Bij **Mijn scherm thuis** blijft de bestaande gekozen eigen wedstrijd of oefensessie de bron. Een installatievoorstel met twee scoreborden vraagt hier expliciet **Eén scorebord voor thuis bevestigen**. Pas daarna kun je de koppeling bevestigen. De server weigert twee scoreborden voor thuis ook bij een rechtstreeks API-verzoek.

Controleer het bevestigingsvak en kies **Dit scherm koppelen**. Het doelscherm haalt zelf zijn bestaande schermtoegang op en neemt daarna de bevestigde serverconfiguratie over. Een korte code of QR bevat geen installatiegeheim, schermtoken of spelerslogin.

## Later wijzigen via Schermen

Open **DartFlow → Schermen** (`/app/schermen`). De kaart van het toestel toont de effectieve indeling, toewijzingen en miniatuur. Kies **Schermindeling wijzigen** om stand, aantal en banen te wijzigen. Bij twee borden zijn **Baan links**, **Baan rechts** en **Wissel links en rechts** beschikbaar. Kies **Schermindeling opslaan** om de hele configuratie in één handeling te bewaren.

De bestaande eigenaar- en locatiebeheerrechten gelden ook hier. Alleen een centrale schermlimiet kunnen beheren geeft geen recht om banen of de actieve schermindeling te veranderen. De generieke schermsessie mag de toegewezen wedstrijd- en baangegevens uitsluitend lezen; scoren en **Doorspelen** blijven op de bevoegde telefoon.

Bij een gelijktijdige wijziging door een andere beheerder verschijnt een zichtbare revisiemelding. Het eigen voorstel blijft staan. **Actuele indeling laden** haalt de laatst bevestigde configuratie op; controleer daarna beide posities en sla opnieuw op.

Van twee naar één blijft de eerste/linker baan actief en eindigt de actieve rechtertoewijzing. Als je later opnieuw twee kiest, wijs je de rechterbaan opnieuw toe. Een ontbrekende baan toont **Nog geen baan toegewezen**. Een verwijderde of anderszins ongeldig geworden toewijzing toont **Baan niet beschikbaar** met de instructie een bevoegde beheerder een andere baan te laten kiezen.

Eén gekoppelde tv blijft één fysieke schermplek, ook met twee scoreborden. Thuis blijft het maximum één gekoppeld scherm; op locatie blijft de standaardlimiet twee, aanpasbaar via het bestaande centrale beheer. Offline toestellen, reserveringen en vervanging blijven volgens de bestaande telling werken.

## Wijzigen vanaf een gekoppelde tv

Gebruik in de browser **Schermmenu → Schermindeling wijzigen** of in Android **Info → Schermindeling wijzigen**. Dezelfde wizard maakt een lokaal voorstel. Bij een gekoppeld toestel volgt een korte bevestigingscode met QR voor de telefoon. De bestaande schermsessie en apparaatpoll blijven doorlopen.

Op de telefoon bevestigt de eigenaar of bevoegde locatiebeheerder het voorstel en de banen voor datzelfde toestel. Er is geen nieuwe koppeling, extra reservering of extra schermplek nodig. Tot die bevestiging blijft de vorige effectieve configuratie beschikbaar. Een wijziging vanaf een ander beheertoestel wordt eveneens door de server beslist; de tv neemt de nieuwe configuratierevisie over en verwijdert de vorige projecties uit de getroffen weergave.

Als het toestel intussen elders is gewijzigd, kan een ouder telefoonvoorstel niet alsnog over de nieuwe configuratie heen worden opgeslagen. Maak dan op de tv een nieuw voorstel of wijzig de actuele indeling rechtstreeks via **Schermen**. Een verlopen voorstel kan op dezelfde manier opnieuw worden aangemaakt.

## Bestaande koppelingen en oudere versies

Een bestaand toestel zonder expliciete keuze behoudt de bestaande adaptieve indeling en baantoewijzing. Een lopende wedstrijd wordt niet door de eerste wizard onderbroken. De suggestie verschijnt bij de eerstvolgende veilige start met actuele broninformatie of zodra de lopende partij afgelopen is. **Later** sluit de suggestie en bewaart dat deze is gezien. De keuze blijft bereikbaar via **Schermindeling wijzigen**.

Een bestaande toegewezen baan wordt de eerste/linker baan wanneer een beheerder de expliciete indeling bevestigt. Een reeds gekoppeld toestel hoeft hiervoor niet te worden ontkoppeld.

Oudere Oche Live-clients blijven via de bestaande v1-projectie de primaire baan of thuisweergave ontvangen. Een oudere beheerclient die alleen de primaire baan kent, wist de tweede toewijzing of indeling niet stilzwijgend. Een nieuwere client op een oudere backend gebruikt de geldige enkele weergave; de instellingen melden dat twee scoreborden een backendupdate vereisen. De bestaande afzonderlijke legacy-baankoppelingen blijven zichtbaar in het schermbeheer en volgen hun bestaande vervangingsprocedure.

## Indeling en fysieke rotatie

| Opgeslagen keuze | Samenstelling | Bestemming |
| --- | --- | --- |
| Verticaal, één scorebord | Leesbare compositie in 9:16 | Thuis of locatie |
| Horizontaal, één scorebord | Eén compositie in 16:9 | Thuis of locatie |
| Horizontaal, twee scoreborden | Links en rechts ieder een eigen 9:16-scorebord, met een verticale middenstrook | Locatie met fysieke banen |

De twee scoreborden houden ieder een eigen verticale 9:16-compositie. De gestylede middenstrook maakt de fysieke richting duidelijk met **← baannaam links** en **baannaam rechts →**. Per baan staan daar ook de status en, wanneer de baan scanbaar is, de speel-QR. De extra baannamen boven de twee scoreborden vervallen. Zo blijft de baanidentiteit op een vaste plek terwijl de scoreborden hun eigen wedstrijd tonen.

Binnen ieder scorebord blijven spelers of teams, restscores direct onder de namen, actuele werper, legs/sets en de bestaande gespiegelde scorekaart **Worp | Rest** en **Rest | Worp** zichtbaar. De scorecijfers behouden hun grootte bij één, twee en drie cijfers. Andere spelvormen gebruiken hun bestaande passende weergave.

De keuze draait de tv of het besturingssysteem niet. Een bewuste verticale keuze op een vaste horizontale tv blijft als verticale compositie leesbaar, met vrije ruimte ernaast. Viewportwijzigingen wijzigen de opgeslagen indeling of baantoewijzing niet. De bestaande fysieke apparaatrotatie en de afspraken van de oudere Cast-routes `/baanscherm/<baan-ID>` en `/oche-live/<baan-ID>/` blijven afzonderlijk gelden. Zie ook de [bestaande Cast-instructies](oche-live-v18.md#liggend-cast-signaal-op-een-verticaal-scherm).

## Onafhankelijke banen en netwerkgedrag

Iedere helft volgt zijn eigen baanbron, sessie, wedstrijdrevisie, gebeurtenissen en absolute deadlines. Scoren, pauze, undo, bust, legwissel, resultaat, inactiviteitswaarschuwing en terugkeer naar stand-by horen bij de betreffende baan. Een 180- of finishviering en timerwaarschuwing blijven binnen die helft. De server behoudt de canonieke wedstrijd- en timerregels wanneer dezelfde remote wedstrijd op twee fysieke banen staat.

Een vrije, publiek scanbare baan houdt de speel-QR onbeweeglijk bij de eigen baannaam en **Scan en speel**. Bij twee scoreborden staat die informatie in de middenstrook en blijft zij beschikbaar wanneer de stand-bytekst op het betreffende scorebord wisselt. De QR gebruikt de bestaande helper, vrije lichte marge en vaste baanroute `/baan/<baan-ID>`. Lobby, reservering, sluiting, blokkering en een actieve partij volgen de bestaande scanstatus uit de brondata.

Een ontbrekende of tijdelijk mislukte projectie toont de eigen paneelstatus; het andere paneel kan met geldige informatie blijven doorlopen. Bij gedeeld netwerkverlies blijft een herkenbare vorige stand zichtbaar met offline-indicatie. Speel-QR's waarvan de actuele scanstatus niet bevestigd is worden verborgen. Eerste ontvangst, reconnect en bronwisseling bouwen een eigen eventbaseline op, zodat eerdere vieringen niet opnieuw afspelen. Reduced motion en het bestaande TV-ambientgedrag blijven gelden.

Bij ingetrokken schermtoegang verdwijnen beide standen en speel-QR's. Android verwijdert daarbij ook de opgeslagen projecties uit de versleutelde cache. Het bestaande online intrekkingsbudget blijft van toepassing.

## Beeldbewijs en verificatie

De lokale Chromium-captures gebruiken vaste contractfixtures en testnamen. Ze tonen de browserweergave en vormen geen bewijs van fysieke leesbaarheid of scans met telefooncamera's.

| Toestand | 1920×1080 | 1280×720 |
| --- | --- | --- |
| Links live, rechts vrij met speel-QR | [Beeld](evidence/oche-splitscreen/left-live-right-free-1920x1080.png) | [Beeld](evidence/oche-splitscreen/left-live-right-free-1280x720.png) |
| Beide banen live | [Beeld](evidence/oche-splitscreen/both-live-1920x1080.png) | [Beeld](evidence/oche-splitscreen/both-live-1280x720.png) |

De productiebuild, typecheck en lint slagen. De volledige bestaande `npm test` slaagt met **918/918 tests** op een verse, gezaaide lokale auditdatabase. De actuele Chromium-ronde tegen de productiebuild slaagt met **35/35 browserproeven**, inclusief de nieuwe 9:16-indeling en de bestaande Cast-route, pairing, schermlimieten, intrekking, statistieken en clubhuisstijl. De vastgelegde resultaten en hardwaregrenzen staan in [validation.json](evidence/oche-splitscreen/validation.json).

De bestaande gedeelde lokale database bevat oudere accountverwijderjobs en een aanvullende reserveringstrigger buiten de repo. Die veroorzaken daar fouten in de brede suite. De ongewijzigde en huidige bronnen zijn voor de betrokken tests ook op de schone auditdatabase vergeleken. Er zijn geen productgegevens of bestaande jobs verwijderd om tests te laten slagen. De relevante ingangen zijn:

```sh
npm run typecheck
npm run lint
npm test
npx playwright test tests/e2e/oche*.spec.ts tests/e2e/release-oche-theme.spec.ts
```

De lokale Android-controle is op de laatste bron geslaagd: builds en lint voor staging en productie, met **44 geslaagde unitcases per variant** (`stagingDebug`, `productionDebug` en `productionRelease`). De bestaande Play-releaseproeven zijn **19/19 geslaagd**. Ook de AndroidTest-APK met 24 instrumentatiemethoden is gecompileerd. De exacte testinventaris is gecontroleerd; geen cases zijn overgeslagen. De gebruikte Gradle-taken zijn:

```sh
cd android/oche-live
./gradlew --no-daemon \
  :app:lintStagingDebug :app:testStagingDebugUnitTest \
  :app:assembleStagingDebug :app:assembleStagingDebugAndroidTest \
  :app:lintProductionDebug :app:testProductionDebugUnitTest \
  :app:lintProductionRelease :app:testProductionReleaseUnitTest \
  :app:bundleProductionRelease
```

Daarbij zijn de bestaande meldingen over experimenteel `android.r8.optimizedResourceShrinking` en SDK XML-versie 4 tegenover reader-versie 3 zichtbaar. De lokale productie-AAB is ongesigneerd; er is geen Play-upload of publicatie uitgevoerd.

**Native instrumentatie is lokaal niet uitgevoerd:** `adb devices` had geen beschikbaar toestel en `/dev/kvm` ontbreekt op deze host. De bestaande CI heeft afzonderlijke telefoon- en Android TV-jobs voor deze instrumentatie. Een gecompileerde AndroidTest-APK bewijst niet dat de Compose-proeven op een emulator of tv zijn uitgevoerd.

**Niet op echte hardware gecontroleerd:** een horizontale 55-inch-tv, leesbaarheid vanaf de werppositie, beide QR's tegelijk met meerdere telefoons, iedere QR afzonderlijk met meerdere telefoons, Android TV/D-pad op een fysiek toestel, overscan, stand-by en app-update op die tv. Controleer deze bij de locatie met links live/rechts vrij, de omgekeerde toestand, beide live, twee gelijktijdige vieringen, netwerkverlies en herstel. Noteer per toestel en telefoon de uitkomst afzonderlijk.

## Uitrolvolgorde

1. Pas eerst de uitbreidende migratie [20261125154720_oche_screen_layout.sql](../supabase/migrations/20261125154720_oche_screen_layout.sql) toe via het bestaande projectgebonden databasebeheer. De registratie blijft in `dartflow_private`; de primaire `board_id` blijft voor bestaande clients bestaan. De migratie voegt indeling, tweede baan en configuratierevisie toe en verandert de telling van fysieke schermen niet. Volg de bestaande back-up-, migratie- en runtimeprivilegeafspraken uit het [uitrolverslag](oche-live-v18-uitrol.md#migraties-en-behoud-van-gegevens). Hosted beheermigraties worden niet automatisch door de native releasebroker uitgevoerd; de lokale `npm run db:migrate` is daarvoor niet het uitrolpad.
2. Rol daarna web en backend uit via de bestaande [CI](../.github/workflows/ci.yml), [stagingworkflow](../.github/workflows/deploy-staging.yml) en [productieworkflow](../.github/workflows/deploy-production.yml), met de exact geteste bron-SHA en bestaande configuratie. Controleer op de betreffende omgeving de layoutcapability, oude v1-projectie, accountbevestiging, schermlimieten en het grant-/refreshpad vóór een Android-update.
3. Bouw en test vervolgens Android met [Oche Live Android CI](../.github/workflows/oche-android-ci.yml). Volg voor signing, interne distributie en eventuele productiepromotie het [bestaande Google Play-runbook](oche-live-android/google-play-runbook.md) en de [Oche Live-productieworkflow](../.github/workflows/oche-play-production.yml). Behoud de bestaande package-, flavor-, credential- en versieafspraken; promoveer de daarvoor geteste Android-build via de bestaande releaseprocedure.
4. Controleer na beschikbaarheid op de echte locatie de opgeslagen indeling, beide juiste baanlinks, bestaande spelerlogin, remote wedstrijdregels, reconnect, intrekking en behoud van koppeling na een update. Leg de fysieke 55-inch-tv- en telefoonscans apart vast van het lokale browser- en buildbewijs.

