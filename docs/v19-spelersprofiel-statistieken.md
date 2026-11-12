# Spelersprofiel, statistieken en één telefoon op een QR-baan

Deze wijziging bouwt voort op de bestaande DartFlow-app, authenticatie, fysieke banen, score-engine, Oche Live en DG Webservices-releaseflow. De implementatie houdt gebruikersnaam, weergavenaam en stabiele account-ID uit elkaar. De statistieken worden uit dezelfde geaccepteerde wedstrijdstatus en definitieve uitslagen berekend; er is geen tweede wedstrijdadministratie.

Dit document beschrijft de implementatie en de gerichte lokale controles. De uiteindelijke release-SHA, volledige suite, browseracceptatie en deploymentstatus worden bij de uitrol vastgelegd. De onderstaande lokale resultaten zijn geen bewijs van een echte Google- of e-mailaanmelding of van bediening van fysieke apparaten.

## Waar testen

Gebruik de bestaande lokale configuratie met een loopbackdatabase. Start de database, pas de migraties toe en start de developmentserver:

```sh
npm run db:start
npm run db:migrate
npm run dev
```

De server heeft daarnaast de private PIN-configuratie nodig. Gebruik hiervoor uitsluitend een afzonderlijk lokaal ontwikkelgeheim; neem nooit een pepper uit staging of productie over. Het configuratiecontract en de voorbereide hostupgrade staan in [infra/V19-PIN.md](../infra/V19-PIN.md). Het document bevat variabelenamen en grenzen, zonder secretwaarden.

Bij een lokale server op poort 3000:

| Onderdeel | Route |
| --- | --- |
| Profielinstellingen, PIN en openbare statistiekvoorkeur | `http://localhost:3000/app/settings` |
| Wedstrijdcijfers, vorm, trend en volledige historie | `http://localhost:3000/app/statistics?view=matches` |
| Tegenstanders en onderlinge historie | `http://localhost:3000/app/statistics?view=opponents` |
| Toernooien en competities | `http://localhost:3000/app/statistics?view=tournaments` |
| Voltooide opgeslagen oefeningen | `http://localhost:3000/app/statistics?view=practice` |
| Baanbeheer en beschikbare baanlinks | `http://localhost:3000/app/locations` |
| Vaste QR-spelersflow | `http://localhost:3000/baan/<baan-ID>` |
| Geopende baanlobby | `http://localhost:3000/app/lobby/<lobby-ID>` |
| Actieve partij en schermvullende scoreconsole | `http://localhost:3000/wedstrijd/<wedstrijd-ID>` |
| Oche Live | `http://localhost:3000/baanscherm/<baan-ID>` |
| Bestaande Oche Live-alias | `http://localhost:3000/oche-live/<baan-ID>/` |

Gebruik het onveranderlijke baan-ID uit baanbeheer. De vaste QR, schermroute, manifest-ID, PWA-start-URL en scope behouden hun bestaande baanbinding. De Cast-routes blijven het volledige scherm 90° rechtsom draaien; bij een liggend signaal van 1920×1080 is de logische inhoud 1080×1920. Zie ook [de bestaande Oche Live-handleiding](oche-live-v18.md) en [de installatiehandleiding](installatie-speler-en-baanschermen.md).

## Profiel en spelerspincode

Nieuwe geverifieerde Google- en e-mailaccounts krijgen een onvoltooid profiel. Een Google-naam is een voorstel. De profielstap vraagt om een unieke **Gebruikersnaam**, een afzonderlijke **Weergavenaam**, **Spelerspincode** en **Herhaal spelerspincode**. Afronden slaagt pas wanneer de profielvelden en PIN samen zijn opgeslagen. Het bestaande algemene commando om een naam te wijzigen kan de nieuwe onboardingcontrole niet omzeilen.

