# Gedeelde wedstrijdservice en gegevenscontract

## Aansluiten op de bestaande applicatie

Gebruik deze contracten als eisen aan bestaande services. De naam van een endpoint, bestand of tabel mag de huidige projectconventie volgen. Zoek eerst de code die een echte partij creëert, een beurt opslaat, een appgebruiker inlogt, een scherm koppelt, een uitslag bevestigt en een storebuild maakt. Volg één bestaande partij van de invoer tot de opgeslagen toestand en terug naar beide clients. Noteer de gebruikte sleutel, eigenaar en autorisatiegrens. Vermijd een parallel competitie- of rankingsysteem met een tweede spelerslijst. Sluit bestaande partijen en displays aan via adapters wanneer de eerdere gegevensvorm verschilt.

Web en native Android spreken hetzelfde versieerbare contract. Bij Supabase/Postgres kan de logica in transactievaste databasefuncties of de bestaande serverlaag wonen. Repliceer de gezaghebbende validatie en toekenning niet apart in Kotlin en JavaScript. Een lokale preview op beide clients mag dezelfde afgeleide waarden berekenen. De server beslist bij bevestigen. Schrijf golden tests tegen de echte API en laat beide UI-tests dezelfde scenario's verifiëren.

## Entiteiten en invarianten

| Gegeven | Unieke relatie en invariant |
|---|---|
| Speler, lidmaatschap, gast | Stabiel speler-ID per account. Lidmaatschap bevat start/einde, club en status. Gast-ID is per organisator/event begrensd. Koppeling achteraf kan historie toewijzen, zonder nieuwe officiële rating voor vroegere gastdeelname. |
| Rollen en teamroster | Roltoekenning bevat scope en geldigheid. Club, seizoen, team en deelnemer verwijzen naar ID. Dezelfde naam kan meermaals bestaan. De landelijke seizoensselectie voorkomt gelijktijdige vertegenwoordiging voor twee clubs en volgt de gepubliceerde transferregeling. |
| Competitie, evenement, seizoen, fase | Eigenaarsoort persoonlijk/club/platform. Publicatie legt reglement, spelregels, startvoorwaarden, rankingrechten, puntentabellen, doorschuifregels en toegestane correcties versiegebonden vast. Concept kopiëren geeft nieuw ID zonder de toegekende rankingrechten of historie van het origineel. |
| Stand, bracket, geplande ontmoeting | Gebruik expliciete bronverwijzingen voor plaatsingsvelden (winnaar/verliezer van, positie in poule, bye). Bewaar lotingsseed en volgorde uit de vastgelegde deelnemerslijst. Elke latere herloting is een afzonderlijke revisie. |
| Partij, set, leg en beurt | Eén partij-ID over plannen, baanwissels, hervatten, aftekenen, bezwaar en statistieken heen. Leg/set/seat/turn-volgorde zijn eenduidig. Scheid geobserveerde worp, afgeleide score en administratief resultaat. |
| Speelveld en apparaten | Een bord kan gekoppelde weergaven hebben. Actieve baanbezetting, schrijfrecht en deelnamevergrendeling zijn aparte begrippen. Een remote wedstrijd reserveert twee fysieke banen indien van toepassing. |
| Resultaat en boekingen | Eén bronresultaat met revisie, status en besluitvormers. Declareer per bron en ranking een bestemming. Unieke sleutel omvat bron, bestemmingslijst, deelnemer en boekingssoort. Een teamresultaat genereert geen tweede kopie van de singles. |
| Regelversie, wijziging, bezwaar | Bewaar actor, recht, tijd, reden, oude en nieuwe status. Gevoelige bijlagen en vertrouwelijke notities zijn uitsluitend via de dossierroute beschikbaar. Publieke wedstrijdgegevens hebben een beperkte projectie. |

## Bericht van client naar server

Een schrijfopdracht bevat een uniek commandId, de partij-, seizoen- of event-ID, de verwachte revisie en getypeerde payload. De server leidt actor, scope en bevoegdheid uit de sessie en opslag af. Een recht is gekoppeld aan de resource én de actie. Dezelfde gebruiker kan voor het ene event schrijver en voor een ander evenement toeschouwer zijn.

Voorbeeld voor een bestaande partij op revisie 17. Onderstaande velden illustreren overdracht van de huidige beurt via de toegewezen schrijver. Laat de naamgeving aansluiten op het bestaande contract.

