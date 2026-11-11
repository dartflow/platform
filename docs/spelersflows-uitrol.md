# Spelersflows en uitrol — 11 november 2026

Deze wijziging bouwt voort op v15 en de vaste verenigingsbanen. De normale routes, geverifieerde Supabase-authenticatie en releasecontrole blijven leidend.

## Actieve uitrolstatus

De bron `aa7ac5e49de184fa4eb5ec1a83318c44e1b5d0d6` heeft de vereiste native [CI-run 43101115753](https://github.com/dartflow/platform/actions/runs/43101115753) met **Verify** doorlopen: 152 applicatie- en databasetests, alle twaalf browserregressies, build, TypeScript, ESLint en de bestaande prototype-, deployer- en grenscontroles zijn geslaagd. De regressie voor de gezamenlijke momentopname van revisie en deelnemersstatus zit in deze bron.

| Omgeving | Bron en release | Configuratie | Vastgestelde status |
| --- | --- | --- | --- |
| [Staging](https://staging.dartflow.nl) | `aa7ac5e49de184fa4eb5ec1a83318c44e1b5d0d6` · `43101809775-1` | `staging-2026-11-11-v15-mail-1` | [Deployment 43101809775](https://github.com/dartflow/platform/actions/runs/43101809775) geslaagd; publieke en loopback `health`/`ready` bevestigen deze identiteit |
| [Productie](https://dartflow.nl) | `aa7ac5e49de184fa4eb5ec1a83318c44e1b5d0d6` · `43102459247-1` | `production-2026-11-11-v15-mail-1` | [Deployment 43102459247](https://github.com/dartflow/platform/actions/runs/43102459247) geslaagd; publieke en loopback `health`/`ready` bevestigen deze identiteit |

De zes benodigde migraties zijn in productie in de beoordeelde volgorde toegepast. De [eindcontrole van 21:25:54 UTC](evidence/spelersflows-deployed-2026-11-11.json) bevestigt beide actieve releases. De oudere productiebron `4634852c17cc7737bec246c0b48310e975a36920`, release `42995766522-1` en configuratie `production-2026-11-11-v1` blijven historische referenties en het vorige applicatierollbackpunt.

De [verse backups en productieherstelproef](evidence/spelersflows-predeploy-backup-2026-11-11.json) zijn vóór de migraties gecontroleerd. Alle acht bestaande stagingworpen zijn behouden; de controlehash van de wedstrijdgegevens buiten de bedoelde modus-, schrijver- en revisievelden is vóór en na de migratie en na beide deployments identiek. Productie behoudt nul profielen, clubs, wedstrijden en worpen. Beide omgevingen hebben 46 private applicatietabellen met RLS. Anonieme, aangemelde en service-API-rollen mogen de codetabel en eigenaarbootstrap niet lezen; de runtime heeft alleen de bedoelde applicatierechten. De [INFO-melding over RLS zonder beleid](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) betreft uitsluitend de bewust ontoegankelijke eigenaarbootstrap.

Milo's bron, release, proces-ID en starttijd zijn gelijk gebleven, evenals de inode van het gedeelde bouwslot. De productiepromotie heeft staging niet herstart. Beide eigen mailtimers zijn actief; de productie-oneshot eindigde met exitstatus 0. In beide apps staat de afzender op **DartFlow <noreply@dartflow.nl>**, Reply-To `support@dartflow.nl`, met modus **Log** en zonder Resend-appcredentials. Deze appinstelling wijzigt de afzonderlijke Supabase SMTP-afzender of Auth-templates niet.

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
| Korte uitnodiging | Danny Goldenbelt, Michael de Groot en Speler andere club: UI-aanmaak, heropenen, kopiëren van eigen `/w/`-link, invoer met kleine letters, dezelfde lobby via korte link, ongeldige/verlopen/gerichte uitnodiging | Nieuwe release actief; openen en deelnemen met echte stagingaccounts nog open |
| Camera wisselen | Michael de Groot en Raymond van Dijk in twee browsercontexten: echte WebRTC-verbinding, ontvangen rode/blauwe/rode frames, audio-RTP en energie lopen door, dezelfde audiotrack en peer, fout- en dempstatus, daarna scoren | Fysieke iOS Safari + Android Chrome met twee toestellen nog open |
| Eigen beurtinvoer | Michael en Raymond bevestigen tijdelijk de namen Noor Dart en Sam Dart; thuis, hybride en lokaal worden via twee browsers gespeeld, met dezelfde reststand op beide toestellen | Nog uit te voeren met echte stagingaccounts |
| Verplichte naam | Lege/witruimtenaam geweigerd via UI en API, placeholderprofiel aangevuld, Google-voorstel expliciet aangepast, beide gekozen namen zichtbaar in lobby en wedstrijd; DB-tests controleren geverifieerde Auth-provisioning en gelijktijdigheid | Echte e-mail- en Google-registratie op staging nog open |

## Uitgevoerde controles op staging

Op **11 november 2026 om 21:21:33 UTC** zijn zes anonieme browsercontroles geslaagd op release `43101809775-1`, met Chromium **156.0.8078.4** op breedtes **390 en 540 pixels**. Hierbij zijn geen accounts gebruikt:

| Onderdeel | Werkelijk gecontroleerd op beide breedtes | Grens van het bewijs |
| --- | --- | --- |
| Korte link | `/w/k7m2` opent de aanmeldroute met behoud van de lokale vervolgroute; e-mailinvoer en Google-link zijn zichtbaar, zonder horizontale overloop | Geen code opgezocht of uitnodiging ingewisseld; geen loginformulier verzonden of Google-link gevolgd |
| Openbaar baanscherm | Een willekeurige onbekende baan geeft een duidelijke melding, API-status 404 en geen horizontale overloop; de pagina vraagt geen sessie of mediarechten aan | Geen bestaande baan, echte score of cameraverbinding getest |
| Vaste baan-QR | Een willekeurige onbekende `/baan/<uuid>` bewaart de vervolgroute naar aanmelden; e-mailinvoer en Google-link zijn zichtbaar zonder horizontale overloop | Geen baan gestart of speler toegevoegd |

Aanvullend weigeren de private wedstrijd- en wedstrijduitnodigingsendpoints anonieme toegang met **401**, zonder private velden. Publieke `health` en `ready` gaven vóór en na deze controles **200** met dezelfde volledige bron-SHA, release en configuratie. De controles maakten geen hosted records of geauthenticeerde sessies aan en verstuurden geen mail.

Dezelfde zes anonieme controles zijn op productie om **21:25:12 UTC** geslaagd met dezelfde browser en breedtes, op release `43102459247-1`. De [vastgelegde bewijsgegevens](evidence/spelersflows-deployed-2026-11-11.json) bevatten de uitkomsten per omgeving en de expliciete grenzen van deze controles.

Deze technische activering en anonieme controles laten de geauthenticeerde stagingacceptatie in de tabel hierboven open: een echte uitnodiging openen en gebruiken, thuis-/hybridescores, e-mail- en Google-registratie en camerawisseling met twee fysieke iOS-/Android-toestellen zijn op deze hosted release nog niet bewezen.

Fixturelogins en gesimuleerde camera's bewijzen geen fysieke telefoon- of echte provideracceptatie. Er zijn voor deze wijziging geen echte OTP-codes aangevraagd of providercredentials aangepast.

De eerste echte CI-run voor deze spelersflows (`43098736073`, bron `7e730cf39d6877da7f13be2acfd93c45ef835916`) voerde alle controles uit. Alle nieuwe flows slaagden; een bestaande browserproef voor toernooigoedkeuring faalde bij check-in. De vervolgens gereproduceerde race tussen entiteitsrevisie en deelnemersstatus is hersteld door beide in dezelfde SQL-momentopname te lezen. Een gerichte regressie houdt een echte gelijktijdige goedkeuring tegen de leesgrens; verouderde schrijfverzoeken blijven geweigerd. De browserproef controleert nu ook de werkelijke HTTP-uitkomst van check-in.

## Releasevolgorde

1. Annuleer oude workflows via de normale en, waar nodig, geforceerde annulerings-API. Leg de werkelijke respons vast. Een GitHub-409 betekent dat annuleren niet is gelukt.
2. Commit de geteste bron, push naar `main` en eis een geslaagde native `push`-CI met job **Verify** voor exact die volledige SHA. Lokale tests vervangen deze controle niet.
3. Maak vóór hosted datamigraties een verse gecontroleerde backup van de betreffende omgeving. De runtime-export bevat alleen leesbare private applicatietabellen; Supabase Auth en providerinstellingen vallen buiten die export.
4. Staging had v15 en `club_boards` al; voor de nieuwe stagingrelease zijn daarna de drie nieuwe, beoordeelde migraties in volgorde toegepast:
   - `20261111203744_per_player_remote_scoring.sql`
   - `20261111203820_short_invitation_codes.sql`
   - `20261111204007_required_scoreboard_names.sql`
5. Deploy staging via `deploy-staging.yml` met dezelfde geslaagde SHA en configuratie `staging-2026-11-11-v15-mail-1`. Controleer publieke en loopback `health`/`ready`, release-SHA, release-ID en configuratie. Readiness vereist alle bijbehorende featuremarkers. Voer vervolgens de bovenstaande stagingacceptatie uit en noteer accounts, apparaten en resultaten zonder sessies of codes vast te leggen.
6. Productie had vóór deze uitrol alleen het basisschema. Inmiddels zijn daar achtereenvolgens de twee bestaande v15-migraties, de migratie voor verenigingsbanen en dezelfde drie nieuwe migraties toegepast:
   - `20261111130714_v15_platform_expansion.sql`
   - `20261111135047_v15_privilege_replay_guards.sql`
   - `20261111200631_standalone_club_boards.sql`
   - `20261111203744_per_player_remote_scoring.sql`
   - `20261111203820_short_invitation_codes.sql`
   - `20261111204007_required_scoreboard_names.sql`

   Hiervoor is geen blinde volledige schemaherhaling gebruikt. De geslaagde productie-deployment gebruikt exact de op staging actieve en door CI goedgekeurde bron via `deploy-production.yml` met `production-2026-11-11-v15-mail-1`. De publieke en loopbackidentiteit, grenzen en anonieme rooktest zijn na activering opnieuw gecontroleerd. Geauthenticeerde en fysieke acceptatie blijft hierboven afzonderlijk open staan.

Deze vier wijzigingen vereisen geen nieuwe GitHub-secrets of variabelen. Bestaande omgevinggebonden Auth-, database-, media- en mailconfiguratie blijft nodig.

## Eerdere GitHub-annuleringsfout

De eerdere runs `43095319680`, `43096044898` en `43096546716` bleven op queued zonder jobs of checkruns staan. Normaal en geforceerd annuleren retourneerden HTTP 409, ook na het expliciete verzoek om alle workflows te annuleren. De annuleringspogingen hebben deze drie oude runs dus niet opgeruimd. Ze blokkeren de huidige release niet: de nieuwe native CI-run `43101115753` en de stagingdeployment zijn daadwerkelijk geslaagd.

GitHub noemt deze combinatie een mogelijke inconsistente workflowrun/checksuite die normale zelfbediening niet kan opruimen. Zie [de officiële troubleshooting](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows#canceling-workflows). Het door de eigenaar aangeleverde ticket 4979898 voor een vergelijkbare VeyoCast-run is gesloten zonder technisch herstel. Er is namens de gebruiker geen nieuw supportbericht geplaatst. Dit historische annuleringsprobleem is geen reden om de nu geslaagde CI of staging-activering als geblokkeerd te beschrijven.