Een gebruikersnaam mag met of zonder één voorloop-`@` worden ingevoerd. De server verwijdert deze presentatieprefix, normaliseert Unicode en witruimte en gebruikt dezelfde canonieke sleutel voor opslaan en opzoeken. Hoofdletters leveren geen tweede claim op. `@@naam` wordt geweigerd. De unieke database-index beslist ook bij gelijktijdige claims. PIN-doellimieten, aanvraagherhalingen en profielopzoeking gebruiken exact dezelfde databasesleutel; de server maakt hiervoor geen tweede, locale-afhankelijke JavaScript-sleutel. Weergaven gebruiken de afzonderlijke weergavenaam; verwijzingen, historie en onderlinge tellingen gebruiken de account-ID.

De PIN bestaat uit precies zes ASCII-cijfers en blijft tekst: `012345` is zes cijfers. Gemaskeerde velden gebruiken een numeriek toetsenbord. Lengte, letters, niet-ASCII-cijfers en een afwijkende herhaling worden client- en server-side geweigerd. Een naamconflict rolt ook de voorgenomen PIN-opslag terug. Een identieke succesvolle aanvraag kan na een verloren response opnieuw worden verzonden zonder een tweede wijziging te boeken.

Bestaande accounts behouden hun naam, historie, rechten en actieve partij. De migratie stelt geen PIN voor hen in. Een ontbrekende PIN blokkeert hun gewone eigen-telefoonflow of bestaande toernooideelname niet. In de eigen profielinstellingen kunnen zij de PIN instellen. Na instellen is ook toevoegen via de telefoon van de eerste speler mogelijk.

**Wijzigen** controleert de huidige PIN vanuit de eigen sessie. **Pincode vergeten?** verwijst naar een nieuwe Google- of e-mailverificatie met terugkeer naar `/app/settings?pin=reset`. De server controleert recente, door Supabase geverifieerde authenticatieclaims; een queryparameter of gewone refresh geldt niet als verificatie. Een wijziging of reset maakt de oude PIN direct ongeldig voor nieuwe koppelingen. Een reeds gekoppelde partij blijft speelbaar.

Alleen de instelstatus wordt teruggegeven. PINs, salts, verifiers en pepperversies staan niet in profielresponses, publieke projecties, realtimegegevens, QR-links of generieke commandoreceipts. De private verifier gebruikt Argon2id met een unieke salt en een afzonderlijk runtimegeheim. Persistente limieten voor aanvrager, doel en waar beschikbaar IP begrenzen pogingen vóór de dure verificatie; een gedeelde databaselease begrenst gelijktijdig KDF-gebruik. Deze afkoeling geldt voor PIN-acties. De exacte configuratie staat in het [PIN-runbook](../infra/V19-PIN.md).

## Twee accounts met één telefoon

1. Speler 1 scant de vaste baan-QR en opent een lokale partij met de normale eigen DartFlow-sessie.
2. Zolang de lobby open is en de tweede plek vrij is, verschijnt **Speler toevoegen**. Zelf scannen door speler 2 blijft mogelijk.
3. Speler 1 geeft de telefoon aan de tegenstander. Die voert de eigen gebruikersnaam en PIN in. Het PIN-veld wordt gewist na iedere poging, bij sluiten en bij navigeren.
4. Na serverbevestiging verschijnt speler 2 met de eigen weergavenaam. De PIN autoriseert uitsluitend deze lokale deelname; de aangemelde sessie blijft die van speler 1.
5. Speler 1 start de partij en voert als schrijver beide scores in volgens de bestaande beurtvolgorde. De console toont steeds voor wie wordt geschreven.
6. De normale uitslagverwerking bewaart één wedstrijd-ID voor beide profielen. Voor deze expliciete PIN-koppeling kan de eerste speler de lokale uitslag vanaf dezelfde telefoon bevestigen. Gewone lokale of remote partijen houden hun eigen bestaande bevestigingsrechten.

