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

Staging is daadwerkelijk geactiveerd op v15-bron `38bceb0dfdfed70046d550e7b2f82839564f41cb`; CI, publieke browserproef en gecontroleerde rollback zijn vastgelegd. Productie draait nog de gezonde voorafgaande bron `4634852c17cc7737bec246c0b48310e975a36920`. De uiteindelijke actieve release-ID staat in [het v15-opleverrapport](../voorbeelden/opleverrapport-v15.md); een voorbereide bundel is geen applicatiedeployment.

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

Na vaststelling dat geen eigen relaypoorten actief waren, zijn onder het bestaande gedeelde beheerslot alleen de twee eigen TURN-units herstart om resterende testcontrolesessies en uitgestelde quotastaat te verwijderen. De afscherming is voor beide nieuwe cgroups opnieuw gecontroleerd. De vóór de herstart vastgelegde tellers waren per omgeving vier toegestane en zes geblokkeerde datagrammen. Zie [de afzonderlijke proefopruiming](evidence/v15-turn-probe-cleanup-2026-11-11.json). De [laatste hostcontrole](evidence/v15-post-turn-host-2026-11-11.json) bevestigt publieke en loopback-health/ready 200 met de juiste bron-, release- en configuratie-identiteiten, beide TURN-units en Caddy actief, de helper `root:root 0700` met de verwachte digest, de stagingmailtimer actief met exitstatus 0 en de productietimer uitgeschakeld. Milo behoudt dezelfde bron en PID.

De browser-/mediapilot met twee fysieke apparaten op onafhankelijke netwerken, reconnect en cleanup staat nog open.

De eigenaar is Google Cloud-webclients en Resend SMTP aan het inrichten; afronding is nog niet bevestigd. De ontvangst van de staging-OTP is door de gebruiker bevestigd, maar codeverificatie, een aangemelde sessie en activering van de eigenaarsrol staan nog open. De app onderscheidt beschikbare beheerfunctionaliteit, geconfigureerde providers en werkelijke acceptatie van login/mail. De afronding gebruikt de eigen projectreferenties en callbacks hierboven.
