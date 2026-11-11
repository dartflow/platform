# Read-only releaseonderzoek: DartFlow en Milo

**Historisch onderzoek van 11 november 2026**, Europe/Amsterdam. In een latere geautoriseerde fase zijn de echte repository `dartflow/platform`, integratiebranch `main`, beheer-SSH/sudo en afzonderlijke staging-/productieprojecten beschikbaar gekomen. De oude ontbrekende-identiteitconclusies hieronder horen bij de eerste momentopname; actuele configuratie staat in `docs/deployment.md` en beide `ops/release-policy*.json`-bestanden. Het oorspronkelijke onderzoek gebruikte GitHub-GET-verzoeken en lokale leesacties, plus de vooraf beoordeelde veilige inspectiedispatch [42943887248](https://github.com/milobingo/platform/actions/runs/42943887248). Die inspectie activeerde geen release of hostconfiguratie. Dit document bevat geen credentialwaarden.

## DartFlow: doelrepository nog niet vastgesteld

| Controle | Waarneming |
|---|---|
| Lokale checkout | `/home/codex/repos/dartflow` |
| Lokale branch bij onderzoek | `codex/staging` |
| Lokale HEAD bij onderzoek | `7d5bffc7a333b30795348cc3ab007fa5db716fb4` |
| GitHub-remote | `git remote -v` geeft geen remote |
| Geïnstalleerde GitHub-connector | `list_repositories` en geïnstalleerde-repositoryzoekactie leveren geen DartFlow-repository |
| Aanvullende geautoriseerde GitHub CLI | Volledig gepagineerde `GET /user/repos`: geen repository met DartFlow in de naam of beschrijving |
| Publieke naamzoekactie | Elf naamresultaten, zonder aangetoonde projectrelatie; geen ervan gekozen |
| Plausibele naamverwarring gecontroleerd | [dartspoint/platform](https://github.com/dartspoint/platform) beschrijft expliciet **DartsPoint**, met Colyseus en Docker; codezoekactie voor DartFlow gaf nul resultaten. Dit is geen bewijs van DartFlow-identiteit en de repository is niet als doel gekozen |
| Integratiebranch / branchbeleid | **Open**. De lokale featurebranch bewijst geen GitHub-integratieafspraak. `main` kan pas als projectbranch worden vastgelegd na vaststelling van de echte repository |
| Vereiste DartFlow CI-bron | Lokaal `.github/workflows/ci.yml`, workflownaam `CI`, job-ID `verify`, zichtbare jobnaam **`Verify`**. Dit is lokale configuratie; geen reeds ingestelde GitHub branch-protectionregel |

De ontbrekende invoer is de **exacte GitHub-URL van de DartFlow-doelrepository**, of expliciete toestemming om een concreet benoemde nieuwe repository te maken. Er is niet stilzwijgend een repository gemaakt of een eigenaar geraden. Een ontbrekende naam in deze inventaris bewijst niet dat een nog niet toegankelijke private repository niet bestaat.

De lokale toolchain is Node **24.18.0**, vastgelegd in `.nvmrc` en `.node-version`; `package.json` accepteert Node `>=24.18.0 <25`. npm **11.16.0** is nu expliciet gepind in `.npm-version`, `packageManager` en `engines`. De buildopdracht is `next build --webpack && node scripts/prepare-standalone.mjs`. Dit project gebruikt `npm ci` en `package-lock.json`; neem Milo's pnpm-contract niet over.

## Gecontroleerde concrete Milo-referentie

De gebruikersreferentie **[milobingo/platform](https://github.com/milobingo/platform)** is onafhankelijk bevestigd door de lokale `origin` en een geauthenticeerde GitHub-GET. De lokale checkout is schoon en HEAD komt overeen met de live `main`-ref:

`67e1039a270488601c5e010da4eb25b1c7619812`.

Deze HEAD is een documentatiecommit met `[skip ci]`. De laatst waargenomen geslaagde CI en stagingdeploy horen bij bron **`729d962b7401b100ce9cacb94ce4e4da16a699f2`**: [CI 42802522209](https://github.com/milobingo/platform/actions/runs/42802522209) en [Deploy 42804436092](https://github.com/milobingo/platform/actions/runs/42804436092). Een latere branch-HEAD is daardoor geen bewijs dat die commit is gebouwd of actief is.

| Bron | Concrete verwijzing |
|---|---|
| Deploymentworkflow | [deploy-staging.yml op vastgelegde HEAD](https://github.com/milobingo/platform/blob/67e1039a270488601c5e010da4eb25b1c7619812/.github/workflows/deploy-staging.yml) |
| CI-workflow | [ci.yml op vastgelegde HEAD](https://github.com/milobingo/platform/blob/67e1039a270488601c5e010da4eb25b1c7619812/.github/workflows/ci.yml) |
| Werkelijke CI-/host-/runtimegate | [release-preflight.mjs](https://github.com/milobingo/platform/blob/67e1039a270488601c5e010da4eb25b1c7619812/scripts/deploy/release-preflight.mjs) |
| Native-wrappercontract | [STAGING-NATIVE-WRAPPER.md](https://github.com/milobingo/platform/blob/67e1039a270488601c5e010da4eb25b1c7619812/docs/STAGING-NATIVE-WRAPPER.md) |
| Historische hostinrichting en bewijs | [STAGING-HOST.md](https://github.com/milobingo/platform/blob/67e1039a270488601c5e010da4eb25b1c7619812/docs/STAGING-HOST.md) |
| Gewone release-/rollbackprocedure | [STAGING-DEPLOY.md](https://github.com/milobingo/platform/blob/67e1039a270488601c5e010da4eb25b1c7619812/docs/STAGING-DEPLOY.md) |
| Begrensde native implementatie | [deploy-entry.py](https://github.com/milobingo/platform/blob/67e1039a270488601c5e010da4eb25b1c7619812/infra/staging/deploy-entry.py), [deploy-helper.py](https://github.com/milobingo/platform/blob/67e1039a270488601c5e010da4eb25b1c7619812/infra/staging/deploy-helper.py) |

De workflowblob is via de live contents-API vergeleken met de lokale Git-blob: beide **`7d1443c5ef2f634dc6d0ca7aa807699a093d94b2`**. De getoonde bron is daardoor niet alleen een ongecontroleerde lokale kopie.

### GitHub-beleid en bevoegdheden

De GitHub App-connector heeft Milo niet in zijn geïnstalleerde accounts; metadata en contents retourneren daar `404`. De beschikbare lokale `gh`-verbinding werkt wel voor deze repository. De ingelogde account is `TIXOCEO`, met scopes `repo`, `workflow`, `read:org` en `gist`; de repositorymetadata geeft admin/maintain/push/pull/triage. Het onderzoek gebruikte leesverzoeken; alleen de vooraf beoordeelde bestaande readonly-inspectieworkflow is aanvullend gedispatcht. Er is geen deploy gestart of GitHub-configuratie gewijzigd.

Live metadata voor Milo meldt:

- Standaardbranch `main`; `GET /branches/main` geeft **`protected: false`**.
- De branch-protection- en ruleset-endpoints geven **403**, met de melding dat GitHub Pro of een publieke repository nodig is. Er is dus geen opgehaald branch-protectioncontract dat naar DartFlow kan worden gekopieerd.
- Environment `staging` bestaat, met **`protection_rules: []`** en **`deployment_branch_policy: null`**. Reviewers of een environment-branchfilter zijn niet als actief aangetroffen.
- De workflow gebruikt `permissions: contents: read, actions: read`, een handmatige `workflow_dispatch` en concurrencygroep `milobingo-staging` met `cancel-in-progress: false`.

De inhoudelijke releasepoort is bij Milo dus in de workflow en de vaste preflightcode vastgelegd. Het ontbreken van platformbescherming geeft geen toestemming om die softwarematige poort weg te laten.

### Exacte Milo CI-controles

`release-preflight.mjs` legt de vereiste bron vast als repository `milobingo/platform`, branch `main`, workflowpad `.github/workflows/ci.yml` en jobnaam **`verify`** (kleine letter). Dat is anders dan de lokale DartFlow-jobnaam **`Verify`**.

De volgorde is:

1. Alleen `workflow_dispatch` vanuit de eigen `refs/heads/main`; kandidaat en workflowrevisie zijn volledige **40-tekens-SHA's in kleine letters**.
2. `GET /compare/<sha>...main` moet `ahead` of `identical` teruggeven: de gekozen bron zit in de toegestane main-historie.
3. Lees de runs van het vaste eigen `ci.yml`, voor exact dezelfde kandidaat-SHA en branch. Alleen eigen repository/herkomstrepository en events `push` of `workflow_dispatch` tellen.
4. Kies de **nieuwste relevante run**; die moet `completed` en `success` zijn. Een oudere groene run mag een nieuwere mislukte/lopende run niet maskeren.
5. Controleer de jobs van de exacte runpoging: de vereiste job `verify` moet `completed` en `success` zijn. De waargenomen CI-run 42802522209 heeft precies die succesvolle job op dezelfde SHA.
6. Pas daarna bereikt de exacte geaccepteerde SHA de deployjob en checkout. Host-, caller-, workspace-, wrapperhash-, toolchain-, capaciteits- en runtimecontroles volgen vóór activatie.

De oorspronkelijke DartFlow-gate zocht een willekeurige geslaagde run. Die implementatie is op 11 november vervangen door `ops/release-gate.mjs` plus de policywrapper `ops/assert-ci.mjs`: nieuwste verplichte run, exacte SHA/branch/workflow, succesvolle verplichte attemptjobs, hercontrole en begrensde paginatie. De root-owned native broker herhaalt die poort onafhankelijk. Deze validator is alleen-lezen beproefd tegen Milo's bekende groene bron en CI hierboven. De vaste DartFlow-repository/integratiebranch staat nog Open, en `nativeEnabled` blijft `false` tot installatieverificatie.

### Milo-runner en native grens

Live `GET /actions/runners` toont één Milo-runner: ID **21**, naam **`dg-nxttrack-01-nxttrack-staging`**, `online`, op het inspectiemoment `busy: false`. De labels zijn:

`self-hosted`, `Linux`, `X64`, `dg-milobingo-01`, `dg-nxttrack-01`, `milobingo`, `staging`.

De workflow selecteert `[self-hosted, Linux, X64, dg-nxttrack-01, milobingo, staging]` en toetst aanvullend onderstaande vaste waarden. De tabel begon als gecontroleerde bron/historische hostdocumentatie. De aanvullende readonly-inspectie heeft inmiddels runneridentiteit, appaccount/service, listener, entryhash, sudo-policy en bytes/inodes opnieuw op de host gemeten. Zie `docs/host-inventory.md` voor exact de wel en niet opnieuw geobserveerde velden.

| Milo-object | Vaste referentiewaarde |
|---|---|
| Host | `dg-nxttrack-01` |
| Runneraccount | `run-mil-stg`, historisch UID 1001 |
| Afzonderlijk buildaccount | `build-mil-stg`, historisch UID 990 |
| Appaccount | `app-mil-stg`, historisch UID 996 |
| Runnerworkspace | `/home/run-mil-stg/_work/platform/platform` |
| Site/service | `/srv/sites/milobingo-staging`, `milobingo-staging.service` |
| Gereserveerde loopbackpoort | `127.0.0.1:4173` — behouden voor Milo |
| Node / pnpm | `24.18.0` / `11.25.0` |
| Entry/helper | `/usr/local/bin/dg-site-deploy`, `/usr/local/libexec/dg-milobingo-deploy-helper` |
| Caddy-include volgens hostdocumentatie | `/etc/caddy/sites/*.caddy` |
| Deploymentvariables | `DG_CONFIG_VERSION`, `DG_STAGING_PORT`, `DG_DEPLOY_WRAPPER_SHA256` |

Het bestaande vierargumentencontract is uitsluitend:

```text
dg-site-deploy milobingo-staging /home/run-mil-stg/_work/platform/platform <full-sha> <run-id>-<attempt>
```

De Milo-helper is specifiek voor deze site, accounts, paden en service. De runtimeallowlist en backendprojectgrens zijn eveneens Milo-specifiek. Hij mag niet ongewijzigd voor DartFlow worden gebruikt. De entry controleert een gerenderde helperdigest; de bronentry bevat nog `__HELPER_SHA256__`. Een bronbestandhash is daarom geen bewijs van de geïnstalleerde entryhash.

De lokale helpersource heeft SHA-256 **`ce93bfeffa573616394d1f28dc5dd101bc7e0ce076b7bf25b35a38827ed9aba8`**, gelijk aan het historische installatiebewijs. De historisch gerenderde entryhash is **`aee3e1e2e76f05d99f668ed7c756802da82033c4983216b90d7ea50de9f49bc7`**. Beide moeten bij echte hostinventarisatie opnieuw op het geïnstalleerde bestand worden gecontroleerd.

### Gedeelde lock en rollback: herbruikbare grenzen

De helpersource opent `/run/lock/dg-build.lock` met no-follow, controleert root-eigendom, bestandstype, linkaantal en groepsrechten en neemt **`LOCK_EX | LOCK_NB`**. Dit is een directe weigering bij bezetting; er is geen wachtrij. Het huidige Milo-script vangt alle fouten generiek af met exitcode **1**. Die exitcode onderscheidt lockbezetting niet van activatiefalen. Gebruik hem daarom niet als automatische retry-indicatie. DartFlow moet een eigen eenduidige lockconflictstatus krijgen; alleen daarop zijn begrensde wacht-/retry-pogingen veilig.

De native bron laat Git-archivering als runner uitvoeren en uitpakken/installeren/bouwen als het aparte buildaccount in begrensde systemd-units. De roothelper verzegelt alleen gecontroleerde standalone-output. Runtimewaarden reizen via begrensde JSON op stdin, komen buiten de appboom in releasegebonden root-only envbestanden en bereiken de build niet.

Een release koppelt app en configuratie via één atomische `current`-verwijzing. De Milo-healthcontrole verwacht SHA, run-ID en configuratie-ID. Bij activatiefalen herstelt de helper een vooraf gezond bevonden vorige app/configuratiecombinatie; bij falen zonder gezonde voorganger stopt de service en verdwijnt `current`. Een approllback zet de database niet terug. Deze procedure is een concrete ontwerpreferentie; de nieuwe DartFlow-implementatie en de echte doelhost moeten hun eigen bewijs leveren.

## Overige DG-bron

`/home/codex/repos/dg-ops-control` heeft remote `https://github.com/dg-ops-control/platform.git`. Zijn `AGENTS.md`, operationele docs en fixture-inventory zijn alleen gelezen. Daar is geen geverifieerde DartFlow-siteregistratie of Milo-native-deploybron aangetroffen. De concrete Milo-checkout hierboven levert de relevante implementatiereferentie; de DG Ops-fixtures zijn geen hostinventory.
