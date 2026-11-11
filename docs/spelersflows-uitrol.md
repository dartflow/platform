# Spelersflows en uitrol — 11 november 2026

Deze wijziging bouwt voort op v15 en de vaste verenigingsbanen. De normale routes, geverifieerde Supabase-authenticatie en releasecontrole blijven leidend.

## Gedrag

1. Nieuwe uitnodigingen krijgen vier hoofdletters/cijfers en een deelbare link op de eigen origin, `/w/K7M2`. De server accepteert kleine letters. De database reserveert codes uniek, ook bij gelijktijdige aanmaak; verlopen reserveringen kunnen worden hergebruikt. De bestaande geldigheid van zeven dagen en toegangsregels blijven gelden. Bestaande lange tokens worden niet gemigreerd of voortijdig ingetrokken. Raden wordt buiten de opdrachttransactie begrensd per account, IP en platform; mislukte opdrachten draaien de teller niet terug. Onbekende, verlopen en onbevoegde uitnodigingen geven dezelfde veilige foutmelding.
2. Bij het camerabeeld staan **Camera wisselen** en, bij meerdere camera's, een keuzelijst. Alleen de videotrack wordt vervangen via de bestaande WebRTC-sender. De vorige camera blijft beschikbaar totdat het nieuwe beeld gereed en geaccepteerd is. Audio, dempstatus, verbinding en wedstrijd blijven behouden. Voor telefoons die geen twee camera's tegelijk kunnen openen is er een expliciete herpoging met herstel van de vorige camera.
3. **Beide thuis** en **Hybride** gebruiken servermatig de opgeslagen opstelling om elke speler alleen zijn eigen beurt te laten schrijven. Er is geen overnameknop. Aanvraag-ID, beurt en revisie voorkomen dubbele of verouderde worpen. Lokale opstellingen behouden één schrijver. Sprint leest dezelfde gezaghebbende wedstrijdstand. De datamigratie past uitsluitend actieve gekoppelde thuis-/hybridematches aan; resultaten, worpen en historie blijven intact.
4. Na geverifieerd aanmelden wordt registratie afgerond met één verplicht veld **Naam op het scorebord**. Een Google-naam is een voorstel en moet expliciet worden bevestigd. Lege namen, alleen witruimte, de placeholder **Nieuwe speler**, onzichtbare controletekens en namen boven 80 tekens worden op de server geweigerd. Bestaande onvolledige accounts moeten dezelfde stap doorlopen vóór deelname of spelen. Het account, clubrechten en gepubliceerde historie blijven behouden. Actieve wedstrijden krijgen de bevestigde naam, ook bij gelijktijdige profielbevestiging en wedstrijdaanmaak.

## Uitgevoerde lokale controles

De productiebuild, TypeScript en ESLint slagen. Alle 152 applicatie- en databasetests slagen zonder skips op een schone lokale fixture. De bestaande prototype- en deployercontroles slagen: 46 prototypecases en 57 native deployercases. De afzonderlijke runner-, cleanup-, runtime-, upgrade-, TURN- en Auth-grenscontroles slagen eveneens. De uitgepakte lokale Postgres-distributie mist de LLVM-runtime; alleen voor die loopbackfixture staat JIT daarom uit.

Alle twaalf browserregressies slagen in lokaal Chromium, inclusief de bestaande wedstrijd-, QR-, verenigingsbaan-, zaal-, mailherauthenticatie- en mobiele flows. De nieuwe controles gebruiken uitsluitend loopbackfixtureaccounts:

| Onderdeel | Accounts en bewijs | Stagingacceptatie |
| --- | --- | --- |
| Korte uitnodiging | Danny Goldenbelt, Michael de Groot en Speler andere club: UI-aanmaak, heropenen, kopiëren van eigen `/w/`-link, invoer met kleine letters, dezelfde lobby via korte link, ongeldige/verlopen/gerichte uitnodiging | Nog uit te voeren op de nieuwe hosted release |
| Camera wisselen | Michael de Groot en Raymond van Dijk in twee browsercontexten: echte WebRTC-verbinding, ontvangen rode/blauwe/rode frames, audio-RTP en energie lopen door, dezelfde audiotrack en peer, fout- en dempstatus, daarna scoren | Fysieke iOS Safari + Android Chrome met twee toestellen nog open |
| Eigen beurtinvoer | Michael en Raymond bevestigen tijdelijk de namen Noor Dart en Sam Dart; thuis, hybride en lokaal worden via twee browsers gespeeld, met dezelfde reststand op beide toestellen | Nog uit te voeren met echte stagingaccounts |
| Verplichte naam | Lege/witruimtenaam geweigerd via UI en API, placeholderprofiel aangevuld, Google-voorstel expliciet aangepast, beide gekozen namen zichtbaar in lobby en wedstrijd; DB-tests controleren geverifieerde Auth-provisioning en gelijktijdigheid | Echte e-mail- en Google-registratie op staging nog open |

