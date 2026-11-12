# Lokale acceptatie Oche Live v18

Getest op 12 november 2026 op de development-VPS, met de echte Next.js standalone-build en de lokale PostgreSQL-database. Deze oplevering wijzigt staging en productie niet. De lokale readiness meldt `sha: local-unreleased`; er is voor deze wijziging nog geen gepubliceerde release-SHA.

## Uitgevoerde controles

| Controle | Resultaat | Bereik |
| --- | --- | --- |
| App- en databasetests | 249 geslaagd, 0 overgeslagen | Inclusief de nieuwe timer-, rechten-, scorekaart-, migratie- en gebruikersnaamregressies |
| Bestaande prototypetests | 46 geslaagd | Bestaande referentielogica |
| Native DG Webservices-deployer | 57 geslaagd | Bestaande releaseverwerking; geen deployment uitgevoerd |
| Lint | Geslaagd | Geen waarschuwingen |
| Productiebuild en TypeScript | Geslaagd | Next.js 16.4.6; standalone-assets gereed |
| Lokale readiness | HTTP 200 | Database en beide nieuwe schemamarkers aanwezig |
| Volledige browserreeks | 29 geslaagd in 4,2 minuten | Chromium 156.0.8078.4, één worker, lokale build |

De volledige app-testreeks is sequentieel uitgevoerd om gedeelde lokale fixtures te isoleren. De mailtests vergrendelen uitgaande jobs buiten hun eigen fixture en gebruiken een testtransport; zij verzenden geen echte mail.

## Oche Live en score-invoer

De browsercontrole gebruikt publieke displayresponses als afgebakende testdata voor de precieze visuele gevallen: **148–188 → links 60 → 88–188**, gespiegelde kolommen, bust, undo, één cijfer, een nieuwe set/leg en meer dan vijf beurtregels. De lettergrootte en panelen blijven gelijk. Een snapshot zonder nieuwe beurt houdt de handmatige scrollpositie; Doorspelen houdt bovendien dezelfde scorekaart in de DOM. Solo, live scoremutaties, twee deelnemers, de schrijverflow en het openbare scherm zijn daarnaast via echte lokale API- en databaseflows getest.

Na de browserreeks is ook een blijvend lokaal baanvoorbeeld aangemaakt, met de testaccounts **Danny Goldenbelt** en **Michael de Groot**. Tien echte geaccepteerde worpen leveren 148–188 op. De volgende worp van 60 levert in de openbare serverprojectie **88–188** en de scorekaartbeurt **60 | 88** op; undo herstelt 148–188. De sessie volgt daarna de normale timeout. De vaste voorbeeldlinks staan in de handleiding.

Van merk-, QR-, instructie-, live- en waarschuwingsweergave zijn 15 lokale Chromium-captures gemaakt op **1080×1920, 720×1280 en 1920×1080**. De scorekaart heeft op alle drie formaten vijf zichtbare beurtregels, met een vaste startregel en kolomkop. Er is geen horizontale overflow. Op een liggend scherm blijft het verticale voorbeeld gecentreerd. De waarschuwing bedekt alleen de live-inhoud; baanheader en footer blijven zichtbaar.

De telefoonconsole is met afgebakende session-, match-, score- en verlengingsmocks gecontroleerd op **390×844 en 360×640**. Het toetsenblok en Bevestigen blijven zonder scrollen bereikbaar, ook tijdens de waarschuwing. Een afzonderlijke echte lokale API-/browserproef controleert thuis/hybride met twee accounts die hun eigen beurt invoeren; lokaal scoort de bestaande schrijver voor beide spelers.

De carrousel is met een browserklok gecontroleerd op 5/10/15 seconden, herstart bij opnieuw vrij/open, gelijke QR-doelen, directe overgang naar reservering/sluiting en reduced motion. De bestaande browserproeven controleren ook de vaste baanroutes, afzonderlijke manifests, openbare schermtoegang en terugkeer na reconnect. Dit bewijst geen installatie via een echt OS-installatievenster.

## Deadline, concurrency en beheer

De gerichte tests gebruiken een gestuurde klok en echte transacties: 119/120/180 seconden, score tijdens waarschuwing, nul/bust, replay en undo zonder extra tijd, maximaal twee gedeelde verlengingen, gelijktijdige klikken, onbevoegde toegang, score tegenover timeout, oude jobs tegenover een opvolgende wedstrijd en twee fysieke banen met één remote tijdlijn. De database beslist na de relevante locks met servertijd.

Een aanvullende regressie begint met twee gekoppelde remote banen en laat daarna een reservering voor de tweede baan ingaan. De start wordt geweigerd zonder revisie of toewijzing te veranderen. Na annulering van die reservering kan dezelfde klaargezette partij op beide banen starten. De start controleert dus ook de actuele reserveringen en rechten na het eerdere koppelmoment.

Een afzonderlijke proef liep **181,5 echte seconden**, zonder geopende speler- of displayschermen en zonder klokaanpassing. Op 119,018 s was de sessie actief, op 120,052 s en 179,007 s in waarschuwing en op 181,504 s vrijgegeven. Alle snapshots behielden dezelfde absolute deadline. De achtergrondworker ontkoppelde de baan en verwijderde de voorlopige scoredata. De oorspronkelijke bewijsharness had na deze geslaagde inhoudelijke controle een fout in de opruimvolgorde; de fixture is daarna gericht opgeruimd en de opruiming is apart geverifieerd.

