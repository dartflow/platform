# Acceptatie en testplan

Leg per controle het resultaat, de gebruikte omgeving, de commit-SHA en de waarneming vast. Markeer een controle als open wanneer een echt apparaat, een testaccount of een providerconfiguratie ontbreekt. Een demoactie of een mocktest toont de UI en contracten aan. De stagingpilot toont de productieketen aan.

## 1. Baseline reproduceren

Gebruik de vastgelegde Sites-bron van versie 15. Uitgevoerd op `e27cccdbd0b6cd2144cc2f26cab9e2986a903e61` op 11 november 2026. `npm test` meldt **46 geslaagd**. Een aantal bestanden bundelt meerdere scenario’s in één Node-testresultaat. Onder meer 15 scoringsscenario’s worden zo samen uitgevoerd.

```bash
npm test
npm run build
node --check dist/server/index.js
npm run dev
```

In dit referentieproject bouwt `npm run build` de Sites Worker. Het is een bron- en gedragscontrole. Gebruik voor het doelproject zijn eigen build, types, test- en deploycommando’s.

| Bronreeks | Opnieuw bewijzen in doelproject |
|---|---|
| `test-scoring.mjs` | Onmogelijke score en dart-aantal, nulbeurt, bust, dubbelconfirmatie, bull, checkout-bogeys, hoogste finish, 180, beurt, nieuwe-legstarter, undo, meerderheidswinst, vaste legs/gelijkspel en 701. |
| `tests/baan-domain.test.mjs`, `baan-api.test.mjs`, `baan-phone.test.mjs` | Wacht-/vrij-/live-/resultaatstatus, eerste schrijver, overname, onbevoegde derde, race, revisions, retry, invite, verlopen wachtbaan, setgrens, twee acceptaties, mobiele dubbelbevestiging en persoonlijke historie. |
| `tests/room-tests.mjs`, `room-scope-tests.mjs` | Lobby, opstelling, beurt, pauze/herstel, correctie-akkoord, dubbel, gezamenlijke bevestiging, legaal botgedrag, vast aantal legs, trainingsscheiding en clubscope. |
| `tests/competitions-tests.mjs` | Round-robin-paren, tijdvoorstel, programma, uitslagdoorvoer, 4–4, check-in, knock-outdoorloop, clubscope en één bijbehorende toernooikamer. |
| `tests/clubs-tests.mjs`, `community-tests.mjs` | Capaciteit, lidmaatschapsaanvraag, goedkeuring, rollen, opvolging, toegang intrekken, code, ontsnappen van HTML, moderatie, hostoverdracht, acceptatie van uitdaging. |
| `tests/venue-baan-tests.mjs`, `venue-offline-tests.mjs` | Bord blijft bij de juiste fixture, uitslagimport alleen na passend bevestigd resultaat en één keer, offline scorebuffer, conflict en behoud van stand. |
| `tests/mail-engine.test.mjs`, `mail-triggers.test.mjs`, `mail-ui.test.mjs` | Alle 32 maildefinities, valide URL/variabelen, concept/publicatie/overerving, stabiele outbox-snapshot, tenant- en rollencontrole, geen authcode in log, deduplicatie, retry. |
| `tests/navigation.test.mjs`, `player-dashboard.test.mjs` | Actieve partij voor agenda, clubcontext, links naar echte programma-items, desktop en mobiele werkruimtes, scopewissel. |

## 2. Reproduceerbare voorbeelden

### A. Sprint lokaal met twee telefoons en één scherm

1. Open op staging **Spelen → Baanmodus → Open Sprint-baanscherm** op een portraitscherm. Vrije baan toont een scanbare QR, naam van de baan en een duidelijke wachtstatus.
2. Scan op telefoon A en B. Gebruik twee stagingaccounts en twee onafhankelijke sessies. A start 501 lokaal, B koppelt via dezelfde baan en accepteert. Voor elke telefoon staat de resterende score van beide spelers direct op de invoerpagina.
3. A voert 180 in voor de eerste beurt. Het scherm toont 321–501, een 180-regel en een beurtwissel. B ziet dezelfde stand als A, zonder actief keypad zolang A schrijft.
4. B kiest **Score-invoer overnemen** en bevestigt. B voert 60 in voor de volgende beurt. Het scherm en beide telefoons tonen 321–441. Laat een vertraagde scorepost van A terugkomen. Die wordt geweigerd en geeft de actuele stand.
5. Neem een extra kijker op een derde apparaat. Die kan scores bekijken volgens de deellink, kan de schrijverstatus niet overnemen en heeft geen inzage in private spelershistorie, auth- of invite-tokens.
6. Zet telefoon A tijdelijk offline of sluit het tabblad. B blijft invoeren. Na herstel leest A de huidige revision en stuurt geen oude beurt door. Verifieer ook verlies van de schermverbinding, herverbinden en opnieuw laden.
7. Herhaal met lange scorekaart en standen met één, twee en drie cijfers. Geen horizontale scroll of tekstreflow, vaste score- en scorekaartlettergroottes, nieuwe beurt direct zichtbaar en geen dubbele rij bij netwerkretry. Gebruik een 1080×1920-uitvoer en test een 9:16-browser op 360/390 px.