De server controleert lobby-eigenaar, deelnemers, spelopzet, vrije tweede plek, baanstatus, reservering, actuele toewijzing, fase en actuele PIN-versie. Zelf toevoegen, een gestarte of verlopen lobby en een verouderde baankoppeling worden geweigerd. Gelijktijdig toevoegen en zelf scannen kan hoogstens één tweede plek opleveren. Een retry van dezelfde geslaagde aanvraag levert dezelfde gekoppelde lobby op, zonder een extra deelnemer of extra rechten.

Onbekende gebruikersnaam, verkeerde PIN en ontbrekende PIN delen de melding **Gebruikersnaam of spelerspincode klopt niet.** Een volle lobby, verlopen sessie of afkoeling heeft een eigen melding. De terugroute naar de eigen QR-scan blijft beschikbaar. Bij refresh haalt de app spelersplekken en schrijfrechten opnieuw bij de server op. Deze koppeling geeft geen toegang tot accountbeheer of het privéprofiel van de tegenstander.

Officiële toernooi- en competitiewedstrijden blijven de toegewezen deelnemers, check-in, beschikbaarheid, schrijver en bestaande oproep- en uitslagverwerking gebruiken. De PIN-flow maakt daar geen alternatieve inschrijving of tweede wedstrijd van.

## Meetregels en historie

De centrale rekenbron staat in `lib/player-statistics.ts`; de private query- en projectielaag staat in `lib/player-statistics-db.ts`. Profiel, toernooioverzicht, matchweergave en Oche Live gebruiken deze bron.

- **3-dartgemiddelde:** `3 × geldige punten / meetellende darts`. Er wordt gewogen met punten en darts, niet gemiddeld over al afgeronde gemiddelden. De eigen beurten uit verloren legs tellen mee. Afronden gebeurt pas bij weergave.
- **Nul en bust:** een geldige nulbeurt blijft een beurt. Een bust levert nul geldige punten en behoudt de restscore. Iedere beurt zonder legwinnende checkout telt volgens de gekozen x01-regel als drie darts. Nieuwe records leggen deze meetversie expliciet vast.
- **Checkout:** de speler kiest met één tik 1, 2 of 3 gebruikte darts. De bestaande score-engine valideert de finish en dubbelbevestiging. Alleen een geldige legwinnende checkout is een finish.
- **Dubbelpogingen:** de compacte optionele invoer bewaart het aantal pogingen op de uitgooidubbel, inclusief de succesvolle dart; de bull volgt het bestaande dubbel-uitreglement. Niet ingevuld betekent onbekend, niet nul. Checkoutpercentage verschijnt alleen wanneer alle beurten in de selectie een betrouwbare pogingregistratie hebben en de totale noemer groter dan nul is.
- **Laatste 50:** selecteer eerst maximaal vijftig definitief afgeronde, gespeelde duels met hetzelfde startscoretype en dubbel-uitreglement. Sorteer op afrondtijd en daarna vast op wedstrijd-ID. Pas binnen dat venster telt de betrouwbare meetdekking. Een oude onvolledige partij wordt niet vervangen door nummer 51. `Gemeten in 32 van 50 duels` maakt ontbrekende gegevens zichtbaar.
- **Speltype:** 501 dubbel uit is de standaard; 301 en 701 blijven afzonderlijke selecties. De bestaande dashboardteller voor gespeelde wedstrijden omvat wel alle gespeelde typen. Het dashboardgemiddelde gebruikt de vergelijkbare 501-selectie.
- **100+ / 140+ / 180:** de totaaltellers zijn cumulatief. Een 180 telt eenmaal bij 180, eenmaal bij 140+ en eenmaal bij 100+. De scoreverdeling heeft exclusieve bereiken 100–139, 140–179 en 180. `100+ per 100 beurten` gebruikt alle geldig geregistreerde beurten, inclusief nul en bust.
- **First 9:** gebruik uitsluitend betrouwbare eerste negen meetellende darts van een leg. Onbekende data later in die leg maken een al betrouwbare eerste-negenreeks niet ongedaan. Een onvolledige prefix levert geen First 9 op.
- **Beste leg:** het kleinste betrouwbare darts­totaal van een gewonnen leg binnen het gekozen speltype. Hiervoor moet de hele betrokken leg betrouwbaar zijn.
- **Hoogste finishes:** rangschik werkelijke uitgooibeurten op score, afrondtijd en ID; herhaalde finishwaarden blijven afzonderlijke prestaties. De lijst bevat maximaal tien items.