Openen, reserveren met voorkeursbaan, sluiten, geplande sluiting, geforceerd vrijgeven, ingetrokken beheerdersrechten en verouderde bevestigingen zijn in echte lokale databasetests gecontroleerd. Afgebroken vrijspel verliest scorehistorie en statistiekbijdragen; een normaal gepubliceerde uitslag blijft intact. Een officiële wedstrijd behoudt voortgang en fixture, kan via de bestaande oproepflow hervatten en krijgt geen nieuwe verlengingsquota.

## Globaal unieke gebruikersnamen

De databaseproeven laten twee accounts uit verschillende verenigingen tegelijk dezelfde genormaliseerde naam claimen: precies één slaagt, de andere krijgt `username_taken` (HTTP 409). Hoofdletters, herhaalde witruimte en canoniek equivalente Unicode omzeilen de index niet. De regels voor Unicode en normalisatie zijn ook op verschillen tussen de Node- en lokale PostgreSQL-Unicodeversies getest.

Een lokaal migratiescenario bewaart account-ID, oude naam, historie en clubrechten bij dubbele namen en `Nieuwe speler`; het vraagt vervolgens een unieke bevestiging. Een Google-naam is uitsluitend een onbevestigd voorstel en kan geen bestaande claim overnemen. In de browser herstellen de lokale testaccounts Michael de Groot en Raymond van Dijk hun profiel naar **Noor Dart** en **Sam Dart**, zien zij een duidelijke fout bij een bezette naam en verschijnen de bevestigde namen op lobby en scorebord. De test herstelt hun oorspronkelijke profielgegevens achteraf.

## Grenzen en bewijs

Er zijn geen echte Google OAuth-aanmeldingen, SMTP-proeven, fysieke QR-scans, installaties op Android/iOS/tv-box, camera’s of stroomuitvalproeven uitgevoerd. De gebruiker heeft de fysieke apparaatproeven uitgesteld tot de grote testronde. Browsermocks voor displaydata en apparaatbevoegdheid zijn apart gehouden van de echte lokale database- en toegangstests.

De officiële assets en fonts en de opgegeven demo bepalen de schermindeling. De captures onderbouwen de lokale browserweergave; exacte rendering op alle fysieke schermen vraagt nog die apparaatronde. Bekijk de lokale visuele fixtures: [merk](evidence/oche-v18-local-brand-720x1280.png), [scan en speel](evidence/oche-v18-local-qr-720x1280.png), [instructies](evidence/oche-v18-local-steps-720x1280.png), [live scorekaart](evidence/oche-v18-local-live-720x1280.png) en [waarschuwing](evidence/oche-v18-local-warning-720x1280.png). Deze afbeeldingen gebruiken uitsluitend testnamen, testscores en een fixture-QR; gebruik voor spelen de echte voorbeeldlinks uit de handleiding.

Een compact overdraagbaar bewijs staat in [de lokale acceptatiegegevens](evidence/oche-live-v18-local-2026-11-12.json). Uitgebreide ontwikkellogs en screenshots staan lokaal onder `.local/v18-*.log` en `.local/oche-v18-captures/`; deze genegeerde ontwikkelbestanden horen niet bij een releasepakket. Zie ook de [bedieningshandleiding](oche-live-v18.md).

## Aanvulling: gedraaid Cast-signaal en installatieknop

Na de oorspronkelijke oplevering zijn de vaste Oche Live-routes aangepast voor een liggend signaal op een verticaal gemonteerd scherm. Op de uiteindelijke lokale build slagen **13 gerichte browsertests** en **24 pure regressietests**; lint, typecheck, build en readiness zijn groen.

De proeven controleren op beide vaste routealiassen het logische vlak **1080×1920**, `rotate(90deg)` en de uitvoergrenzen **0,0–1920,1080**. Dezelfde container blijft behouden bij stand-by → live → waarschuwing → stand-by en bij echte Chromium-fullscreen aan/uit. Vijf beurtregels zijn zichtbaar; de zesde en zevende verschijnen door automatisch scrollen. Een gewone snapshot behoudt de handmatige scrollpositie. Ook de afgeschermde wachtschermindeling is op drie liggende resoluties gecontroleerd.

De twee stand-by-QR’s hebben hetzelfde doel, een bron van 1024×1024 pixels en ten minste vier modules vrije rand. Hun volledige modulematrix is gecontroleerd. Daarnaast leest jsQR 1.4.0 de vaste baan-URL succesvol uit de **gerenderde, gedraaide screenshotpixels** op 1920×1080. Deze decoder is uitsluitend een tijdelijk lokaal testhulpmiddel en geen nieuwe applicatieafhankelijkheid.

Het installatiepictogram blijft zichtbaar in gewone browserfullscreen. De instructiedialoog vult de volledige gedraaide achtergrond bij zowel stand-by als live en blijft binnen de schermranden. Een eerder herkende standalone-, minimal-ui- of iOS-app blijft de installatieknop verbergen, ook na DOM-fullscreen. De browserfullscreenacties zijn echt uitgevoerd; appstartmodi en het native installatievenster zijn met fixtures getest. Een fysieke Chromecast en een echte OS-installatie zijn niet bediend.

Bekijk [de Cast-acceptatiegegevens](evidence/oche-live-cast-local-2026-11-12.json), [het gedraaide scorebord](evidence/oche-cast-live-1920x1080.png), [de QR-weergave](evidence/oche-cast-qr-1920x1080.png) en [het installatievenster](evidence/oche-cast-install-1920x1080.png). Deze aanvulling is lokaal opgeleverd als `local-unreleased` en bevat geen staging- of productie-uitrol.
