# Dartflow v15 omgevingen

Gecontroleerde basis op 11 november 2026. Repository: `dartflow/platform`, integratiebranch `main`, doel-VPS `dg-nxttrack-01`. Developmentcheckout: `/home/codex/repos/dartflow`.

| Onderdeel | Staging | Productie |
| --- | --- | --- |
| Origin | `https://staging.dartflow.nl` | `https://dartflow.nl` |
| Supabase-ref | `dsnqnvbckkqpzadblshu` | `wlrnowuownakqqgjxnbb` |
| Verbonden beheeraccount | DartFlow | Duindorpdoet |
| GitHub-environment | `staging` | `production` |
| Runner | `dg-nxttrack-01-dartflow-staging` | `dg-nxttrack-01-dartflow-production` |
| Runner/build/app | `run-dart-stg` / `build-dart-stg` / `app-dart-stg` | `run-dart-prd` / `build-dart-prd` / `app-dart-prd` |
| Service | `dartflow-staging.service` | `dartflow-production.service` |
| Loopback | `127.0.0.1:4174` | `127.0.0.1:4175` |
| Releasepad | `/srv/sites/dartflow-staging/releases` | `/srv/sites/dartflow-production/releases` |
| Broker | `/usr/local/bin/dg-dartflow-deploy` | `/usr/local/bin/dg-dartflow-production-deploy` |
| Voorbereide v15-configuratie-ID | `staging-2026-11-11-v15-1` | `production-2026-11-11-v15-1` |
| Mailworker | `dartflow-mail-staging.timer` | `dartflow-mail-production.timer` |
| Hoogste toegestane mailmodus | `test` | `live` |
| Ontvanger echte proefmail | `info@dgwebservices.nl` | `info@dgwebservices.nl` |
| TURN-poort UDP/TCP | `3478` | `3479` |
| TURN UDP-relaybereik | `49160–49179` | `49180–49199` |
| Google naar Supabase | `https://dsnqnvbckkqpzadblshu.supabase.co/auth/v1/callback` | `https://wlrnowuownakqqgjxnbb.supabase.co/auth/v1/callback` |
| Supabase naar app | `https://staging.dartflow.nl/auth/callback` | `https://dartflow.nl/auth/callback` |

Staging draait v15-bron `be635592950e1c4beb6b4b1bb75b770ce43b202a`, release `43056058034-1`, configuratie `staging-2026-11-11-v15-1`. De [geslaagde actuele uitrol en onafhankelijke controles](evidence/v15-current-staging-deploy-2026-11-11.json) bevestigen dezelfde bron-, release- en configuratie-identiteit met health/ready 200 via loopback en publieke HTTPS. De eerdere publieke browserproef en gecontroleerde rollback/herstel zijn vastgelegd voor de eerste v15-bron `38bceb0dfdfed70046d550e7b2f82839564f41cb`. Productie draait nog de gezonde voorafgaande bron `4634852c17cc7737bec246c0b48310e975a36920`. Zie [het v15-opleverrapport](../voorbeelden/opleverrapport-v15.md); een voorbereide bundel is geen applicatiedeployment of functionele acceptatie.

De [productiebackup en echte herstelproef](evidence/v15-production-backup-2026-11-11.json) behouden kernschema 1, de 18 oorspronkelijke applicatietabellen met RLS en nul profielen, clubs en wedstrijden. Het herstel is in een afzonderlijke lokale testdatabase uitgevoerd; productie is niet gemigreerd of opnieuw geactiveerd. De scope is uitsluitend `dartflow_private` en de voor de runtime zichtbare applicatiegegevens, zonder Supabase Auth, sessies, managed services of externe providerconfiguratie.

Beide projecten bevatten bij de inventarisatie nul Auth-gebruikers, profielen, clubs en wedstrijden. De expansiemigratie houdt het kerncontract en bestaande IDs geldig. Er is geen bestaande bedrijfsdata geïmporteerd of overschreven. Synthetische accounts blijven in development; productie krijgt geldige lege toestanden.

## Configuratie en toegang