### B. Sprint online op afstand

1. A start **Online wedstrijd** op een aparte testbaan. A deelt de uitnodiging met B buiten de browser van A.
2. Een foutieve of verlopen token en een open schermroute leveren geen join-rechten op. Met geldige token en juiste ingelogde ontvanger accepteert B de uitnodiging.
3. Speel een leg uit op onafhankelijke verbindingen. Check dezelfde beginstand, actieve beurt, scores, winnaar en persoonlijke historie na herladen. Test overname, een dubbele klik op opslaan en twee clients die tegelijk dezelfde revision insturen.
4. Voor de gewone wedstrijdkamer met camera doorloop aanvullend bordcheck, gereedmelding, toegestane media en tekstchat, inclusief geweigerde camerarechten, afgebroken verbinding en terugkeer. De lokale camera- en microfoontest blijft zelfstandig werken. Een geautoriseerde kijker krijgt de bedoelde read-only-weergave.

### C. Dubbel uit, sets, correctie en gelijkspel

- Begin een 301-leg. Laat speler 1 met 180 op 121 komen en laat speler 2 een legale beurt gooien. Voer 121 voor speler 1 in. Zonder bevestiging blijft de officiële stand 121 en wacht het keypad op de keus. Bevestig dubbel uit. Eenmaal legwinst, geregistreerde hoogste finish 121 en de juiste startspeler in de volgende leg.
- Begin op rest 40. Een beurt van 39 geeft bust en laat 40 staan. 40 in één dart kan met D20. 60 in één dart is een geldige beurt elders, maar geen dubbel-uitfinish vanaf rest 60. Onmogelijke score 179 wordt geweigerd vóór een scorewijziging.
- Speel een best-of met sets. Verifieer tellerreset en punten per leg, totale sets, historie en herstel via undo over de setgrens. Bij een reeds gepubliceerde competitieve uitslag loopt een correctie via de geautoriseerde beslisflow en heeft een auditspoor.
- Speel een competitiefixture van acht vaste legs tot 4–4. De partij blijft bij 4–0 open, sluit bij acht gespeelde legs, kent de juiste gelijkspelpuntentelling toe en bereikt de stand één keer. Een oefen- of botscore verandert die stand nooit.

### D. Eén clubavond van inschrijving tot kampioen

1. Maak in staging een speeldag met twee poules, een klein deelnemersmaximum en twee borden. Schrijf genoeg spelers in voor een wachtlijst. Laat één inschrijving vervallen en controleer dat de eerstvolgende in aanmerking komende speler één bevestiging krijgt.
2. Check spelers in, meld ze gereed en zet één speler op pauze. Reserveer of blokkeer één bord. Test automatische bordtoewijzing, handmatige selectie, schrijverrotatie indien ingesteld, oproeptimer, uitblijven van acceptatie, cooldown en opnieuw gereedmelden.
3. Koppel een toegewezen wedstrijd aan Baanmodus vóór de eerste score. Laat beide echte deelnemers de fixture accepteren. Een derde speler kan zich met dezelfde naam voordoen, maar de server weigert deelname op identiteit. Speel uit op twee telefoons. De eerste bevestiging houdt de partij in afwachting. De tweede verwerkt dezelfde fixture precies één keer in standen, geschiedenis en voortgang.
4. Open de gekoppelde uitslag opnieuw en simuleer dezelfde afleveractie. Geen tweede resultaat, dubbele legwinst of tweede mail. Probeer uitslagimport van een andere fixture op hetzelfde fysieke bord. De server weigert.
5. Speel een gewone tabletpartij offline. Buffer uitsluitend geldige score/undo-opdrachten. Het zaalscherm blijft op de laatste gepubliceerde stand. Herstel zonder conflict en zie alle beurten eenmaal in volgorde. Herhaal met wijziging van de officiële basis, behoud de buffer en toon een controleerbaar conflict.
6. Betwist een uitslag. Alleen bevoegde wedstrijdleiding van deze speeldag kan een reden en uitkomst vastleggen. De stand blijft ongewijzigd tot de beslissing. Rond de poules af, controleer de beste twee per poule en speel door tot de kampioen.
7. Open **Schermstudio** op een organisatortoestel, het zaalscherm via VeyoCast, OBS Browser Source en de publieksweergave op afzonderlijke clients. Zet eerst preview op **Bordscore**, vervolgens **Naar programma**. Pas dan volgt programma. Test oproep, 180, finish, uitslag, volgende partij en pauze. Andere speeldagen blijven onafhankelijk.