Een oud resultaat kan meetellen als overwinning, verlies, gelijkspel en onderlinge ontmoeting terwijl het gemiddelde onbekend blijft. Ontbrekende darts of een ontbrekende scoreketen worden niet verzonnen. Betrouwbare afzonderlijke oude worpen en finishes blijven bruikbaar waar die gegevens wel eenduidig zijn. De broncontrole vergelijkt de beurtketen, legs en bestaande scoretellingen.

Tegenstanders worden op stabiele profiel-ID gegroepeerd en standaard op de laatste ontmoeting gesorteerd. Een naamwijziging splitst de historie niet. Per tegenstander staan de laatste vijf duels en een gepagineerde route naar de volledige onderlinge historie. Toernooien gebruiken dezelfde gespeelde wedstrijdrecords. Een volledig afgeronde competitie toont de plaats uit de bestaande officiële standenbron; een onvoltooid schema krijgt geen definitieve plaats. Bij knockout bepaalt de bevestigde daadwerkelijke finale wie winnaar en finalist is. Een poulestand wordt niet als algemene eindklassering geïnterpreteerd. Byes en administratieve uitslagen blijven apart zichtbaar. Ze worden niet als gespeelde onderlinge partij of dartprestatie meegerekend. Onvoltooide of afgebroken oefeningen tellen niet mee. Voltooide, opgeslagen oefeningen blijven afzonderlijk van wedstrijdvorm, wedstrijdgemiddelde en tegenstanderhistorie.

Verlopen of geforceerd afgebroken vrij spel volgt de bestaande Oche Live-verwijdering van voorlopige scores en blijft buiten de gespeelde historie en cijfers. Een onderbroken officiële partij wordt pas een definitieve uitslag via het bestaande bevoegde toernooipad.

## Oche Live en privacy

De instelling **Historische profielcijfers tonen op openbare Oche Live-baanschermen** staat standaard uit. De server past de actuele voorkeur toe vóór de publieke response wordt opgebouwd. De publieke projectie bevat schermgebonden waarden en anonieme spelerposities, geen account-ID’s of private historie.

Vóór het duel verschijnt de onderlinge balans alleen als beide gekoppelde spelers dit toestaan en er gespeelde historie is. Bij de start wordt per speler een private aftrapsnapshot van de vergelijkbare laatste-vijftigcijfers en eerdere records bewaard. Tijdens de partij blijft dat historische gemiddelde vaststaan; het live gemiddelde en de 180-teller volgen de actuele geaccepteerde wedstrijdstatus. Iedere speler bepaalt met de eigen actuele voorkeur of diens individuele historische waarde en recapvergelijking openbaar zichtbaar zijn. Onderlinge historie vereist beide voorkeuren. Intrekken werkt ook wanneer een aftrapsnapshot al is opgeslagen.

De bestaande twee spelerkolommen, vaste restscores en spiegelkaart `Worp | Rest ‖ Rest | Worp` blijven behouden, met vijf zichtbare beurtregels in de portretweergave. Undo, reconnect en legwissel volgen de serverstand. De historische strook heeft een vaste ruimte; ontbrekende of afgeschermde waarden veranderen de scorekaartgeometrie niet.

