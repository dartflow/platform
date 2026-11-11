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

De voorafgaande actieve bron is `4634852c17cc7737bec246c0b48310e975a36920`. De uiteindelijke v15-SHA en activering krijgen eigen releasebewijs; een voorbereide bundel of online runner bewijst geen applicatiedeployment.

Beide projecten bevatten bij de inventarisatie nul Auth-gebruikers, profielen, clubs en wedstrijden. De expansiemigratie houdt het kerncontract en bestaande IDs geldig. Er is geen bestaande bedrijfsdata geïmporteerd of overschreven. Synthetische accounts blijven in development; productie krijgt geldige lege toestanden.

## Configuratie en toegang

De vier bestaande GitHub Variables blijven `DARTFLOW_APP_ORIGIN`, `DARTFLOW_DATA_MODE`, `NEXT_PUBLIC_SUPABASE_URL` en `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Zelf aan te maken GitHub-secrets zijn voor deze native route niet nodig. Beide environments zijn opnieuw via GitHub gecontroleerd: vier variables en geen eigen environmentsecrets; zie [het configuratiebewijs](evidence/v15-github-environments-2026-11-11.json). De doelhost gebruikt de expliciet gecontroleerde immutable bundel; GitHub synchroniseert deze niet automatisch.

De root-only v15-bundels bevatten eigen databaseverbinding, omgeving, integratie-encryptiesleutel, mailworker-token, afzender-/testgrens, mailmodusgrens en TURN-gegevens. De omgevingen delen geen credential. Een `SUPABASE_MANAGEMENT_TOKEN` wordt via het beschermde beheerpad toegevoegd wanneer een token voor precies het juiste project beschikbaar is. Zie `ops/runtime.env.example`, `.env.staging.example` en `.env.production.example`.

SSH en de jaarlijkse geldigheid staan in [ssh-management.md](ssh-management.md). De waargenomen GitHub-environments hebben geen vereiste reviewers of deploymentbranchbeleid. De vaste repository-, branch-, CI- en stagingpromotiecontroles worden in workflow en rootbroker afgedwongen.

## Hosting en provideracceptatie

De uitgevoerde v15-hostupgrade bewaart eerdere brokers en policies onder `/var/backups/dartflow/v15-host-20261111T133129Z` en behoudt oude configuratiebundels. Caddy weigert publieke toegang tot `/api/mail/process`. De mailworker wordt pas gestart na verificatie van de bijbehorende v15-app.

De native coturn-installatie en hostproeven staan in [het relaybewijs](evidence/v15-turn-native-2026-11-11.json). De lokale firewall heeft de nieuwe poorten. In de eerste externe proef bereikten pakketten vanaf de worker de publieke VPS-interface niet. Publieke relayacceptatie blijft open totdat de externe netwerkroute is bevestigd.

Google Cloud-webclients en Resend SMTP zijn door de eigenaar als nog niet ingericht gemeld. De app onderscheidt beschikbare beheerfunctionaliteit, geconfigureerde providers en werkelijke acceptatie van login/mail. De afronding gebruikt de eigen projectreferenties en callbacks hierboven.
