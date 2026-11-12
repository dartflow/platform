# v17-productie-uitrol — 12 november 2026

De eigenaar heeft na de stagingoplevering expliciet bevestigd: **“Alles werkt, uitrol kan verder.”** De productiepromotie is vervolgens uitgevoerd via de bestaande DG-releaseflow. De eerder uitgestelde fysieke apparaattests blijven uitgesteld.

## Actieve release

| Gegeven | Waarde |
| --- | --- |
| Productie | `https://dartflow.nl` |
| Bron-SHA | `c93903fbc3d0f822a52130f6a4331acb8b475fb9` |
| Release | `43213072727-1` |
| Activatie | 12 november 2026, 12:56 CET |
| Configuratie | `production-2026-11-11-v15-mail-1` |
| App | `/srv/sites/dartflow-production/current` → `releases/c93903fbc3d0-43213072727-1` |
| Configuratiepad | `/etc/dg-sites/dartflow-production/configs/production-2026-11-11-v15-mail-1/` |
| Supabase | Eigen productieproject `wlrnowuownakqqgjxnbb` |

[CI op de kandidaat-SHA](https://github.com/dartflow/platform/actions/runs/43136969056) en [productiedeployment](https://github.com/dartflow/platform/actions/runs/43213072727) zijn geslaagd. Het workflowbestand kwam uit documentatiecommit `efb638c8537ab275695d9afcd2d4e85f8274bdbe`; de expliciete kandidaat, de onafhankelijke brokercontrole, de gebouwde app en de actieve HTTPS-/loopback-identiteit verwijzen alle naar `c93903f…`. Er is voor productie geen nieuwe appcode geschreven.

Dezelfde SHA heeft **206 app-/databasetests en 24 browserproeven**, plus 46 bestaande prototypetests, 57 native-deployertests en 45 host-/Auth-contracttests doorlopen. De productiegate heeft de geslaagde CI én de actuele gezonde stagingrelease opnieuw gecontroleerd. De doel-VPS heeft met de eigen productieconfiguratie gebouwd.

## Back-up en migraties

Vóór de migraties is een consistente snapshot gemaakt van de 45 voor de runtime leesbare applicatietabellen, met de beschermde actieve configuratie. Back-up: `/var/backups/dartflow/v17-oche-live-production-20261112T115234509275Z`. De map is root-only `0700`, de bestanden `0600`. Alle vijf bestandshashes en het volledige databasearchief zijn onafhankelijk gecontroleerd. Dit is geen uitgevoerde restore; Supabase Auth en externe providerinstellingen vallen buiten deze applicatieback-up.

Op productie ontbrak behalve v17 ook de eerdere schermtoegangsmigratie. Deze vier gereviewde bestanden zijn afzonderlijk toegepast, zonder developmentseed of overname van staginggegevens:

| Migratiebestand | Hosted registratie |
| --- | --- |
| `20261111221655_board_screen_devices.sql` | `20261112115307` |
| `20261112010739_v17_club_roles_intake_lifecycle.sql` | `20261112115311` |
| `20261112010800_v17_community_score_events.sql` | `20261112115315` |
| `20261112010818_physical_locations_reservations.sql` | `20261112115319` |

De private database bevat nu 64 tabellen met RLS en zonder tabelgrants aan publieke API-rollen. De runtime heeft geen superuser-, database-/rolaanmaak- of RLS-bypassrechten. Alle vereiste featuremarkers en beide uitgestelde eigenaarconstraints zijn aanwezig. Het bestaande profiel is qua aantal en inhoudshash ongewijzigd; er waren en zijn nul wedstrijden en worpen. Er zijn geen nieuwe security-advisors bijgekomen. De bestaande meldingen over [owner_bootstrap zonder publiek beleid](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) en [wachtwoordlekcontrole](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) zijn ongewijzigd.

## Productiecontrole en mail

Publieke en loopback `/api/health` en `/api/ready` geven HTTP 200 met dezelfde bron-, release- en configuratie-ID. Database en Auth zijn bereikbaar. De productie-mailtimer is actief. Staging behoudt zijn bestaande proces, release en configuratie; Milo en de gedeelde buildlock `29:6` zijn eveneens ongewijzigd.

De read-only browsercontrole is groen op 390 en 540 pixels: twee onafhankelijke manifestidentiteiten en zes controles voor het ongekoppelde Scorebord-startscherm, de echte spelersloginpagina en de requestgrenzen. Productie had geen bestaande banen. Daarom is geen productieproef met vaste QR, koppeling, live wedstrijd of netwerkherstel uitgevoerd en zijn daarvoor geen fictieve records aangemaakt. De functionele dekking staat in [het staging- en CI-verslag](v17-uitrol.md). Er is tijdens deze uitrol geen nieuwe workerlogin, providerverzoek of proefmail verstuurd.

De eigenaar heeft inmiddels in beide omgevingen de afzonderlijke Resend HTTP API-sleutel en webhookcredential opgeslagen. De gecontroleerde appmetadata toont:

| Omgeving | Mailmodus | Verzendproef | Webhook |
| --- | --- | --- | --- |
| Staging | Test | Eén test op Delivered | Geverifieerd |
| Productie | Live | Eén test door Resend geaccepteerd | Opgeslagen; nog geen geverifieerd event geregistreerd |

De productie-afzender blijft `noreply@dartflow.nl`. Supabase Auth SMTP is een afzonderlijke verbinding. De opgeslagen secrets zijn niet uitgelezen, verplaatst of in Git opgenomen. Voor deze promotie waren geen nieuwe GitHub-secrets, variabelen of hostconfiguratiebundels nodig. De eigenaaracceptatie is vastgelegd; een nieuwe OTP-/Google-login door deze worker en fysieke installatie-/cameraproeven worden niet als uitgevoerd geclaimd. Het ontbreken van een Google-beheerbewijsrij is op zichzelf geen bewijs van een defecte providerlogin.

## Herstelgrens

De voorgaande productie-app blijft beschikbaar als `aa7ac5e49de1-43102459247-1`, met bron `aa7ac5e49de184fa4eb5ec1a83318c44e1b5d0d6` en zijn oorspronkelijke configuratie. Het bestaande native rollbackcontract is getest; tijdens deze uitrol is geen operationele rollback of databaseherstel uitgevoerd.

Een procesrollback laat het nieuwe schema en de gegevens staan. De oude app kan daarop starten, maar kent de v17-clublevenscyclus en aangepaste rechten niet; zijn eigenaarsoverdracht botst bovendien op de nieuwe unieke eigenaarconstraint. Na daadwerkelijk gebruik van nieuwe v17-clubgegevens is die oude app daarom geen gegarandeerd functioneel of autorisatorisch herstel. Beoordeel dan eerst de actuele rollen en levenscyclus, beperk zo nodig toegang of herstel met een gerichte nieuwe release. Zet geen databaseback-up over nieuwe scores of verzonden mail zonder reconciliatie en een expliciete herstelbeslissing.

Zie [het geanonimiseerde productie-releasebewijs](evidence/v17-production-2026-11-12.json) en [de browsercontrole](evidence/v17-production-public-smoke-2026-11-12.json). Voor bediening blijven [verenigingsbeheer](v17-clubs.md), [locaties/reserveringen](v17-locaties.md) en [installatie van speler en baanschermen](installatie-speler-en-baanschermen.md) van toepassing.
