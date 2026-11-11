# DartFlow Speler, vaste Sprint-apps en scoreconsole

Deze wijziging gebruikt de bestaande Sprint-projectie, fysieke baan-ID's, spelers-QR's, Supabase-authenticatie, wedstrijdacties en native DG-releaseflow. De installatiehandleiding voor wedstrijdleiding staat in [installatie-speler-en-baanschermen.md](installatie-speler-en-baanschermen.md).

## Implementatie

**Speler:** `/speler` opent rechtstreeks de speelomgeving en hergebruikt een geldige sessie. E-mail en Google behouden de bestaande veilige terugkeerroute naar baan of wedstrijd. Het spelersmanifest heeft `id` en `start_url` `/speler`, naam **DartFlow Speler**, eigen PNG-iconen en scope `/`, omdat ook de bestaande `/baan/`, `/wedstrijd/` en inlogroutes in de spelersapp moeten kunnen openen.

**Fysieke baan:** iedere `/baanscherm/<UUID>` kiest op de server precies zijn eigen manifest onder `/api/board-screens/<UUID>/manifest.webmanifest`. `id`, `start_url` en scope blijven `/baanscherm/<UUID>`. Een andere geopende baan of een naamswijziging verandert die identiteit niet. De manifestlink gebruikt `crossorigin="use-credentials"`, zodat een gekoppeld afgeschermd apparaat zijn baannaam kan ophalen. De naam bevat geen speler- of wedstrijdgegevens. Speler en afzonderlijke baanmanifesten hebben verschillende identiteiten; werkelijke meervoudige installatie blijft afhankelijk van het apparaat en de browser.

**Scorebord-fallback:** `/scorebord` heeft een eigen vast manifest en vraagt één expliciete baankeuze. Alleen die bevestigde keuze wordt op het apparaat bewaard; een andere baan openen of een suggestie in de URL verandert de startbaan niet. Een volgende start leest die keuze opnieuw en opent dezelfde alleen-lezen Sprint-weergave. Dit is een webapp en kioskstartpagina. Er is geen native Android-/TV-installatiepakket gebouwd; voor een scherm zonder webappinstallatie is een geschikte kioskbrowser/container nodig. Het doelmodel en die praktische installatieroute moeten op het apparaat worden vastgesteld.

**Installatiebediening:** het native browservenster wordt alleen gebruikt wanneer de browser het aanbiedt. Anders verschijnen korte instructies en een kopieerbare vaste URL. In zelfstandige weergave is de installatiekeuze verborgen. Installeren in een gewoon browsertabblad verandert dat tabblad niet in een zelfstandige app en verbergt de installatiekeuze voor een volgende baan niet.

**Toegang:** bestaande openbare verenigingsschermen blijven openbaar, ook wanneer alleen leden mogen spelen. Afgeschermde evenementbanen gebruiken een afzonderlijke apparaatkoppeling. Alleen actuele wedstrijdleiding kan een koppelcode maken, apparaten bekijken en intrekken. Codes zijn willekeurig, gehasht opgeslagen, éénmalig en tien minuten geldig. Verbruik wordt onder een databasevergrendeling afgehandeld; mislukte pogingen tellen buiten die transactie door. Board- en IP-limieten beperken raden. De uiteindelijke 256-bit apparaattoegang wordt alleen als HttpOnly/Secure/SameSite-cookie naar het apparaat geschreven, onder het API-pad van precies die baan, met maximaal één jaar geldigheid. Het manifest, de spelers-QR en browseropslag bevatten geen apparaatgeheim. Een scherm gebruikt geen spelerssessie, ook geen tijdelijk voorrecht van een ingelogde beheerder. Intrekken, verlopen of verlies van de bevoegdheid van de uitgever beëindigt toegang.

**Verbinding:** het geopende scherm bewaart de laatste ontvangen stand in geheugen en markeert verbindingsverlies zichtbaar. Online- en zichtbaarheidsherstel halen de volledige actuele baanstatus op, inclusief een andere inmiddels begonnen partij. Een bereikbare 403/404 verwijdert de oude private stand. Alleen expliciet toegestane afbeeldingen komen in de serviceworkercache; HTML, sessies, API-antwoorden, live scores en mutaties blijven daarbuiten. Een volledige herstart zonder netwerk kan geen actuele stand laden. Wake Lock is beschikbaar waar de browser het ondersteunt, met opnieuw aanvragen na zichtbaarheid en een zichtbare herpoging.

**Scoreconsole:** één component gebruikt de volledige viewporthoogte met veilige schermranden, compacte spelers/restscores, actieve beurt, worptotaal, grote cijfers/wissen en Bevestigen. De onderliggende app blijft gemount maar is verborgen en inert; media en wedstrijd blijven bestaan. Terug bewaart de partij en invoer. Finish, darts en correcties verschijnen op verzoek of wanneer relevant. Dezelfde console gebruikt bestaande solo-, lokale en online acties. Serverbevoegdheid, beurt, revisie en ontvangstbewijzen blijven leidend. Ook een solo-aanvraag bewaart bij een verloren antwoord hetzelfde actie-ID en dezelfde revisie.

