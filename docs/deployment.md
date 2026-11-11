# DartFlow: staging en productie

De vastgelegde repository is **[dartflow/platform](https://github.com/dartflow/platform)**, integratiebranch **`main`**, doelhost **`dg-nxttrack-01`**. De gebruiker heeft staging én productie geautoriseerd en beheer-SSH/sudo is beschikbaar. Beide omgevingen krijgen afzonderlijke backendprojecten, accounts, runners, services, configuratiebundels en releasepaden. De eerdere inventaris waarin repository en beheerlogin ontbraken is historisch; actuele uitrol-/acceptatieresultaten worden vastgelegd in `voorbeelden/release-acceptatie.md`.

De native hostcontracten zijn op 11 november 2026 geïnstalleerd en geverifieerd; beide policies hebben `nativeEnabled: true`. De daadwerkelijke accounts, rootbestanden, twee online runners, databaseverbindingen, overdracht van lockdescriptors, afgebroken helpers en geblokkeerde cleanup met gericht rootherstel zijn vastgelegd in `docs/evidence/*-2026-11-11.json`. Dit installatiebewijs staat los van de CI- en applicatierelease: ook de ingeschakelde broncommit moet eerst groene CI krijgen en door de beide deployworkflows lopen.

## Vaste omgevingsgrenzen

| Onderdeel | Staging | Productie |
|---|---|---|
| GitHub-environment | `staging` | `production` |
| Canonieke origin | `https://staging.dartflow.nl` | `https://dartflow.nl` |
| Supabase-projectref | `dsnqnvbckkqpzadblshu` | `wlrnowuownakqqgjxnbb` |
| Repositorypolicy | `ops/release-policy.json` | `ops/release-policy.production.json` |
| Deploy-/rollbackworkflow | `deploy-staging.yml` / `rollback-staging.yml` | `deploy-production.yml` / `rollback-production.yml` |
| Runnernaam | `dg-nxttrack-01-dartflow-staging` | `dg-nxttrack-01-dartflow-production` |
| Accountlabels | `dg-nxttrack-01,dartflow,staging` | `dg-nxttrack-01,dartflow,production` |
| Runner/build/app | `run-dart-stg` / `build-dart-stg` / `app-dart-stg` | `run-dart-prd` / `build-dart-prd` / `app-dart-prd` |
| Sitepad / service | `/srv/sites/dartflow-staging`, `dartflow-staging.service` | `/srv/sites/dartflow-production`, `dartflow-production.service` |
| Aparte deployingang | `/usr/local/bin/dg-dartflow-deploy` | `/usr/local/bin/dg-dartflow-production-deploy` |
| Loopbackpoort van het nieuwe contract | `4174` | `4175` |

De poorten zijn nieuwe installatiekeuzes; controleer en registreer ze op de werkelijke host vóór installatie. Milo blijft op `127.0.0.1:4173`, met zijn eigen configuratie en deployingang. De GitHub-jobs selecteren ook de standaardlabels `self-hosted,Linux,X64`. Werkelijke UID/GID's, runnerregistratie, bestanden/hashes en installatiebewijs horen in de ingevulde hostprofielen en het acceptatierapport.

## Exacte GitHub-configuratie

De native route vereist **geen zelf aan te maken GitHub-secrets**. Zij gebruikt het standaard kortlevende `GITHUB_TOKEN`, met alleen `contents: read` en `actions: read`; geen PAT of SSH-key. Dit token gaat alleen via stdin naar de vaste broker en bereikt geen repository-/buildcode of appconfiguratie.

De twee GitHub-environments bevatten elk deze vier publieke variables. Hun werkelijke waarden zijn omgevingsspecifiek; de publishable keys worden niet in dit document gekopieerd.

| Naam | Staging | Productie |
|---|---|---|
| `DARTFLOW_APP_ORIGIN` | `https://staging.dartflow.nl` | `https://dartflow.nl` |
| `DARTFLOW_DATA_MODE` | `supabase` | `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://dsnqnvbckkqpzadblshu.supabase.co` | `https://wlrnowuownakqqgjxnbb.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Eigen staging `sb_publishable_...` | Eigen productie `sb_publishable_...` |

De optionele hosted `Staging candidate`-workflow leest de stagingvariables voor een inspectieartifact. De normale native deploy leest zijn publieke waarden uit de beschermde hostbundel; de GitHub-variables vervangen die bundel niet. **`DARTFLOW_DATABASE_URL` blijft uitsluitend op de host**, in de juiste immutable bundel. Google-/SMTP-secrets staan in het bijbehorende Supabase Auth-project, migratiecredentials in het afzonderlijke beheerpad.

Beperk waar het GitHub-plan dit ondersteunt beide environments tot `main`, met passende reviewers en workflow-/branchbescherming. De verplichte check is workflow `CI`, jobnaam **`Verify`**. De exacte GitHub-platforminstellingen moeten als waargenomen feiten in het acceptatiebewijs worden vastgelegd; de softwarematige gates blijven ook zonder beschikbare platformbescherming actief.

## Exacte SHA, CI en promotie

Een push naar `main` test broncode en activeert geen release. De normale keten is: devbron → commit/push → CI voor die volledige SHA → handmatige stagingdeploy → stagingacceptatie → handmatige productiedeploy met **dezelfde SHA**. De doel-VPS bouwt beide omgevingen afzonderlijk met hun eigen publieke configuratie. Er wordt geen devbuild of GitHub-artifact als reguliere release gekopieerd.

De hosted gate leest eerst de vertrouwde workflow/policy. `ops/release-gate.mjs` bevestigt de vaste repository, integratiebranch, volledige lowercase 40-tekens-SHA en afstamming van de waargenomen branch-HEAD. Verplicht is `ci.yml`, event `push`, job **`Verify`**: alleen de nieuwste eigen relevante run op precies dezelfde SHA/branch telt. Workflow en vereiste job van de huidige runpoging moeten `completed/success` zijn. Een oudere groene run maskeert geen nieuwere fout; ontbrekend, lopend, skipped, cancelled of failure weigert de release.

Pas daarna mag de dedicated omgevingsrunner zijn vaste broker aanroepen. Op de self-hosted runner wordt geen applicatiecode uitgecheckt. De root-owned broker controleert dezelfde GitHub-poort opnieuw met zijn eigen beschermde policy en downloadt uitsluitend het bronarchief van de exacte SHA. Hij bevestigt tevens de eigen lopende handmatige deployworkflow en runpoging. De API toont dispatchinputs niet; het runbewijs is dus geen cryptografische koppeling aan het SHA-inputveld. De kandidaat-SHA wordt onafhankelijk exact via CI en branchafstamming gecontroleerd.

De **productiegate** vereist bovendien dat `https://staging.dartflow.nl/api/health` én `/api/ready` dezelfde kandidaat-SHA en consistente release-/config-ID's tonen, met echte Supabase-mode en database/Auth-readiness. Dit gebeurt hosted én opnieuw in de rootgate van de productie-broker. De GitHub-credential wordt niet naar de stagingapp gestuurd. Verschillende SHA, verlopen/ontbrekende identiteit, onbereikbaarheid of onready backend blokkeert promotie. De afzonderlijke functionele stagingpilot blijft vereist acceptatiebewijs.

## Build en immutable configuratie

Node **24.18.0** en npm **11.16.0** zijn gepind in `.nvmrc`, `.node-version`, `.npm-version`, `packageManager`, `engines` en de lockfile. Het aparte buildaccount voert `npm ci --no-audit --no-fund` en `npm run build` uit. De build gebruikt geen database-runtimecredential. Extractie en lifecycle-/buildscripts draaien onder begrensde tijdelijke systemd-units, met lege gecontroleerde omgeving en zonder toegang tot runtimeconfiguratie, runnerhome of appdata.

Elke omgeving heeft root-only bundels onder `/etc/dg-sites/<site>/configs/<config_id>/`, met precies:

```text
public.json   # de vier publieke omgevingswaarden
runtime.env   # uitsluitend DARTFLOW_DATABASE_URL
```

Gebruik de veldvoorbeelden `ops/public-config.example.json` en `ops/runtime.env.example`; echte waarden blijven buiten Git. Bundeldirectory `root:root 0700`, bestanden `root:root 0600`. Een ID bestaat uit 1–96 tekens, alfanumeriek begin, daarna alleen letters/cijfers/punt/underscore/koppelteken. Nieuwe waarden krijgen een nieuw toegelaten ID; een gebruikt ID wordt niet overschreven. Stage- en productieprojecten/configuraties worden niet uitgewisseld.

De URL-gate dwingt de eigen projecthost/session-pooler, accountnaam `dartflow_app` en `sslmode=verify-full` af. Werkelijke rolflags, lidmaatschappen en DDL-/tabelrechten moeten met beheeracceptatie en negatieve proeven worden bewezen. Een accountnaam alleen bewijst geen least privilege. Migraties/backup/restore lopen apart; de broker voert geen automatische schemawijziging of databaseherstel uit.

Het standalone-pakket bevat `server.js`, getraceerde dependencies, `public/`, `.next/static/` en `build-config.json`, dat bron-SHA/config-ID/hash van de publieke buildwaarden vastlegt. De verzegelde release bevat daarnaast een `.runtime.env`-symlink naar de exacte bundel, een gegenereerde `.release.env` met uitsluitend publieke configuratie/SHA/run/config-ID's en root-only `.release.json` met integriteits-/CI-/toolchainbewijs. De appunit leest beide envbestanden via dezelfde atomisch verwisselde `current`-verwijzing. Wijziging van `NEXT_PUBLIC_*` vereist een herbuild.

## Installatie en bevoegdheden

De hoofdtaak installeert de twee afzonderlijk gerenderde vaste brokers uit `infra/staging/`. Het omgevingsargument van de renderer is een beheerhandeling; de runner kan bij de geïnstalleerde broker geen host/site/repository/service/poort/omgeving kiezen. Controleer het gerenderde manifest en de daadwerkelijke root-owned bestanden, hashes, accountidentiteiten, poorten en sudoers vóór `nativeEnabled: true` voor die omgeving wordt gecommit.

`infra/install-runners.py --apply` is uitsluitend een beoordeelde root-bootstrap op `dg-nxttrack-01`, geen CI-stap. De vooraf aangemaakte runneraccounts hebben een eigen private home en uitsluitend hun eigen groep plus `dg-build`. De installer ontvangt één stdin-JSON met `stagingToken` en `productionToken`; tokens worden niet als argument of bestand doorgegeven. De officiële runnerrelease **2.338.2** wordt tegen SHA256 `baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40` gecontroleerd en als runneraccount uitgepakt. Registratie gebruikt `ACTIONS_RUNNER_INPUT_TOKEN`, vaste repository/naam/labels en `--disableupdate`. De eigen root-owned units `dartflow-actions-staging.service` en `dartflow-actions-production.service` starten de runner uitsluitend als het betreffende runneraccount. Bestaande overeenkomende registratie wordt hergebruikt; andere of onvolledige toestand wordt geweigerd, zonder automatische verwijdering of vervanging. De installer voert geen `svc.sh` als root uit. De [officiële runnercode voor tokeninvoer](https://github.com/actions/runner/blob/v2.338.2/src/Runner.Listener/CommandSettings.cs) is de bron voor dit invoercontract. Installerbron en offline tests bewijzen op zichzelf nog geen registratie of actieve service.

De stagingentry blijft `/usr/local/bin/dg-dartflow-deploy`; productie krijgt `/usr/local/bin/dg-dartflow-production-deploy`. Elke entry pint zijn eigen helperhash. De rootpolicy pint rootgate, extractor en guardian. Alle bron-/installatiebestanden en padcomponenten blijven root-owned en niet overschrijfbaar door runner/build/app. Alleen de eigen digest-/argumentgebonden `deploy`- en `rollback`-helperacties zijn via sudo toegestaan; geen algemene shell, `sudo -E`, systemctl-, Caddy- of file-installrechten voor de runners.

De stagingretryadapter wordt geïnstalleerd als `/usr/local/libexec/dartflow-retry-deploy.mjs`; de productiecopy als `/usr/local/libexec/dartflow-production-retry-deploy.mjs`. Die vaste bestandsnamen kiezen uitsluitend hun eigen vaste entry. De native service start rechtstreeks de gepinde Node-binary met `<site>/current/server.js`. Root stelt uitsluitend de eigen Caddy-hostfragmenten in, valideert de volledige configuratie vóór reload en behoudt alle bestaande sites en Milo's route. Log geen Auth-callbacks of schermcapabilities. Verifieer DNS, certificaten en beide HTTPS-origins apart; gebruik geen certificaatbypass.

De bestaande root-owned globale buildlock wordt hergebruikt, niet vervangen. Een gewone release bouwt als eigen buildaccount en krijgt geen appgeheimen. Rechten-/capaciteits-/cgroup-/guardianproeven horen bij de daadwerkelijke hostacceptatie; zie ook `ops/deploy-contract.md` en `infra/staging/GUARDIAN.md`.

De zes Dartflow-UID's worden daarnaast door `dartflow-admin-guard.service` geweigerd op Caddy's beheerpoort 2019 via IPv4- en IPv6-loopback. De guard gebruikt uitsluitend een eigen nftables-tabel; root en Milo blijven buiten de selectie. De twee app- en runnerunits vereisen de geladen guard. Het echte kernelgedrag, de zes geweigerde verbindingen en de behouden toegang voor root/Milo zijn gecontroleerd; een echte reboot van de gedeelde VPS is niet uitgevoerd. Zie `infra/CADDY-ADMIN-GUARD.md` en het afzonderlijke verificatiebewijs.

## Normale release en rollback

Start eerst staging vanaf `main`, met de exacte groene SHA en de bestaande stagingconfiguratie:

```bash
gh workflow run deploy-staging.yml --repo dartflow/platform --ref main -f sha='<volledige-groene-SHA>' -f config_id='<bestaand-staging-config-ID>'
gh run list --repo dartflow/platform --workflow deploy-staging.yml --branch main --event workflow_dispatch --limit 5 --json databaseId,status,conclusion,headSha,url
gh run watch '<bijbehorend-stagingrun-ID>' --repo dartflow/platform --exit-status
```

Accepteer health/readiness en de stagingpilot. Start vervolgens productie met **diezelfde SHA**, en de eigen productieconfiguratie:

```bash
gh workflow run deploy-production.yml --repo dartflow/platform --ref main -f sha='<dezelfde-geaccepteerde-SHA>' -f config_id='<bestaand-productie-config-ID>'
gh run list --repo dartflow/platform --workflow deploy-production.yml --branch main --event workflow_dispatch --limit 5 --json databaseId,status,conclusion,headSha,url
gh run watch '<bijbehorend-productierun-ID>' --repo dartflow/platform --exit-status
```

Een geslaagde dispatch bewijst alleen dat GitHub de aanvraag aannam. `headSha` van de run identificeert de controlworkflow; brokeruitvoer en health bewijzen daarnaast de gekozen applicatie-SHA. Beide endpoints moeten loopback én publiek dezelfde SHA/run/buildconfig/runtimeconfig tonen. Bewaar CI-/deployruns, config-ID's, eigen account/service/poort en gebruikersacceptatie. Controleer Milo vóór en na hostwijzigingen.

Een bekende compatibele verzegelde release wordt hersteld met het bijbehorende omgevingsworkflowbestand:

```bash
gh workflow run rollback-staging.yml --repo dartflow/platform --ref main -f release_id='<bekende-staging-sha12-run-id-attempt>'
gh workflow run rollback-production.yml --repo dartflow/platform --ref main -f release_id='<bekende-productie-sha12-run-id-attempt>'
```

Kies uitsluitend de bedoelde rollback, volg het bijbehorende run-ID met `gh run watch ... --exit-status` en controleer opnieuw health/readiness en de gebruikersflow. De broker herstelt de bekende app én oorspronkelijke nog geldige configbundel. Hij doet geen nieuwe bronbuild of databaserollback. Bewaar de actieve en benodigde vorige gezonde releases/bundels; credentialrotatie of incompatibele migratie vraagt een afzonderlijk herstelplan.

Deploy/rollback delen per omgeving een concurrencygroep (`dartflow-staging-activation` of `dartflow-production-activation`), met `cancel-in-progress: false`. Beide nemen eerst `/run/lock/dg-build.lock`, daarna hun eigen site-activatielock. Alleen exit **75** veroorzaakt maximaal vier pogingen met **15/30/45 seconden** wachttijd. Andere fouten worden niet opnieuw geprobeerd. Wis/vervang geen lock om een blokkade te omzeilen.

De onafhankelijke rootguardian houdt dezelfde lockdescriptors buiten de helper-/runner-cgroup vast. Bij helperdood bevestigt hij cleanup van de vier vaste buildunits en wacht hij pending app-/buildjobs af; onzekere cleanup houdt locks vast voor rootdiagnose. Hij voert geen automatische approllback uit na een harde helperdood. Verifieer dit op de doelhost; lokale proces-/FD-fixtures vervangen de werkelijke systemd-overdracht/SIGKILL-proef niet. Bij eerste activatiefalen zonder gezonde voorganger stopt alleen de eigen appservice en verdwijnt `current`; een bestaande gezonde voorganger wordt met haar configuratie hersteld en opnieuw gecontroleerd.

## Auth en acceptatie

Staging gebruikt callback `https://staging.dartflow.nl/auth/callback`; productie `https://dartflow.nl/auth/callback`, elk in het eigen Supabase Auth-project en met de eigen Site URL. Google gebruikt de door dat project getoonde `/auth/v1/callback`; SMTP/providersecrets blijven in dat project. Test OTP/Google met toegelaten accounts, club-/rolgrenzen, wedstrijdstart, score, herladen, retry en uitslag. Publieke `DARTFLOW_DATA_MODE=local` blijft verboden.

Het acceptatierapport onderscheidt code-/CI-bewijs, daadwerkelijke hostinstallatie, actieve HTTPS-release, echte gebruikersflow en herstelbewijs. Alleen werkelijk uitgevoerde controles krijgen Pass; configuratievoorbereiding of een groen artifact maakt geen omgeving geaccepteerd.