Na een normale definitieve afronding kan de baan maximaal vijftien seconden een recap tonen: eindstand, wedstrijdgemiddelde, hoogste finish en, alleen met de passende voorkeur, het verschil met de aftrapsnapshot of een persoonlijk record. De volgende toewijzing, reservering of sluiting krijgt voorrang. De eigen historie bewaart de normale wedstrijdkaart.

## Migraties en releasevoorbereiding

De drie aanvullende migraties worden op volgorde toegepast:

1. [`20261112210321_player_pin_participation.sql`](../supabase/migrations/20261112210321_player_pin_participation.sql): private PIN-verifiers, receipts, KDF-leases en featuremarker `player_pins=1`.
2. [`20261112210433_player_statistics_kickoffs.sql`](../supabase/migrations/20261112210433_player_statistics_kickoffs.sql): private aftrapsnapshots, historie-indexen en featuremarker `player_statistics=1`.
3. [`20261112210439_player_profile_identity.sql`](../supabase/migrations/20261112210439_player_profile_identity.sql): weergavenaam, openbare statistiekvoorkeur, onboardingstatus, canonieke gebruikersnamen, private labelview, profielreceipts en featuremarker `player_profile_identity=1`.

De private tabellen hebben RLS en expliciete runtimegrants. Publieke Supabase-rollen krijgen geen toegang. De bestaande profiel-ID’s en uitslagsnapshots blijven behouden. De aftrapsnapshot is voor de runtime inhoudelijk onveranderlijk; alleen de actuele gekoppelde baan-ID’s kunnen bij officieel hervatten worden aangepast. Readiness controleert het nieuwe schema en de beschikbare PIN-configuratie.

Staging en productie houden afzonderlijke databases, secrets en configuratiebundels. Voor hostvoorbereiding, pepperbeheer, config-ID’s, rollbackgrenzen en native deployment wordt uitsluitend het [PIN-runbook](../infra/V19-PIN.md) gevolgd. Voer de lokale migratie- en seedcommando’s niet uit tegen hosted projecten. De nieuwe bron wordt via de bestaande exact-SHA-flow eerst op staging en vervolgens met dezelfde bron-SHA op productie gebouwd.

## Uitgevoerde gerichte lokale controles

Alle onderstaande controles zijn met synthetische lokale ontwikkelaccounts en UUID-afgebakende fixtures uitgevoerd. De fixtures worden na afloop opgeruimd. Er zijn voor deze controles geen staging- of productieaccounts, wedstrijden of trainingsgegevens aangemaakt.