De vier bestaande GitHub Variables blijven `DARTFLOW_APP_ORIGIN`, `DARTFLOW_DATA_MODE`, `NEXT_PUBLIC_SUPABASE_URL` en `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Zelf aan te maken GitHub-secrets zijn voor deze native route niet nodig. Beide environments zijn opnieuw via GitHub gecontroleerd: vier variables en geen eigen environmentsecrets; zie [het configuratiebewijs](evidence/v15-github-environments-2026-11-11.json). De doelhost gebruikt de expliciet gecontroleerde immutable bundel; GitHub synchroniseert deze niet automatisch.

De root-only v15-bundels bevatten eigen databaseverbinding, omgeving, integratie-encryptiesleutel, mailworker-token, afzender-/testgrens, mailmodusgrens en TURN-gegevens. De omgevingen delen geen credential. Een `SUPABASE_MANAGEMENT_TOKEN` wordt via het beschermde beheerpad toegevoegd wanneer een token voor precies het juiste project beschikbaar is. Zie `ops/runtime.env.example`, `.env.staging.example` en `.env.production.example`.

SSH en de jaarlijkse geldigheid staan in [ssh-management.md](ssh-management.md). De waargenomen GitHub-environments hebben geen vereiste reviewers of deploymentbranchbeleid. De vaste repository-, branch-, CI- en stagingpromotiecontroles worden in workflow en rootbroker afgedwongen.

## Hosting en provideracceptatie

De uitgevoerde v15-hostupgrade bewaart eerdere brokers en policies onder `/var/backups/dartflow/v15-host-20261111T133129Z` en behoudt oude configuratiebundels. Caddy weigert publieke toegang tot `/api/mail/process`. Na verificatie van de herstelde v15-app is alleen de stagingmailtimer ingeschakeld; de oneshot eindigde met `Result=success`, exitstatus 0. De effectieve mailmodus is Log en er zijn geen providercredentials opgeslagen. De productietimer blijft uitgeschakeld tot de bijbehorende v15-app is geactiveerd. Zie [de eerdere hostcontrole na appherstel](evidence/v15-final-host-2026-11-11.json); de actuele controle na de TURN-proeven staat hieronder.

De eerste publieke UDP- en TCP-proeven bewezen voor beide omgevingen werkelijk verzonden en terugontvangen gegevens, private/own-IP-weigering, omgevingsscheiding, IPv6-weigering en cleanup. Dit [publieke baselinebewijs](evidence/v15-turn-public-2026-11-11.json) beschrijft de configuratie vóór de hieronder geïnstalleerde aanvullende afscherming.

De gebruiker heeft bevestigd dat de externe firewallregels zijn gecontroleerd of toegevoegd; de eerdere routeblokkade is opgelost. Daarnaast is de te brede IPv6-peerdeny gecorrigeerd: deze blokkeerde in de geïnstalleerde coturn ook IPv4-peers. De services staan alleen `AF_INET AF_UNIX` toe en behouden de kernelweigering van IPv6 en de private IPv4-grenzen. Zie [de reparatie en gezonde appcontroles](evidence/v15-turn-peer-fix-2026-11-11.json). De [oorspronkelijke hostproeven](evidence/v15-turn-native-2026-11-11.json) en [routemeting](evidence/v15-turn-route-2026-11-11.json) blijven historische meetstanden.

De aanvullende afscherming voor twee TURN-clients op dezelfde relayhost is geïnstalleerd. Coturn mag het eigen publieke IP als peer accepteren; de kernel staat voor iedere exacte service-cgroup uitsluitend UDP toe als zowel bron- als doelpoort binnen het eigen relaybereik vallen: staging `49160–49179`, productie `49180–49199`. Overig verkeer van die service naar het eigen host-IP wordt verworpen, inclusief andere hostdiensten en het relaybereik van de andere omgeving. De root-only helper ververst de regels atomair vóór iedere start van het TURN-proces en controleert tekst, JSON en het actuele cgroup-ID; een fout blokkeert die start. Een werkelijke stagingherstart met gewijzigd cgroup-ID heeft de nieuwe binding bewezen. Private IPv4-denials, `AF_INET AF_UNIX` en kernel-IPv6-denial blijven behouden. Zie [installatie- en herstartbewijs](evidence/v15-turn-guard-install-2026-11-11.json).

De [publieke gegevensproef met deze afscherming](evidence/v15-turn-guarded-public-2026-11-11.json) is voor beide omgevingen geslaagd: heen- en terugverkeer naar de worker en tussen twee relays op dezelfde host via UDP- én TCP-controleverbindingen. De peerrelay blijft UDP (`no-tcp-relay`). Iedere relay-naar-relayproef registreerde twee toegestane kerneldatagrammen. Zes verboden eigen-IP-doelen per omgeving, inclusief het relaybereik van de andere omgeving, registreerden ieder precies één kernel-DROP. Private peers bleven 403 opleveren, verkeerde omgevingscredentials 401 en IPv6-allocaties via beide transports 440. Normale `Refresh(0)`-verzoeken zijn bevestigd en controlesockets zijn gesloten; quota wordt asynchroon vrijgegeven en onmiddellijke quota-vrijgave is niet door deze proef bewezen. Een 437 na een mislukte IPv6-allocatie bewijst uitsluitend dat er geen allocatie bestaat.

Na vaststelling dat geen eigen relaypoorten actief waren, zijn onder het bestaande gedeelde beheerslot alleen de twee eigen TURN-units herstart om resterende testcontrolesessies en uitgestelde quotastaat te verwijderen. De afscherming is voor beide nieuwe cgroups opnieuw gecontroleerd. De vóór de herstart vastgelegde tellers waren per omgeving vier toegestane en zes geblokkeerde datagrammen. Zie [de afzonderlijke proefopruiming](evidence/v15-turn-probe-cleanup-2026-11-11.json). De [hostcontrole na die proeven](evidence/v15-post-turn-host-2026-11-11.json) bevestigde de toenmalige publieke en loopback-health/ready 200, beide TURN-units en Caddy actief, de helper `root:root 0700` met de verwachte digest, de stagingmailtimer actief met exitstatus 0 en de productietimer uitgeschakeld. De [actuele stagingcontrole](evidence/v15-current-staging-deploy-2026-11-11.json) legt de nieuwe actieve bron vast en bevestigt behoud van de voorafgaande productieapp en Milo's bron, PID en starttijd.

De browser-/mediapilot met twee fysieke apparaten op onafhankelijke netwerken, reconnect en cleanup staat nog open.

De gebruiker meldt Google-login nu als werkend. Na correctie van de Supabase URL-instellingen bevestigt [de effectieve redirectcontrole](evidence/v15-auth-redirect-corrected-2026-11-11.json) voor beide projecten de eigen Site URL en `/auth/callback`. Deze controle gebruikt uitsluitend een synthetisch ongeldig token en bewijst geen aangemelde sessie. De [eerdere redirectproef](evidence/v15-google-redirects-2026-11-11.json) blijft historisch bewijs van aangevraagde doelen, afzonderlijke Google-webclients en projectcallbacks. De [providercontrole](evidence/v15-provider-readiness-2026-11-11.json) bevestigt ingeschakelde providers, zonder SMTP-bezorging te bewijzen.

De [gerichte stagingcontrole](evidence/v15-owner-auth-readiness-2026-11-11.json) vindt voor de aangewezen eigenaar `info@dgwebservices.nl` één geverifieerde Auth-identiteit, maar nul app-profielen en eigenaarrollen. De bootstrap-uitnodiging staat nog open; een echte login met dit adres en controle van eigenaarstoegang zijn nog nodig.

De gebruiker meldt een standaard **Confirm your email address**-mail met alleen een link en geen zichtbare OTP-code. De templates `supabase/templates/confirm-signup.html` en `supabase/templates/magic-link.html` zijn lokaal gereed en nog niet in Supabase toegepast. De codeplaceholder wordt aangepast zonder de acceptatie van 6–10 cijfers te wijzigen; ook deze UI-aanpassing is nog niet uitgerold. OTP-verificatie blijft open.

De stagingmetadata bevat nog geen afzonderlijke Resend-appsleutel of webhookcredential; echte appmailbezorging en een ondertekende bezorgwebhook blijven open. In beide omgevingen ontbreekt het Management-token voor providerbeheer vanuit DartFlow. Dat token is niet vereist voor de bestaande Google-login. De [resterende eigenaarstappen](v15-integraties.md#minimale-resterende-eigenaarstappen) gebruiken de eigen projectreferenties en callbacks hierboven; bestaande Google-credentials hoeven niet opnieuw te worden ingevoerd.