```json
{
  "commandId": "ce265a74-b6e6-4a6e-88ec-7c5dca260d6a",
  "matchId": "4bb59016-4377-4e83-9ba5-ceab27517c38",
  "expectedRevision": 17,
  "type": "recordVisit",
  "payload": { "leg": 2, "seat": "home", "visit": 3, "points": 60, "dartsUsed": 3 }
}
```

Op succes krijgt de client de aanvaarde revisie, de gezaghebbende wedstrijdtoestand en de toegestane vervolgacties. Elke opdracht die een finish claimt bevat voldoende detail voor het gekozen uitformat en het werkelijk gebruikte aantal pijlen. Registreer een bust expliciet. Onbekende worpdetails blijven onbekend.

| Situatie | Server en UI |
|---|---|
| Zelfde commandId, actor en identieke invoer | Geef de eerder vastgelegde ontvangstbevestiging terug, ook wanneer de basisrevisie inmiddels ouder is. |
| Zelfde commandId met afwijkende inhoud | Wijs af als conflict. Retourneer uitsluitend gegevens die deze actor mag zien. |
| Ander commando op oude revisie | Laat client herladen vanaf de laatst geaccepteerde revisie. Toon de strijdige lokale beurt en laat de bevoegde schrijver die oplossen. |
| Verlopen rol, overgedragen bord of verkeerde beurt | Wijs af met een begrijpelijke reden; herstel de schermstatus uit de server. Een nieuw token of QR omzeilt deze check niet. |
| Tijdelijke offline-invoer | Toon ‘Op dit toestel, nog te synchroniseren’. Bewaar geordend op toestel en account. Voorkom gelijktijdige officiële offlineclaims bij twee remote spelers. |
| Definitieve uitslag | Bewaar bronuitslag en verwerkingsopdracht in één transactie. De worker verwerkt elke bestemming herhaalbaar. Toon bevestiging en ranglijstverwerking als afzonderlijke statussen. |

## Schrijfpad en herstel

1. Controleer sessie, lidmaatschap/rol, schrijverlease, commandId en verwachte revisie. Vergrendel de partij of gebruik een conditionele update op de revisie. Verifieer speelfase en spelregelversie. Sla geaccepteerde invoer, actuele staat, nieuwe revisie, ontvangstbewijs en eventueel uitgaande gebeurtenis samen op.
2. Schermen krijgen een snapshot plus laatste volgnummer. Realtime-evenementen hebben dezelfde ID en oplopende revisie. Verwerk duplicaten onschadelijk. Bij een gemist of te oud volgnummer herlaadt de client eerst de gezaghebbende snapshot. Toon offline- en wachtmeldingen ook op Oche Live.
3. Bij de vereiste ondertekeningen sluit de service het resultaat af. De booking-worker schrijft binnen dezelfde berekening de positieve en negatieve Elo-mutatie. Hanteer één totale, stabiele volgorde per ranking voor alle deelnemers, vaste volgorde voor vergrendelingen en een transactie voor boekingen, tellers, unieke tegenstanders en actuele stand. Eén van beide ratingwijzigingen zelfstandig zichtbaar maken is uitgesloten.
4. Hervat een afgebroken verwerking vanuit de opgeslagen opdracht. Stuur pas meldingen, deelkaarten en feed-updates na duurzame opslag. Gebruik per ontvanger, bron, revisie en berichtsoort een unieke afleversleutel. De twee kanalen kunnen dezelfde gebeurtenis openen zonder tweemaal de bijbehorende actie uit te voeren.
5. Bij correctie bewaart het systeem een nieuw besluit en de gevolgen voor opvolgende partijen, gemiddelden, divisie- of playoffgrenzen en zo nodig best-vijf-circuitpunten. Herbouw betrokken afgeleiden naar een nieuwe generatie, inclusief latere tegenstanders en inmiddels binnengekomen bronresultaten. Vergelijk totalen en schakel atomair naar de nieuwe stand. Toon eerdere boeken en reden in de bevoegde historie.
6. Een heropende of betwiste uitslag kan gevolgen hebben voor een reeds gespeelde vervolgronde. Bevries de betrokken tak en toon de impact. De wedstrijdleider beslist over hervatten, behouden of reglementair opnieuw spelen. Onafhankelijke banen gaan door. Een al afgesloten seizoen heeft expliciete heropening en een opnieuw gepubliceerd klassement nodig.

