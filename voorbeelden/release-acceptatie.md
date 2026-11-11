# Dartflow: uitrolacceptatie staging en productie

Gecontroleerd op **11 november 2026**. Beide omgevingen zijn op **dg-nxttrack-01** ingericht en via de eigen GitHub-workflows uit dezelfde geteste broncommit gebouwd en geactiveerd. De eerste lokale rapportage is ongewijzigd bewaard in [het historische verslag](release-acceptatie-lokaal-2026-11-11.md).

## Actieve releases

| Onderdeel | Staging | Productie |
|---|---|---|
| Origin | https://staging.dartflow.nl | https://dartflow.nl |
| Volledige bron-SHA | `4634852c17cc7737bec246c0b48310e975a36920` | `4634852c17cc7737bec246c0b48310e975a36920` |
| Release-ID | `42995422162-1` | `42995766522-1` |
| Configuratie-ID | `staging-2026-11-11-v1` | `production-2026-11-11-v1` |
| Deployworkflow | [42995422162](https://github.com/dartflow/platform/actions/runs/42995422162), success | [42995766522](https://github.com/dartflow/platform/actions/runs/42995766522), success |
| Site / service | `/srv/sites/dartflow-staging`, `dartflow-staging.service` | `/srv/sites/dartflow-production`, `dartflow-production.service` |
| Runner / build / app | `run-dart-stg` / `build-dart-stg` / `app-dart-stg` | `run-dart-prd` / `build-dart-prd` / `app-dart-prd` |
| Loopbackpoort | `127.0.0.1:4174` | `127.0.0.1:4175` |
| Supabase-project | `dsnqnvbckkqpzadblshu` | `wlrnowuownakqqgjxnbb` |
| Health / readiness | HTTP 200 / 200 | HTTP 200 / 200 |

De integratiebranch is `main` van [dartflow/platform](https://github.com/dartflow/platform). De oorspronkelijke repositorycommit is via een normale merge behouden; er is geen force-push uitgevoerd. Beide releases verwijzen naar [geslaagde exacte-SHA CI 42994763094](https://github.com/dartflow/platform/actions/runs/42994763094). Productie heeft daarnaast de actieve staging-SHA via HTTPS-health en readiness gecontroleerd, hosted én onafhankelijk in de rootbroker. Beide builds zijn afzonderlijk op de doel-VPS uitgevoerd; er is geen devbuild of CI-artifact gekopieerd.

## Werkelijk uitgevoerde controles

| Controle | Resultaat en grens |
|---|---|
| CI | Typecheck/lint, 45 TypeScript-tests, 56 native tests, 8 runnerinstaller-tests, 6 cleanup-contracttests, productiebuild, 2 browsertests en standalone-packaging geslaagd. De eerste CI-run vond een umask-afhankelijke testfixture; de rechten zijn expliciet gemaakt en de nieuwe commit is volledig opnieuw getest |
| Dedicated runners | Twee eigen online registraties met vaste namen, labels en aparte services. Officiële runner 2.338.2, gecontroleerde SHA256; geen appcheckout op de runners |
| Accounts en bestanden | Zes verschillende UID/GID-combinaties, eigen groepen, beperkte digestgebonden sudo-regels, root-only configuratiebundels; geen ongewenste lees-/schrijfrechten in de negatieve proeven |
| Locklifetime op echte systemd | Beide omgevingen: echte OFD-overdracht, helper- en client-SIGKILL, vertraagde systemd-run- en systemctl-clients, geen lockdescriptors in builder/app-proefprocessen. Globale en eigen lock afzonderlijk bezet tot cleanup |
| Geblokkeerde cleanup | Echte tijdelijke build bleef in stop; guardian hield beide locks vast en meldde rootherstel vereist. Alleen die synthetische cgroup is gericht beëindigd; guardian en locks kwamen daarna gecontroleerd vrij |
| Caddy-adminpoort | Eigen nftables-tabel weigert zes Dartflow-UID's op loopback:2019; root en drie Milo-accounts behouden hun bestaande toegang. Persistente guard en vier Requires/After-afhankelijkheden geladen. Geen algemene firewall- of Caddy-adminwijziging |
| Databases | Beide private schema's hebben 18 tabellen met RLS, schema-versie 1, eigen dartflow_app-login zonder verhoogde rolflags of lidmaatschappen. Alle objecten blijven van postgres; browserrollen hebben geen toegang. Alleen de bedoelde id-kolomupdates voor rijlocks zijn toegestaan op events/boards. Beide security-advisors zonder bevindingen |
| TLS en runtime | Beide beperkte databasegebruikers loggen daadwerkelijk vanaf de VPS in met verify-full. Node gebruikt een gepinde publieke Supabase-CA-bundel; runtimewachtwoorden hebben de VPS niet verlaten |
| Actieve app/config | Beide loopback- en HTTPS-health/readiness tonen exact SHA, release-ID en bijbehorende build-/runtimeconfig-ID. Services actief en voor opstarten ingeschakeld |
| Pakketten en geheimen | Beide artifactdigests opnieuw vanaf de verzegelde bestanden berekend en gelijk aan de rootmetadata; 2.575 entries per omgeving. Nul matches voor eigen runtime-URL of wachtwoord in de applicatiebestanden; geen private bronmappen |
| Publieke browser | Staging normaal HTTPS; productie gecontroleerd op het juiste serveradres wegens oude DNS-cache. Desktop en mobiel zonder overflow, console-/hydrationfouten; SVG werkt, lokale login uit en anonieme overview 401 |
| www | Geldige HTTPS en 301 naar dezelfde canonical path op https://dartflow.nl |
| Milo | PID 52104, current-release, beheerbestanden en healthidentiteit ongewijzigd: SHA 729d962b7401b100ce9cacb94ce4e4da16a699f2, release 42804436092-1, config staging-2026-11-05-v1. Geen Milo-service herstart of aangepast |

Bewijs: [CI](../docs/evidence/ci-live-2026-11-11.json), [stagingdeploy](../docs/evidence/deployment-staging-live-2026-11-11.json), [productiedeploy](../docs/evidence/deployment-production-live-2026-11-11.json), [actieve releases en artifactcontrole](../docs/evidence/releases-final-live-2026-11-11.json), [DB-rechten](../docs/evidence/database-privileges-live-2026-11-11.json), [stagingbrowser](../docs/evidence/public-browser-staging-2026-11-11.json), [productiebrowser](../docs/evidence/public-browser-production-2026-11-11.json). Overige host-/lock-/guardmetingen staan met dezelfde datum onder `docs/evidence/`.

## GitHub-configuratie en beheer

Er zijn **geen extra GitHub-secrets nodig**. Het standaard kortlevende GITHUB_TOKEN heeft uitsluitend contents:read en actions:read. Elk GitHub-environment heeft vier publieke variabelen: DARTFLOW_APP_ORIGIN, DARTFLOW_DATA_MODE, NEXT_PUBLIC_SUPABASE_URL en NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. De eigen waarden staan in [deployment.md](../docs/deployment.md); echte publishable keys worden niet in dit rapport gekopieerd. Databasecredentials staan alleen in de root-only, onveranderbare hostbundels. De waargenomen GitHub-environments hebben geen reviewers of deployment-branchpolicy; vaste repository-/main-/CI-controles worden wel in workflow én rootbroker afgedwongen.

Het algemene account **codex-dg-admin** is met nieuwe SSH-verbinding en wachtwoordloze root-sudo getest. De eigen sleutel vervalt exact **11 november 2027 09:28:54 UTC / 10:28:54 Europe/Amsterdam**; uitsluitend bronworker 100.79.0.26 is toegelaten. Private sleutel en SSH-configuratie staan buiten Git. Zie [SSH-beheer](../docs/ssh-management.md).

## Open en begrensd

- Beide Supabase-projecten waren leeg. Er zijn geen productie- of pilotgebruikers, clubgegevens of synthetische wedstrijden toegevoegd. Echte OTP-/Google-login en de volledige pilot met toegelaten personen zijn nog niet geaccepteerd; de Google-provider is in beide projecten uitgeschakeld. Auth-readiness bewijst bereikbaarheid, geen geslaagde gebruikerslogin.
- De autoritatieve DNS-resolvers tonen de nieuwe A-records en geen oude AAAA. Deze worker had nog een gecachete AAAA naar 2a07:7800::138 en ontving daar de oude HTML-site. De productiebrowsercontrole gebruikte daarom expliciet 128.140.93.95 met normale certificaat-/hostnaamcontrole; de VPS controleerde de publieke origin via haar normale resolver. Andere caches kunnen de oude website tijdelijk blijven tonen.
- De rollbackworkflows en foutpaden zijn voorbereid en getest; een echte rollback van een eerdere applicatierelease/configuratie is bij deze eerste uitrol niet uitgevoerd. Databasebackup/restore en RPO/RTO zijn geen onderdeel van de gewone deploy en zijn niet beproefd.
- Beide appservices, runners en de admin-guard zijn ingeschakeld en hun afhankelijkheden zijn geladen. Een echte reboot van de gedeelde VPS en fysieke mobiele toestellen zijn niet getest.