| Onderdeel | Gecontroleerd resultaat |
| --- | --- |
| Profiel en canonieke naam | Eén `@`, afwijzing van `@@`, Unicode/witruimte, bezette naam en database-uniciteit; Google-metadata kan onboarding niet zelf bevestigen. |
| Atomair instellen | Voorloopnul, verkeerde lengte, letters, niet-ASCII-cijfers, ontbrekende bevestiging en mismatch; naamconflict rolt de profiel- en PIN-wijziging terug; een gecorrigeerde retry slaagt. |
| Herhaling | Een geslaagde profielaanvraag kan met hetzelfde ID opnieuw worden verzonden; de PIN-versie blijft gelijk. Een ander payload onder hetzelfde ID wordt afgewezen. |
| Bestaand account | Zonder PIN blijven eigen scorebeurten mogelijk; instellen en wijzigen van de weergavenaam behouden account, actieve score, uitslagsnapshot en clubrechten. Nieuwe matchcreatie neemt de juiste weergavenaam onder de bestaande profielvergrendeling over. |
| Private gegevens | Responses en generieke receipts bevatten geen PIN, verifier, salt of pepperversie; het algemene platformcommando weigert PIN-velden. Private RLS en grants zijn gecontroleerd. |
| Rekenen | 501 in vijftien darts geeft 100,20 AVG; gecombineerd met 501 in dertig darts geeft het gewogen totaal 66,80. Verloren legs, nul, bust en checkouts van één tot drie darts zijn gecontroleerd. |
| Dekking en tellers | Een venster van 51 duels, onvolledige data binnen de laatste vijftig, aparte 301-selectie, First 9-prefix, cumulatieve en exclusieve tellers, herhaalde topfinishes en ontbrekende dubbelpogingen. |
| Canonieke PIN-sleutel | Griekse sigma gecombineerd met Unicode 17-letters, hoofdletters en één voorloop-`@` delen dezelfde database-doellimiet en dezelfde succesvolle aanvraagreceipt. |
| Officiële klassering | Een afgeronde 301-competitie toont de opgeslagen plaatsen voor beide spelers. Een onvoltooid schema krijgt geen eindplaats. De daadwerkelijke knockoutfinale bepaalt winnaar/finalist, ook zonder gecachte kampioen-ID. |
| Identiteit en historie | Eén resultaat voor beide profielen, deduplicatie van baan-/toernooiprojecties, naamwijziging, laatste vijf tegenstanders en paginering. Het bestaande dashboard telt ook afgeronde lokale, remote en 301-toernooiduels. |
| Privacy en Oche-projectie | Standaard geen historische cijfers; individuele opt-in, gedeelde onderlinge toestemming, onveranderlijke aftrapsnapshot, live 180, recap, intrekken van toestemming en voorrang voor een nieuwe toewijzing. De publieke projectie bevat geen private profiel- of wedstrijd-ID. |
| Bestaande correctieflow | Betwiste onbevestigde uitslag → bevoegde beslissing tot hervatten → gecorrigeerde geaccepteerde worpen → normale bevestiging. Twee herstelverzoeken houden precies één uitslag en de opnieuw berekende finish en AVG over. |
| Afbakening | Byes, walkovers, onderbroken officiële wedstrijden, afgebroken vrije partijen en oefendata vallen buiten gespeelde wedstrijdcijfers waar voorgeschreven. Alleen voltooide opgeslagen oefeningen verschijnen bij Oefenen. |

De gerichte bestanden zijn `tests/profile-setup-db.test.ts`, `tests/player-statistics.test.ts`, `tests/player-statistics-db.test.ts`, `tests/player-statistics-classification.test.ts`, `tests/player-pin-db.test.ts`, `tests/username-db.test.ts`, `tests/display-name-race.test.ts` en `tests/platform-db.test.ts`. De laatste gerichte run staat lokaal in `.local/v19-profile-statistics-regression.log`. Typecheck en gerichte lint zijn eveneens geslaagd. De volledige suite, build en browseracceptatie worden afzonderlijk bij de uiteindelijke release geregistreerd.

De bestaande wedstrijdrechten bieden geen algemeen pad om een al gepubliceerde definitieve uitslag achteraf te herschrijven. Deze wijziging voegt daarvoor geen alternatieve SQL- of API-route toe. Het hierboven bewezen correctiepad eindigt vóór publicatie; een correctie ná publicatie is hiermee niet als uitgevoerde of ondersteunde acceptatie geclaimd.

Echte Google-/OTP-aanmeldingen, ontvangst van verificatiemails en PIN-reset via een echte provider zijn niet door deze synthetische ontwikkeltests bediend. Native installatie, cameratoegang, echte QR-scans, Chromecast/montage en herstart na stroomuitval vragen afzonderlijke apparaatvalidatie; softwarematige browsermetingen vervangen die bediening niet.

## Reken- en beveiligingsreferenties

De rekenmethode en de behandeling van een niet-uitgegooide beurt als volledige drie-dartsbeurt volgen [The Darts Atlas](https://guides.dartsatlas.com/en-gb/basics/stats/). De generieke verificatiemelding en persistente pogingbeperking sluiten aan op de [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html). Het gebruik van een password-KDF, unieke salt en afzonderlijk bewaard servergeheim volgt de [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
