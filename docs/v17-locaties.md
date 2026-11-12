# Vaste locaties, thuisbanen en reserveringen

Open in de spelersomgeving **Mijn banen & locaties**. Deze functies gebruiken hetzelfde geverifieerde account als spelen en verenigingen. Locatiebeheer staat los van platformbeheer en verenigingsrollen.

## Je eigen thuisbaan

Kies **Thuisbaan activeren** en voeg onder **Thuis** je vaste baan toe. Een account heeft maximaal één thuislocatie en één thuisbaan. De vaste spelerslink `/baan/<UUID>` en het Oche Live-scherm `/baanscherm/<UUID>` veranderen niet wanneer je de baan hernoemt of een nieuwe partij start.

Een thuisbaan is standaard afgeschermd. De eigenaar start een nieuwe partij; een uitgenodigde tegenstander behoudt alleen zijn bestaande wedstrijdrechten. Voor een zelfstandig scherm maak je onder **Schermtoegang** een eenmalige koppelcode. De apparaattoegang blijft alleen-lezen en geeft geen spelers- of beheerrechten. Zie ook de [installatiehandleiding](installatie-speler-en-baanschermen.md).

## Een locatie met meerdere banen

1. Activeer **Locatiebeheer** en voeg een locatie met naam en IANA-tijdzone toe, bijvoorbeeld `Europe/Amsterdam`.
2. Voeg de fysieke banen toe. Elke baan krijgt één onveranderlijk UUID, een vaste spelerslink en een eigen Oche Live-startlink.
3. Stel per baan in of verenigingen reserveringsaanvragen mogen indienen. Nieuwe locatiebanen zijn openbaar leesbaar; bij nieuwe banen kan de eigenaar het scherm afschermen en apparaten afzonderlijk koppelen.
4. De locatie-eigenaar kan andere bestaande accounts als locatiebeheerder aanwijzen met hun spelers-ID. Deze accounts mogen banen beheren en reserveringen beoordelen. Ze krijgen daarmee geen verenigingsrol. Alleen de eigenaar wijzigt de locatie of de gedelegeerde beheerders.

Bestaande verenigingsbanen behouden hun UUID, spelers-QR, schermlink en spelersregels. Hun oorspronkelijke fysieke maker wordt tijdens de migratie locatie-eigenaar. Andere verenigingsbeheerders krijgen daardoor geen fysieke beheerrechten. Een bestaande fysieke eigenaar houdt zijn beheer wanneer zijn verenigingsrol later verandert. De compatibele oude aanmaakroute vraagt daarnaast onafhankelijke activering van locatiebeheer.

Deze bestaande verenigingsschermen behouden hun openbare leeslinks; hun scherm kan niet via een andere route alsnog afgeschermd worden voorgesteld. Nieuwe locatie- en thuisbanen ondersteunen wel afzonderlijke openbare of gekoppelde schermtoegang.

Een baan buiten gebruik stellen of blokkeren vereist dat er geen actieve partij of training staat. Buiten gebruik stellen kan ook niet zolang er nog een goedgekeurde toekomstige reservering is. Herstellen gebruikt dezelfde baan-ID en historie.

## Een verenigingsspeeldag reserveren

1. Maak eerst binnen de vereniging een competitie of toernooi aan. Voor een aanvraag is het actuele bijbehorende recht `competitions.manage` of `tournaments.manage` nodig; gewoon lidmaatschap is onvoldoende.
2. Kies bij **Locatiebanen voor een speeldag aanvragen** de bestaande speeldag en de locatie. Vul begin, einde, aantal banen en maximaal aantal partijen in. De invoer gebruikt de lokale tijd van het toestel. De server verlangt een expliciet tijdzone-offset, bewaart UTC en toont het resultaat in de tijdzone van de locatie.
3. Locatiebeheer ziet de aanvraag, wijst precies het gevraagde aantal eigen opengestelde banen toe en keurt goed of wijst af met optionele reden. De server controleert de huidige rechten, beschikbare banen, capaciteit en overlap in dezelfde transactie. Tijdvakken zijn halfopen: 18:30–20:30 en 20:30–22:30 sluiten op elkaar aan.
4. Een lopende aanvraag kan worden geannuleerd. Een goedgekeurde reservering kan alleen vóór het begin worden geannuleerd. Locatiebeheer en de actuele bevoegde verenigingsorganisator zien deze bediening.

Een aanvraag kan maximaal zestien banen, tweeëndertig partijen en zeven dagen omvatten. Goedkeuren geeft tijdelijk gebruik van de gekozen banen; het verplaatst de fysieke baan niet naar de vereniging. De locatie houdt het fysieke beheer. Een gewijzigde aanvraag of achterhaalde revisie geeft duidelijke feedback en moet opnieuw worden opgehaald.

## Spelen via de vaste QR

Tijdens een goedgekeurd tijdvak toont hetzelfde Oche Live-scherm de speeldag of de actuele partij. De bestaande wedstrijdplanning en ingecheckte deelnemers blijven leidend. De eerst aangewezen speler kan vanaf de vaste spelers-QR **Mijn ingeplande partij klaarmaken** kiezen. De tweede aangewezen speler opent via dezelfde QR de toegewezen partij. Buitenstaanders zien alleen een reserveringsmelding en kunnen geen vrije partij starten of scores invoeren. Locatiebeheer krijgt door het fysieke beheer geen wedstrijddeelname of verenigingsrechten.

Nieuwe calls, acceptaties en starts vereisen het geldige tijdvak en de toegewezen fysieke baan. Een reeds begonnen partij die over het einde doorloopt blijft zichtbaar en kan normaal worden uitgespeeld en bevestigd. De reserveringenlijst vermeldt deze uitloop. De baan blijft fysiek bezet tot vrijgave; de volgende reservering kan een bestaande partij niet overnemen. Na vrijgave en zonder actief reserveringsvenster is de locatiebaan opnieuw beschikbaar voor vrij spelen.

Het maximum aantal partijen wordt op unieke wedstrijd-ID's afgedwongen. Een herhaalde actie boekt geen extra toewijzing of worp. De server controleert deelnemer, beurt, verwachte revisie en bestaand actie-ID. De gewone solo-, lokale, thuis- en hybride scoreconsole en Oche Live gebruiken dezelfde wedstrijdstand.

## Verificatie

De gerichte lokale databasetests controleren onafhankelijke rollen, één thuisbaan bij gelijktijdige aanmaak, delegatie en intrekking, UTC-invoer, overlap en aangrenzende vensters, capaciteit, huidige organisatierechten, bestaande fixture-toewijzing, vaste links, uitloop en maximale aantallen. De aanvullende browserproef gebruikt uitsluitend de lokale geverifieerde fixtureaccounts en echte UI-/API-acties. Stagingidentiteit, uiteindelijke CI-resultaten en fysieke apparaatacceptatie worden apart in het v17-uitrolrapport vastgelegd; deze handleiding claimt geen uitgevoerde OS-installatie of hosted spelproef.
