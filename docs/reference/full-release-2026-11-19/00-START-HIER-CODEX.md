# DartFlow volledige productieoplevering

## Opdracht aan Codex

Implementeer en publiceer dit volledige pakket in de bestaande DartFlow-omgeving van DG Webservices. De gebruiker vraagt één volledige functionele oplevering op desktopweb én in de native DartFlow Android-app. Beide moeten zelfstandig alle spelers-, captain-, organisator-, clubbeheer-, moderatie- en platformfuncties aanbieden waarvoor de aangemelde gebruiker bevoegd is. Lever ook de benodigde integratie en releases van de afzonderlijke Oche Live-baanschermapp en de browserweergave. Dezelfde wedstrijd, regels, rechten, scorekaart, standen en mutaties moeten op alle schermen overeenkomen.

Pak eerst het archief uit. Lees de product- en techniekhoofdstukken, FAQ en acceptatiematrix. Open de meegeleverde beelden voor de bestaande DartFlow-huisstijl. Dit is de werkopdracht om software te implementeren, te testen én uit te rollen. De hoofdstukken vormen samen de specificatie. Lever het volledige bereik in deze release, inclusief de uitbreidingen uit het eerdere plan. Interne technische tussenstappen zijn toegestaan. Een demonstratie, deelrelease, planning of interne Play-bèta is geen eindoplevering.

### Werkwijze op de dev-VPS

1. Identificeer de echte Git-remote, checkout, standaardbranch en releasecommit. Leg in het opleververslag vast welke web-, Android-, Oche Live-, server-, database- en workflowprojecten actief zijn, ook als ze over meer repositories verdeeld zijn. Inventariseer bestaande clients, score-, toernooi- en identiteitslogica, rechten, routes, huisstijl, migraties en testcommando’s. Verifieer de bestaande deployflow en package-ID’s met repository en store. De documentnamen en contractvoorbeelden in dit pakket zijn functionele eisen, geen veronderstelde bronpaden.
2. Maak een werkbranch of geïsoleerde checkout. Koppel elke rij van de acceptatiematrix aan bestaande of te bouwen schermen, services, taken en tests. Hergebruik werkende onderdelen. Vergelijk eerdere prototypebeelden met de actuele interfaces. Integreer in de bestaande navigatie, sessies en routes. Bestaande uitnodigingen, scorehistorie en werkende features moeten ook na de update bruikbaar zijn.
3. Implementeer alle beschreven wedstrijdvormen, wizards en beheerhandelingen op beide platforms. Vul echte lege toestanden in productie vanuit de API. Gebruik fictieve spelers en bekende uitslagen in fixtures en de testomgeving. Zorg dat een verse club en een speler zonder vereniging vanaf de hoofdpagina kunnen beginnen.
4. Maak één servergezag voor spelregels, score, zichtbaarheid en ranking. Gebruik dezelfde versiegebonden regels en voorbeelden in beide clients. Koppel in-app FAQ, uitnodigingen, buttons, push- en webbestemmingen aan dezelfde inhoud en dezelfde bevoegdheden. Voeg ontbrekende native schermen toe. Publiceer geen web-only beheerflow als gelijkwaardige appfunctionaliteit.
5. Draai per wijziging de relevante regressies en vóór publicatie de volledige matrix op de releasekandidaat. Maak waar nodig tests voor oude data, correcte migratie, online/offline, dubbele acties, meerdere rollen, lage netwerkstabiliteit en dezelfde leden in meerdere clubs. Test installatie én update van de echte app. Een opname uit een browser in telefoonformaat bewijst mobiele webweergave; bewijs native Android afzonderlijk.
6. Rol uit via de werkende GitHub-/runnerprocedure van dit project. Gebruik de productieomgeving van de website en de productie-track van de betrokken Play-app(s). Rond configuratie, vereiste beoordelingen en controles af binnen de beschikbare rechten. Houd web/API compatibel met oudere apps gedurende distributie. Valideer de echte publieke versie en een representatief live traject per client zonder officiële statistieken te vervuilen.
7. Behandel herstelbare fouten zelf en herhaal de betreffende tests. Als een extern account, Play-beoordeling of daadwerkelijk vereiste menselijke beslissing blokkeert, rond onafhankelijke werkzaamheden af, documenteer exact de resterende externe actie en bewaak de voortgang voor zover de uitvoeromgeving dit toelaat. Rapporteer iedere component naar feitelijke status en hervat de verificatie wanneer publicatie mogelijk is.

### Omvang en samenhang