### E. Account, clubcontext en chat

1. Meld account A aan met e-mail-OTP en account B via Google op staging. Vernieuw pagina, log uit en in, open een diepe app-link. Eén account opent eigen clubs, wedstrijden, historie en instellingen.
2. A is eigenaar van club X en lid bij Y. B is beheerder van Y en heeft geen lidmaatschap van X. Vanuit Y kan A zijn eigen X-beheer niet uitvoeren totdat hij X selecteert en X-rechten gelden. B krijgt via vervalste club-ID, endpoint, API-call, realtime subscription of UI-actie nooit toegang tot X-privédata. Dezelfde scheiding geldt voor schrijf-, export- en realtime rechten.
3. Wissel van omgeving midden in een wedstrijd- of sjabloonactie. Server gebruikt oorspronkelijke resource-eigenaar en autorisatie, weigert verouderde context waar nodig en verplaatst niets.
4. Start een vriendschapsverzoek, accepteer vanuit de tweede sessie en open een privékamer. Stuur een bericht en accepteer een uitdaging. Controleer bij twee apparaten de echte nieuwe berichten, lobby en uitnodiging. Test volle kamer, verlopen code, trage-modus, ban en opheffen, vertrekkende host, blokkade en verwijderde lidmaatschapsrechten.
5. Beheer competitie, toernooizaal en eigen profiel op mobiel en desktop. Het volgen van een zaal- of overlaylink mag geen sessierol opwaarderen.

### F. Mailbeheer en aanmeldproviders

1. Kies in staging de gecontroleerde afzenderconfiguratie. Vul een staging Resend API-sleutel in als write-only invoer. UI toont geconfigureerd, tijdstip en eventueel veilige fingerprint. Controleer dat response, HTML, clientbundle, logs, outbox en browserstorage de sleutel niet bevatten. Controleer dat een clubbeheerder de platformconfiguratie niet kan lezen of wijzigen.
2. Maak vanuit platformtemplate een concept voor **Oproep naar de baan**, bekijk HTML én tekst, publiceer het en maak een cluboverride. Simuleer een concrete bordoproep met testontvanger, daarna echte verzendtest in staging met toegestane ontvanger. In nieuw bericht zijn afzender, antwoordadres, onderwerp, invulvariabelen en link juist. Oud bericht bewaart de eerdere sjabloonversie.
3. Simuleer dubbele publicatie van dezelfde bedrijfsgebeurtenis en dubbele aflevering van een webhook. Eén bericht per bedoelde ontvanger en één statusovergang per provider-event. Controleer geverifieerde status uit provider en test ongeldige handtekening, verkeerde omgeving, rate limit, tijdelijke fout, permanente fout, bounce en klacht. Retry gebruikt het bestaande bericht en dezelfde inhoud.
4. Zet een toekomstig tijdvoorstel vast. Verander het vlak vóór het herinneringsmoment. Alleen een herinnering bij de geldige actuele afspraak blijft over. Wachtlijstpromotie, geschil en bevestigde uitslag genereren de bedoelde berichten aan de bedoelde ontvangers.
5. Stel Google in vanuit de beheeromgeving via de gedocumenteerde Supabase-configuratiestroom. Voer staging OAuth-redirects in, controleer status zonder Google Client Secret terug te tonen en doorloop een werkelijke OAuth-login en callback. Verkeerde redirect, geannuleerde toestemming, verkeerde omgeving en mislukte providerupdate moeten duidelijke fouten geven. Test dat e-mail-OTP blijft werken na Google-rotatie.
6. De gebruiker configureert Supabase custom SMTP per omgeving. Test met zijn stagingconfiguratie een OTP-mail en een verlopen of foutieve code. Controleer dat OTP-mail via Supabase loopt en geen DartFlow-outboxbericht vormt. Voor productie voer je een gecontroleerde rooktest uit met de productieconfiguratie en een aangewezen testaccount.

## 3. Extra regressies voor gelijktijdigheid en autorisatie