## Contracten voor schermen, import en export

- Geef op elk overzicht een stabiele cursor, filters met vaste betekenis, laatste verversing en relevante regelversie. Sorteer ex aequo sportief volgens het reglement. Gebruik de unieke sleutel alleen om weergave/paginering stabiel te maken. Hij geeft geen promotievoorrang.
- Retourneer per spel/competitie de effectieve acties, sluitingstijden, publieke status en rankingbestemmingen inclusief reden per bestemming. Gebruik dezelfde foutcodes voor web, native en Oche Live; vertaal de codes naar dezelfde Nederlandstalige herstelactie.
- Bij accountwissel, ingetrokken rol of andere club scheid lokale concepten, caches, offlinequeue en pushkoppelingen op actor en scope. Laat een oude client bij onbekende acties veilig terugvallen op de laatste leesbare status en een updatepad.
- Valideer een deelnemersimport eerst als voorvertoning met toegevoegde/overgeslagen/ambigue regels, dubbele accounts, ontbrekende kolommen en impact op loting. Schrijf één keer na bevestiging. Bij exports geldt dezelfde zichtbaarheid als bij opvragen. Gebruik de bestaande exports, met formuleveilige tekst bij CSV-gegevens uit gebruikersinvoer.
- Publiceer alleen de bedoelde profielvelden, resultaten en clubbranding naar kijklinks en casts. Respecteer besloten competities, intrekking van links en clubwissels ook bij zoekresultaten, meldingen, cache, feed en matchupdates. Geef een gedeeld toestel een afzonderlijk beperkt apparaatprofiel.
- Bewaar speelvensters samen met een IANA-tijdzone, absolute tijdstippen voor gebeurtenissen en expliciete verplaatsingen. Toon lokale datum/tijd, herbereken afhankelijke deadlines en voorkom een dubbele baanreservering bij zomertijd of verplaatsen.
- Scheid profielstatistieken, evenementstand, ranking en financiën. Gebruik eventuele bestaande ticketintegratie voor deelnamegerechtigdheid wanneer ingeschakeld. Er ontstaat geen afhankelijkheid van betaalde tickets of abonnementen voor een persoonlijk toernooi of sportieve rating.

## Migreren zonder verlies van echte wedstrijden

Breid eerst schema en API compatibel uit. Geef bestaande data herkenbare herkomst (waar onbekend, als onbekend), behoud partij-ID’s, plaatshouders voor onvolledige worpdetails en oudere afgeronde resultaten. Laat historische ratingtoekenning alleen volgen uit aanwezige, geldige bestaande boekingen of expliciet bestaande regels. Kies bij ontbrekend bewijs voor behoud van scorehistorie zonder nieuwe officiële punten. Laat de migratie opnieuw uitvoerbaar zijn. Test met een kopie of representatieve geanonimiseerde set, ook met lopende partijen, handmatige toernooiuitslagen en vervangen gebruikers.

Vergelijk per omgeving aantallen accounts, clubs, gekoppelde schermen, gespeelde partijen, geldige legs en reeds officiële boekingen vóór en na de migratie. Controleer referentiële integriteit en verklaar elk verschil. Oefen herstel uit back-up naast de bestaande omgeving en valideer de actuele data voordat de nieuwe release het gezag overneemt. Houd de vorige client en speler- en displayapp bruikbaar tijdens Play-distributie.

## Meetbare werking van het volledige pakket

Meet tijd tussen de geaccepteerde laatste bevestiging en de zichtbare stand. Richtwaarde bij online normaal gebruik is p95 binnen tien seconden. Meet ook leeftijd van de oudste verwerkingsopdracht, mislukte of herhaalde opdrachten, conflicten, correcties, ontvangen/afgehandelde baanoproepen en appcrashes per versie. Een overschrijding moet naar een concrete bron en revisie terug te leiden zijn zonder pincodes, camera-inhoud of persoonlijke bewijsmaterialen in de logs. Test bij de verwachte eventbelasting, met een volle speeldag waarbij meerdere borden tegelijk afsluiten. Leg werkelijke meetcondities en resultaten bij de release vast.