**Afloop:** een natuurlijke checkout van een baangebonden solo geeft de baan in dezelfde transactie vrij. Scores, undo-historie en trainingsresultaat blijven bewaard. Een herhaalde oude score of undo kan daarna geen nieuwe baansessie overnemen. Een training zonder fysieke baan behoudt het bestaande terugdraaigedrag. Lokale en online wedstrijden behouden hun bestaande uitslagbevestiging en vrijgave; wedstrijdleiding houdt de bestaande regie over toernooibanen.

## Uitgevoerde automatische controles

De productiebuild, typecheck en lint slagen. Alle **166 applicatie-/databasetests** slagen zonder skips. Alle **17 browserregressies** slagen, inclusief de vijf nieuwe installatie-/scherm-/scoreconsoleproeven en de bestaande twaalf scenario's. De bestaande **46 prototype- en 57 deployertests** en de runner-, cleanup-, runtime-, upgrade-, TURN- en Auth-grensproeven slagen. De native CI voor de definitieve bron wordt hieronder bij de uitrol vastgelegd.

| Onderdeel | Accounts en apparaat | Gecontroleerd |
| --- | --- | --- |
| Installatie en identiteit | Lokale fixture Danny Goldenbelt; Chromium op 390/540 px | Speler en twee vaste baanmanifesten, aparte ID's/start/scope, juiste manifestlink, heropenen, naamwijziging, andere baan buigt vaste fallback niet om |
| Installatiebediening | Lokale fixture en anonieme browser; Chromium | Native prompt via een gesimuleerd browserevent, echte fallbackdialoog, verborgen optie bij gesimuleerde standaloneweergave; dit bewijst geen OS-installatie |
| Baanscherm en netwerk | Lokale fixture Danny; aparte anonieme schermcontexten | Vaste spelers-QR, Baan 2 blijft vrij, Baan 1 solo/live, laatste stand bij offline, andere nieuwe partij bij herstel, natuurlijke checkout naar wachtscherm |
| Private schermtoegang | Lokale beheerfixture en aparte anonieme apparaatcontext | Tijdelijke code via API, alleen-lezen cookie met juiste pad/HttpOnly, heropenen zonder spelerssessie, eigen manifest, intrekken verwijdert private stand; DB-tests controleren ook verlopen, concurrentie en rolverlies |
| Scoreconsole solo | Lokale fixture Michael de Groot; Chromium 320×568 en 390×844 | Geen scroll voor toetsen en Bevestigen, 181 geweigerd, draft bij terugkeer, offlinefeedback, echte servercommit met vervolgens afgebroken antwoord, herhaling met identiek actie-ID boekt één worp, finish met twee darts |
| Scoreconsole lokaal/thuis/hybride | Lokale fixtures Michael en Raymond in twee telefoonviewports | Eigen beurt, gedeelde stand, dubbele klik hoogstens één worp, lokale schrijversovername en dezelfde Sprint-restscores in een geautoriseerde alleen-lezen weergave |

Alle bovenstaande spelersaccounts zijn uitsluitend lokale fixtures. Er worden voor deze proeven geen synthetische Supabase-gebruikers op staging aangemaakt en er worden geen OTP-codes, providergeheimen of apparaatcookies in bewijsbestanden opgenomen.

## Staging en release

Deze opdracht richt zich op staging. Productie blijft op de eerder geverifieerde bron `aa7ac5e49de184fa4eb5ec1a83318c44e1b5d0d6`, release `43102459247-1`. Voor deze wijziging zijn geen nieuwe GitHub-secrets, variables, providerinstellingen, Caddy- of TURN-aanpassingen nodig. Staging gebruikt de bestaande immutable configuratie `staging-2026-11-11-v15-mail-1`.

De enige nieuwe migratie is `20261111221655_board_screen_devices.sql`: één private tabel met RLS, beperkte runtimekolomrechten, indexes op baan/evenement/uitgever en featuremarker `board_screen_devices=1`. Readiness eist deze marker. De uitrolvolgorde blijft broncommit → push-CI **Verify** voor exact die volledige SHA → verse gecontroleerde stagingbackup → beoordeelde migratie → `deploy-staging.yml` → publieke en loopback health/ready met dezelfde release-/configuratie-identiteit. Geen devseed, lokale build of gesimuleerde CI vervangt deze poort.

De definitieve release-SHA, CI-run, deploymentrun en onafhankelijke hosted controles worden na verificatie hier toegevoegd. Een lokale browserproef is geen stagingacceptatie.

## Nog te bevestigen op echte apparaten

| Acceptatie | Status |
| --- | --- |
| Speler + Baan 1 + Baan 2 naast elkaar werkelijk installeren en vanuit OS-iconen heropenen | Open; model/OS/browser nog niet opgegeven |
| Android-tablet, iPhone/iPad en vaste tv-box: native app, snelkoppeling of Scorebord/kioskroute vaststellen | Open; geen fysieke apparaten door de worker bediend |
| Twee echte telefoons: solo, lokaal en online, veilige randen, finish/correctie en juiste Sprint-stand | Open; geautomatiseerde Chromiumproeven met lokale fixtures uitgevoerd |
| Kiosk na een echte stroomonderbreking, met blijvende apparaatkoppeling | Open; moet in de apparaatconfiguratie worden ingericht en getest |

Werkelijke installatie, een echte e-mail-/Google-aanmelding en stroomherstel worden uitsluitend als geslaagd gemeld nadat die op de gebruikte apparaten zijn uitgevoerd. De handleiding beschrijft de routes en de afzonderlijke kioskstappen.