| Test-ID | Scenario | Verwacht |
|---|---|---|
| CON-01 | Twee scanners proberen dezelfde vrije baan gelijktijdig te starten | Precies één start gecommitteerd. Andere client krijgt conflict en de bestaande baanstate. |
| CON-02 | Score en schrijfwissel arriveren op dezelfde revision | Eén actie commit. Andere client leest de nieuwe state en probeert alleen na relevante controle opnieuw. |
| CON-03 | Zelfde score opnieuw na timeout, refresh en retry | Request-ID blijft gelijk voor de bedoelde actie. Eén gezaghebbende beurt en één afgeleide realtime update. |
| CON-04 | Twee deelnemers bevestigen vrijwel tegelijk | Eén definitieve overgang, één resultaat, beide historie-items, één standings-update. |
| CON-05 | Dubbele oproep op twee borden of twee events met gedeelde speler | Dezelfde speler of schrijver kan niet gelijktijdig voor overlappende partijen worden vastgezet. Stale bordtoewijzing faalt netjes. |
| CON-06 | Realtime gebeurtenis komt vertraagd of uit volgorde binnen | Client verwerpt oude revision, haalt ontbrekende snapshot op en springt nooit terug naar een oudere stand. |
| AUTH-01 | Speler manipuleert demo-rol, localStorage, clientclaims of route | De server gebruikt geverifieerde sessie en actuele rechten. Privilegewijziging faalt. |
| AUTH-02 | Moderator, clublid, wedstrijdleider en platformbeheerder gebruiken dezelfde API | Elk krijgt uitsluitend bevoegdheden voor bedoelde resource en scope. Log voor beheeractie bevat actor, doel, tijd, resultaat. |
| AUTH-03 | Ongeldige of ingetrokken deellink, invite of externe screentoken | Veilige fout, geen privécontext, geen mutatierecht. |
| AUTH-04 | Stagingrequest komt met productiehost, projectreferentie of webhook-ID | Controle faalt voordat data of secrets tussen omgevingen kunnen bewegen. |
| DATA-01 | Backfill/migratie tweemaal, deploy vorige release en weer vooruit | Herhaalbare invoer, bestaande records blijven gekoppeld, oude en nieuwe release kunnen de voor rollback bedoelde schemaversie lezen. |
| DATA-02 | Uitval tussen wedstrijdcommit en mailverwerking | Uitslag en outbox blijven consistent. Worker kan hervatten met deduplicatie. |
| DATA-03 | Geannuleerde wedstrijd met ingepland bericht | Vervallen bericht wordt niet als geldige herinnering verzonden. |
| DATA-04 | Deelnemer opent een oude QR of bevestigingsmail na cutover | Geldige oude route verwijst naar juiste resource. Verlopen geheim of verwijderde resource geeft expliciete fout. |

## 4. UI- en navigatiecontrole

| Controle | Wat vastleggen |
|---|---|
| Marketing | Desktop en mobiel. Alle CTA’s, ankers, FAQ, widget, responsieve beelden en canonical/sitemap op productiedomein. Staging is tegen indexeren beschermd volgens de omgeving. |
| App | 360, 390, 768 en brede desktopweergave. Speler en organisator, menu via toetsenbord, kleine viewport, laad/lege/foutstatus en lange Nederlandse labels. Donker grafiet, lime en transparant logo komen overeen met v15. |
| Live | QR standby, wachtend op akkoord, remote invite, solo, twee spelers, overname, uitval, herstel, bust, finish en lange scorekaart. Goede leesbaarheid op afstand. |
| Uitgangen | Schermstudio, zaal, extern bord, OBS transparantie en mobiel publiek op aparte clients. Alle outputlinks blijven leesbaar en hebben juiste rechten. |
| Deep links | Marketing, app, oude root-hashes, dynamische QR, bestaande club-/uitnodigingslink, fixture-CTA en return na login. |
| Gegevensscheiding | Nieuwe sessie en apparaten zien dezelfde bevoegde serverdata. Demo-accounts, voorbeeldmails, tokens en demo-rollen verschijnen alleen in development of staging met expliciete seed. |

## 5. Release-evidence

Vul onderstaande tabel per release in. Koppel staging- en productieversie aan de exacte bron-SHA en vastgelegde build/deployprocedure. Bij productie rooktesten uitsluitend op een daarvoor ingerichte testbaan en testaccount, zodat de echte speeldag en mailontvangers ongestoord blijven.

| Omgeving | SHA / build-ID | Route of test-ID | Resultaat | Evidence of verwijzing |
|---|---|---|---|---|
| Development | `<sha>` | Baselinesuite en doelprojecttests | `<pass/open/fail>` | Testrapport |
| Staging | `<sha>` | Sprint A–C, clubavond D, account E, mail F | `<status>` | Screenshots, geanonimiseerde IDs, testlog |
| Staging | `<sha>` | Concurrency, scopes, rollback en providerisolatie | `<status>` | Tests, revisies, health/readiness |
| Productie | `<sha>` | Eigen domein, health, login, Baanmodus, schermread en gecontroleerde mail | `<status>` | Productiehealth en rooktestbewijs |
| Productie | `<sha>` | Herstelpad, back-up/schemastatus en actieve release | `<status>` | Releasecheck en terugvalreferentie |

Een pariteitscontrole is af als de bijbehorende route, schrijfactie, rechten en fouten werken in de beoogde omgeving en het testbewijs vastligt. Leg aangetroffen hiaten vast per feature-ID uit `01-Prototype-en-featurepariteit.md`.