| Productonderdeel | Verplichte productiefunctionaliteit |
|---|---|
| Publiek en persoonlijk | Bestaande marketing-home en ontdekking, gast, aanmelden, terugkeer naar doel, persoonlijke home en feed, actieve uitnodigingen, agenda, meldingen, profielen, statistieken, deelbare uitslagen en doorzoekbare FAQ |
| Spelen | Oefenen, lokale en remote partij, voor rating spelen met voorafgaande instemming, gast of geregistreerde tweede speler op gedeeld toestel, check-in, live score-invoer en bevestiging |
| DartFlow Leagues | Kort en lang teamformat, clubselecties en reserves, meerdere teams per club volgens reglement, afgeschermde opstelling, tijdvoorstel, inhalen, divisies, thuis/uit, teamstand, promotie en archief |
| Clubcompetities | Individueel, vaste clubavond, flex, team- en koppelformats, vaste legs, handicap, uitdaagladder, beker, instuif, circuit en finale, versieerbare spel- en puntregels |
| DartFlow Rankings | Spelersrating, plaatsingsstatus, divisie-indeling, apart seizoenscircuit en clubbestemmingen, erkenning door platform, zichtbare puntenhistorie, correcties en herberekening |
| DartFlow Tournaments | Persoonlijk/club/platform, volledige organisatorfunctionaliteit ook zonder club, uitnodiging, gasten, import, loting, seeding, poules, KO, dubbele eliminatie, Zwitsers, rondes, byes, regie, afsluiting, exports en privacy |
| Oche Live | Koppeling van displays, QR, 9:16 en 16:9, standaard- en clubthema, wedstrijdscore en scorekaart, uitgooi- en gebeurtenisanimaties, beschikbaarheid, schrijver, pauze, baanoproep, herstel en uitbedrijfname |
| Beheer en support | Leden, passende rollen, instellingen op platform-, club- en evenementniveau, activiteitenhistorie, incidenten, protest, beroepsroute, versiebeheer, archief, gekoppelde schermen en publicatiestatus |

De vier programmeerbare bestemmingen zijn landelijke spelersrating, clubrating, landelijk circuit en clubcircuit. Competitiepunten voor team- en individuele standen komen daar apart bij. Het onderscheid tussen organisator, scope, deelname en boeking moet ook buiten de interface afdwingbaar zijn. Een persoonlijk toernooi blijft uitgesloten van officiële landelijke en verenigingsrankings, ongeacht accessoires, organisatierol of betaald account.

### Vastgelegde ontwerpkeuzes

- De desktopversie is het bestaande DartFlow-webplatform. De appversie is de native Android-spelers-/beheerapp. Oche Live is het gekoppelde baanscherm. Gebruik de bestaande productidentiteiten. Het baanscherm krijgt de weergave- en baantaken die bij zijn rol horen.
- Landelijke spelersrating start bij 1500. Gebruik K=32, schaal 400, één boeking per uitgewerkte en bevestigde geldige single, voorlopige status tot tien geldige partijen tegen minstens vijf verschillende tegenstanders. De 3–0 vanaf gelijke 1500-scores geeft 1516 en 1484. Leggeschiedenis blijft apart beschikbaar.
- Top 50 is een zichtbare ranglijstdoorsnede. Speeldivisies hebben instelbare poules, kalender, sportieve tiebreaks en promotie/degradatie. De landelijke standaardcompetitie tussen verenigingen bestaat uit teamontmoetingen.
- De club kan eigen ranking en reglement configureren. Landelijke toelating blijft een bevoegdheid van het platform. Publicatie bewaart de regels en gevolgen per bron. Een persoonlijke of oefenuitslag wordt achteraf nooit alsnog officieel.
- Alle in het pakket genoemde formats, het lange teamduel, Zwitsers, divisies en uitgebreide controle behoren tot dezelfde eerste complete oplevering. De prestatiedoelen en acceptatietests bewijzen de werking van dit gehele product.
- Beslis routine-implementatiekeuzes in de context van de bestaande software en leg afwijkingen vast. Gebruik configureerbare defaults voor club- en seizoensbeleid. Wijzig bescherming van privégegevens en consequenties van reeds gespeelde wedstrijden uitsluitend volgens de beschreven bevoegdheden en regels.

### Oplevering aan Danny

Lever een beknopt verslag met klikbare productie-URL, Play Store-link(s), commit(s), releaseversies en versionCodes, CI- en deployruns, migratieversie, uitgevoerde tests, pariteitsmatrix met bewijs, screenshots van het daadwerkelijke product per rol en platform, en status van installatie vanaf Google Play. Leg uit waar Danny een League, clubcircuit of persoonlijk toernooi begint en waar de eerste echte score zichtbaar wordt. Neem de rollback-/herstelroute en eventuele feitelijke externe blokkade op. Een ingediende build krijgt de status ‘in beoordeling’ tot beschikbaarheid en installatie daadwerkelijk zijn gecontroleerd.

### Bestanden

Begin bij dit bestand. De leesbare bundel staat in LEESWIJZER.html. In product/ staan de te bouwen functies en importeerbare Nederlandse FAQ. In techniek/ staan het transactiemodel en draaiboek voor de bestaande infrastructuur. In validatie/ staan de bewijsvoering en uitvoerbare referentievoorbeelden. In referenties/ staan beelden en huisstijlelementen uit de eerdere DartFlow-overdracht. Het pakket zelf is een specificatie. Vul de resultaatkolommen tijdens de daadwerkelijke implementatie en uitrol in.