Fixturelogins en gesimuleerde camera's bewijzen geen fysieke telefoon- of echte provideracceptatie. Er zijn voor deze wijziging geen echte OTP-codes aangevraagd of providercredentials aangepast.

De eerste echte CI-run voor deze spelersflows (`43098736073`, bron `7e730cf39d6877da7f13be2acfd93c45ef835916`) voerde alle controles uit. Alle nieuwe flows slaagden; een bestaande browserproef voor toernooigoedkeuring faalde bij check-in. De vervolgens gereproduceerde race tussen entiteitsrevisie en deelnemersstatus is hersteld door beide in dezelfde SQL-momentopname te lezen. Een gerichte regressie houdt een echte gelijktijdige goedkeuring tegen de leesgrens; verouderde schrijfverzoeken blijven geweigerd. De browserproef controleert nu ook de werkelijke HTTP-uitkomst van check-in.

## Releasevolgorde

1. Annuleer oude workflows via de normale en, waar nodig, geforceerde annulerings-API. Leg de werkelijke respons vast. Een GitHub-409 betekent dat annuleren niet is gelukt.
2. Commit de geteste bron, push naar `main` en eis een geslaagde native `push`-CI met job **Verify** voor exact die volledige SHA. Lokale tests vervangen deze controle niet.
3. Maak vóór hosted datamigraties een verse gecontroleerde backup van de betreffende omgeving. De runtime-export bevat alleen leesbare private applicatietabellen; Supabase Auth en providerinstellingen vallen buiten die export.
4. Staging heeft v15 en `club_boards` al. Pas daarna de drie nieuwe, beoordeelde migraties in volgorde toe:
   - `20261111203744_per_player_remote_scoring.sql`
   - `20261111203820_short_invitation_codes.sql`
   - `20261111204007_required_scoreboard_names.sql`
5. Deploy staging via `deploy-staging.yml` met dezelfde geslaagde SHA en configuratie `staging-2026-11-11-v15-mail-1`. Controleer publieke en loopback `health`/`ready`, release-SHA, release-ID en configuratie. Readiness vereist alle bijbehorende featuremarkers. Voer vervolgens de bovenstaande stagingacceptatie uit en noteer accounts, apparaten en resultaten zonder sessies of codes vast te leggen.
6. Productie heeft nog alleen het basisschema. Daar zijn eerst de twee bestaande v15-migraties en de migratie voor verenigingsbanen nodig, gevolgd door dezelfde drie nieuwe migraties. Gebruik geen blinde volledige schemaherhaling op de hosted database. Deploy vervolgens exact de op staging geverifieerde SHA via `deploy-production.yml` met `production-2026-11-11-v15-mail-1` en controleer dezelfde identiteit en grenzen.

Deze vier wijzigingen vereisen geen nieuwe GitHub-secrets of variabelen. Bestaande omgevinggebonden Auth-, database-, media- en mailconfiguratie blijft nodig.

## GitHub-blokkade

De eerdere runs `43095319680`, `43096044898` en `43096546716` staan op queued zonder jobs of checkruns. Normaal en geforceerd annuleren retourneren HTTP 409, ook na het expliciete verzoek om alle workflows te annuleren. Een eerdere wijziging van de concurrencygroep heeft de uitvoer niet hersteld. Er is geen CI-succes of deployment gesimuleerd.

GitHub noemt deze combinatie een mogelijke inconsistente workflowrun/checksuite die normale zelfbediening niet kan opruimen. Zie [de officiële troubleshooting](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows#canceling-workflows). Het door de eigenaar aangeleverde ticket 4979898 voor een vergelijkbare VeyoCast-run is gesloten zonder technisch herstel. Er is namens de gebruiker geen nieuw supportbericht geplaatst. De huidige verbinding kan de organisatiepolicy niet lezen zonder extra `admin:org`-scope; een eigenaar kan de Actions-policy en eventuele account-/billingmelding in de webinterface controleren.

Zolang de vereiste CI niet geslaagd is, worden de nieuwe hosted datamigraties en activatie uitgesteld. De eerder actieve stagingrelease is `e8317d22fcb7c4d1150962c94d18454af2f4a69b` (`43074167296-1`); productie is `4634852c17cc7737bec246c0b48310e975a36920` (`42995766522-1`). De uiteindelijke actieve identiteit moet opnieuw via `health` en `ready` worden vastgesteld; bovenstaande bronwijzigingen zijn geen bewijs van hosted uitrol.
