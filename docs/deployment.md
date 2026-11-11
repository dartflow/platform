# DartFlow staging: native release en ingebruikname

**Status op 11 november 2026:** de bestaande Next-app heeft een concrete native deploy- en rollbackimplementatie, handmatige GitHub-workflows en lokale controletests. Er is **geen DartFlow-release op de VPS uitgevoerd**. De echte DartFlow-repository/integratiebranch en een eigen stagingbackend ontbreken; de beschikbare SSH-middelen krijgen `Permission denied (publickey)`. DNS verwijst nog naar een andere host. Daarom bevat `ops/release-policy.json` nog `repository: null`, `integrationBranch: null` en `nativeEnabled: false`. De native workflow weigert hierdoor vóór een self-hosted job wordt ingepland.

De doelhost `dg-nxttrack-01` en de bestaande Milo-route zijn actueel gecontroleerd via [Inspect Milo staging 42943887248](https://github.com/milobingo/platform/actions/runs/42943887248). Milo is actief op `127.0.0.1:4173`; publieke health geeft bron `729d962b7401b100ce9cacb94ce4e4da16a699f2`, release `42804436092-1`, configuratie `staging-2026-11-05-v1`. De inspectie veranderde geen release. Zie [hostinventaris](host-inventory.md), [repository-/CI-onderzoek](release-reference.md) en [acceptatierapport](../voorbeelden/release-acceptatie.md) voor bewijs en beperkingen.

## Exacte GitHub-configuratie

**Voor de native deploy zijn geen zelf aan te maken GitHub-secrets of appconfiguratievariabelen nodig.** De workflow gebruikt het standaard, kortlevende `GITHUB_TOKEN` met `contents: read` en `actions: read`. Maak geen PAT, SSH-key of database-secret aan voor deze route. De entry ontvangt alleen dit GitHub-leestoken via stdin; het komt niet in de build-, app- of configuratiebundel terecht.

Maak na vaststelling van de echte doelrepository de GitHub-environment **`staging`**. Leg de geverifieerde repository en integratiebranch vast in `ops/release-policy.json` én in de root-owned hostpolicy. Gebruik `main` wanneer dat met de echte projectafspraak overeenkomt; de lokale branch `codex/staging` bewijst die afspraak niet. Stel waar het GitHub-plan dit ondersteunt deploymentrefs/reviewers en branchbescherming in, met de verplichte `CI`-workflow en job **`Verify`**. De werkelijk aanwezige DartFlow-platforminstellingen zijn nog Open. De softwarematige releasepoort blijft verplicht, ook wanneer platformbescherming niet beschikbaar is.

De optionele hosted workflow **`Staging candidate`** bouwt uitsluitend een inspectieartifact. Alleen als je die workflow wilt gebruiken, plaats je deze **vier Environment variables** onder `staging`:

| Variable | Waarde / bron |
|---|---|
| `DARTFLOW_APP_ORIGIN` | `https://staging.dartflow.nl` |
| `DARTFLOW_DATA_MODE` | `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<eigen-staging-project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | De bijbehorende `sb_publishable_...`-sleutel uit datzelfde DartFlow-project |

Deze vier waarden zijn buildconfiguratie en moeten voor een vergelijkbaar inspectieartifact overeenkomen met de gekozen hostconfiguratieversie. De native workflow haalt ze uitsluitend uit de root-owned hostbundel. **`DARTFLOW_DATABASE_URL` hoort niet in GitHub:** hij staat alleen in het beschermde `runtime.env` van die bundel. SMTP-/Google-secrets horen in Supabase Auth; beheer-/migratiecredentials in het afzonderlijke beheerpad. Milo- of productiecredentials worden niet gebruikt.

Handmatige native workflowinputs:

| Workflow | Vereiste inputs |
|---|---|
| **Deploy DartFlow staging** (`deploy-staging.yml`) | `sha`: volledige lowercase 40-tekens-SHA; `config_id`: bestaande, toegelaten immutable hostconfiguratie |
| **Roll back DartFlow staging** (`rollback-staging.yml`) | `release_id`: bestaande verzegelde releasenaam `<sha12>-<run-id>-<attempt>` |
| **Staging candidate** (`staging.yml`) | `sha` en `config_id`; dit artifact activeert geen release |

Een `config_id` bestaat uit 1–96 tekens: eerste teken alfanumeriek, daarna uitsluitend letters, cijfers, punt, underscore en koppelteken. Het is een niet-geheim versie-ID, geen pad of credential.

## Releaseketen en vereiste CI

De reguliere keten is: ontwikkelen/testen op de dev-VPS → commit naar de vastgelegde GitHub-integratiebranch → groene CI voor exact die commit → expliciete handmatige stagingdeploy met volledige SHA → opnieuw bouwen op de doel-VPS → systemd-activatie → loopback én publieke HTTPS-controle. Een push activeert geen release en een los devartifact wordt niet als reguliere uitrol gebruikt.

De hosted releasepoort leest eerst de vertrouwde workflow/policy vanaf de gekozen integratiebranch. `ops/release-gate.mjs` verifieert repository-identiteit, de exacte commit en afstamming van de vastgelegde branch-HEAD. De policy vereist `.github/workflows/ci.yml`, event **`push`**, jobnaam **`Verify`**. Alleen de nieuwste relevante run op dezelfde SHA/branch/eigen repository telt. Workflow en verplichte job van de exacte runpoging moeten `completed/success` zijn. Ontbrekend, lopend, mislukt, geannuleerd, overgeslagen of later gewijzigd CI-bewijs weigert de release. Een oudere groene run maskeert een nieuwere fout niet.

Daarna controleert de dedicated runner zijn host/account/naam en roept alleen de geïnstalleerde broker aan. Er is **geen checkout van applicatiecode op deze runner**. De root-owned broker herhaalt onafhankelijk dezelfde GitHub-poort met zijn eigen root-owned repository/branch/checkpolicy, haalt het bronarchief van de exacte SHA rechtstreeks op en laat het aparte buildaccount uitpakken en bouwen. Daarnaast controleert de rootgate dat de opgegeven deployrun/-poging in de eigen repository bestaat als lopende handmatige `deploy-staging.yml`-run op de integratiebranch, met toegestane controlbron. De GitHub-API toont de dispatchinputs niet; deze controle bewijst daarom geen cryptografische binding tussen de run en het ingevoerde SHA-veld. De kandidaat-SHA krijgt onafhankelijk haar exacte CI-/afstammingscontrole. Het GitHub-token bereikt het buildaccount niet.

Node **24.18.0** staat in `.nvmrc` en `.node-version`; npm **11.16.0** in `.npm-version`, `packageManager` en `engines`. Native installatie gebruikt `npm ci --no-audit --no-fund` met de gecommitte `package-lock.json`. De buildopdracht is `next build --webpack && node scripts/prepare-standalone.mjs`. Het resultaat bevat `server.js`, getraceerde dependencies, `public/`, `.next/static/` en `build-config.json`. Dat laatste bindt SHA, configuratie-ID en hash van de vier publieke buildwaarden aan de output. Een geïsoleerde lokale locked install en build met synthetische publieke configuratie, zonder database-runtimeomgeving, zijn op 11 november geslaagd; de definitieve bron-/testregistratie wordt in het acceptatierapport aangevuld.

## Nieuwe hostobjecten: voorstel, nog niet geïnstalleerd

De onderstaande DartFlow-namen zijn een **nieuwe voorgestelde inrichting** in de implementatie. Zij zijn nog niet als bestaande accounts, services, labels of directories op de doelhost aangetroffen.

| Object | Nieuwe voorgestelde keuze |
|---|---|
| Host/site | `dg-nxttrack-01` / `dartflow-staging` |
| Runneraccount / runnernaam | `run-dart-stg` / `dg-nxttrack-01-dartflow-staging` |
| Runnerlabels | `self-hosted`, `Linux`, `X64`, `dg-nxttrack-01`, `dartflow`, `staging` |
| Afzonderlijk build-/appaccount | `build-dart-stg` / `app-dart-stg` |
| Site / service | `/srv/sites/dartflow-staging` / `dartflow-staging.service` |
| Buildroot | `/var/lib/dg-build/dartflow-staging` |
| Eigen entry / helper | `/usr/local/bin/dg-dartflow-deploy` / `/usr/local/libexec/dg-dartflow-deploy-helper` |
| Rootpolicy / configuratiebundels | `/etc/dg-sites/dartflow-staging/deploy.json` / `configs/<config_id>/` daaronder |
| Loopbackpoort | **Nog te reserveren.** `4174` had geen listener in de volledige meting van 03:08 CET; dit is geen registratie of reservering. `4173` blijft voor Milo |

Behoud Milo's entry, helper, accounts, runner, configuratie, poort en Caddy-fragment. De gedeelde `/run/lock/dg-build.lock` blijft ongewijzigd. UID/GID's worden na daadwerkelijke accountaanmaak geregistreerd; de implementatie weigert onbekende of overlappende identiteiten.

## Praktische ingebruikname zodra beheer- en projecttoegang beschikbaar zijn

Deze stappen zijn het nog uit te voeren bootstraprunbook. Zij zijn niet op de doelhost uitgevoerd.

1. **Stel projectidentiteit en CI vast.** Verifieer de exacte DartFlow-repository-URL; configureer daarna pas de lokale remote en integratiebranch. Leg de vaste CI-policy vast, push de beoordeelde implementatie en wacht op `CI / Verify` voor die volledige SHA. Gebruik die bron voor de bootstrapreview. Maak geen nieuwe repository zonder een expliciete, concrete keuze. De huidige ontbrekende identiteit mag niet door een gok worden vervangen.
2. **Herhaal de hostbaseline als bevoegd beheerder.** Bevestig hostkey/host-ID, bestaande Milo-service, publieke revision en config-ID; inventariseer accounts, alle sockets, Caddy-imports/versie, Node/npm, geheugen/CPU, vrije bytes/inodes, de bestaande lock en beperkte sudo-policies. Controleer dat de beoogde DartFlow-namen en gekozen poort nog vrij zijn. Maak een herstelbare kopie van uitsluitend de configuratiebestanden die worden aangepast; lees of kopieer geen Milo-appgeheimen naar DartFlow.
3. **Richt de drie gescheiden identiteiten in.** Maak eigen primaire groepen en verschillende niet-root UID/GID's. Het buildaccount heeft uitsluitend zijn eigen groep, geen loginbeheerrechten en geen toegang tot runner-, app- of runtimegeheimen. De app gebruikt een nologin-account. Installeer de runner bijvoorbeeld onder de eigen home van `run-dart-stg`, niet in Milo's installatie; registreer de werkelijke paden. Geef runner/build geen algemene sudo-, shell-, Caddy- of systemctl-bevoegdheid.
4. **Bevestig de toolchain.** Verifieer de root-owned Node 24.18.0-distributie op `/opt/node-v24.18.0-linux-x64/bin/node`. Installeer of hergebruik een afzonderlijk root-owned npm 11.16.0-pad; vul dat exacte pad in de hostpolicy in. Alle padcomponenten en symlinkdoelen mogen niet door runner/build/app of groep/anderen overschrijfbaar zijn. Gebruik Milo's pnpm niet voor DartFlow.
5. **Maak alleen DartFlow-directories aan.** Siteroot en `releases`: `root:app-dart-stg 0750`; `shared`: uitsluitend het appaccount schrijfbaar. Buildroot: `root:build-dart-stg 0710`. Rootpolicy/configroot: `root:root 0700`; beleids- en configuratiefiles `0600`. Verander bestaande bovenliggende DG-/Milo-eigendommen niet. De broker maakt eigen tijdelijke buildmappen en verzegelt release-inhoud root-owned/read-only.
6. **Installeer de beoordeelde native bron.** Gebruik de bestanden en bestemmingen uit de tabel hieronder. Bereken SHA-256 over de werkelijk geïnstalleerde helper, rootgate, extractor en lockbewaker. Render de helperdigest in entry én sudoerstemplate. Het ongerenderde entrybestand weigert uitvoering. Vul `infra/staging/deploy-policy.example.json` volledig in als rootpolicy: exacte repository/branch/checks, backendprojectref, gereserveerde poort, werkelijke UID/GID's, toolchainpaden, `gateSha256`, `extractorSha256`, `guardianSha256`, toegelaten config-ID's en gemeten resourcebudgetten. `null`-voorbeeldwaarden weigeren uitvoering. De lockbewaker vereist daarnaast echte hostacceptatie van de systemd-FD-overdracht en het onderbrekingspad vóór deze native inrichting als geaccepteerd geldt.
7. **Beperk sudo en test de grens.** Valideer het gerenderde sudoersbestand met `visudo -cf` vóór installatie. De enige toegestane verhoogde acties zijn de twee regexgebonden aanroepen van de vaste helper: `deploy <sha> <run-attempt> <config_id>` en `rollback <bekende-release>`, met commandodigest. Test dat verkeerde caller, site-/pad-/argumentinjectie, extra argumenten, ongeldige SHA, rootshell, `sudo -E` en directe systemctl-/Caddy-/installacties worden geweigerd. Voer geen algemene wildcardregel in.
8. **Provision een eigen backend en immutable configuratie.** Volg de volgende sectie. Breng benodigde compatibele schemawijzigingen via het afzonderlijke beheerpad aan, met vooraf beoordeeld herstel-/backupplan. De native broker voert geen migraties, schemareset of databaserestore uit. Test de beperkte appverbinding en Auth-bereikbaarheid vóór de eerste appactivatie.
9. **Installeer unit en eigen Caddy-fragment.** Gebruik `infra/staging/dartflow-staging.service.example`; de unit leest achtereenvolgens `current/.runtime.env` en `current/.release.env` en start rechtstreeks `current/server.js`. Beoordeel de resourcegrenzen op de werkelijke host. Plaats uitsluitend het DartFlow-fragment uit `ops/caddy/staging.Caddyfile.example` in de bevestigde bestaande importstructuur, met de gereserveerde poort. Verifieer Caddy ≥ 2.8 voor `log_skip` en behoud de Auth-/capability-loguitsluiting. Voer `caddy validate --config /etc/caddy/Caddyfile` uit vóór een gecontroleerde reload; behoud alle andere sites. Laad de nieuwe systemd-unit, maar schakel bootstart pas in na een geslaagde eerste release.
10. **Corrigeer DNS en verifieer TLS.** Vervang uitsluitend `staging.dartflow.nl A` door **`128.140.93.95`**. Vervang het foutieve AAAA door **`2a01:4f8:c015:60a6::1`** als dual stack wordt ingericht en getest, of verwijder het oude AAAA bij IPv4-only. Deze adressen zijn via geldige Milo-HTTPS geverifieerd; eigen DartFlow-TLS moet na propagatie apart slagen. De huidige waarden zijn `185.151.30.138` en `2a07:7800::138` en geven een certificaatfout. Negeer die fout niet om een release groen te maken.
11. **Registreer de dedicated runner en activeer de policy bewust.** Gebruik een kortlevend GitHub-registratietoken via het beheerpad, de vaste DartFlow-runnernaam/labels en uitsluitend de echte repository. Maak dit geen GitHub Actions secret en hergebruik Milo's registratie niet. Verifieer service/UID/labels/paden en de negatieve lees-/schrijfgrenzen. Zet pas na de volledige installatiecontrole `nativeEnabled: true` in de beoordeelde repositorypolicy; commit die wijziging en eis opnieuw groene CI op de gekozen release-SHA.
12. **Voer de eerste handmatige release en acceptatie uit.** Start `Deploy DartFlow staging` vanaf de integratiebranch met de exacte SHA en bestaande `config_id`. Laat alle gates slagen, controleer de vier health/readinesspaden en voltooi de echte Auth-/wedstrijdpilot. Schakel de DartFlow-service pas daarna voor boot in. Controleer Milo opnieuw met dezelfde baseline; vul de release-, configuratie-, CI-/deployrun- en herstelbewijzen in het acceptatierapport in.

| Beoordeelde bron | Bestemming | Eigendom/mode |
|---|---|---|
| `infra/staging/deploy-helper.py` | `/usr/local/libexec/dg-dartflow-deploy-helper` | `root:root 0755` |
| Gerenderde `infra/staging/deploy-entry.py` | `/usr/local/bin/dg-dartflow-deploy` | `root:root 0755` |
| `infra/staging/extract-source.py` | `/usr/local/libexec/dartflow-extract-source.py` | `root:root 0755` |
| `infra/staging/lock-guardian.py` | `/usr/local/libexec/dartflow-lock-guardian.py` | `root:root 0755`; digest in `guardianSha256` |
| `ops/release-gate.mjs` | `/usr/local/libexec/dartflow-release-gate.mjs` | `root:root 0755` |
| `ops/retry-deploy.mjs` | `/usr/local/libexec/dartflow-retry-deploy.mjs` | `root:root 0755` |
| Ingevulde `infra/staging/deploy-policy.example.json` | `/etc/dg-sites/dartflow-staging/deploy.json` | `root:root 0600` |
| Gerenderde `infra/staging/dartflow-staging.sudoers.example` | `/etc/sudoers.d/dartflow-staging-deploy` | `root:root 0440` |
| Beoordeelde `infra/staging/dartflow-staging.service.example` | `/etc/systemd/system/dartflow-staging.service` | `root:root 0644` |

## Immutable configuratie en Supabase Auth

Maak voor iedere configuratiewijziging een **nieuw** root-only ID onder `/etc/dg-sites/dartflow-staging/configs/<config_id>/`. Publiceer de directory pas nadat beide bestanden volledig en met correcte rechten zijn aangeleverd; overschrijf geen bestaande bundel. Neem het ID op in `allowedConfigIds` van de rootpolicy.

`public.json` bevat precies de vier eerder genoemde publieke keys; gebruik `ops/public-config.example.json`. `runtime.env` volgt `ops/runtime.env.example` en bevat uitsluitend één regel met **`DARTFLOW_DATABASE_URL`**, aangeleverd vanuit de beheerde secretvoorziening zonder shellgeschiedenis of logs. De URL-gate dwingt de eigen accountnaam `dartflow_app`, directe projecthost of session-pooler van hetzelfde DartFlow-project, en `sslmode=verify-full` af. Readiness controleert de werkelijke accountnaam en het schema. De werkelijke rolflags (`rolsuper`, `rolbypassrls`), rollidmaatschappen en DDL-/tabelrechten moeten nog afzonderlijk met beheeracceptatie en negatieve proeven worden geverifieerd; de accountnaam bewijst die beperkingen niet. Projectref en credentialwaarden zijn nog niet beschikbaar; gebruik geen Milo-backend als vervanging.

De release bevat een rootgemaakte `.runtime.env`-symlink naar die exacte bundel en een aparte `.release.env` met uitsluitend publieke configuratie, `NODE_ENV`, loopbackpoort, volledige bron-SHA, run-ID en build-/runtimeconfig-ID's. `.release.json` bewaart onder meer configuratie- en artifactdigests, validator-/helperhashes, toolchain en CI-bewijs. De broker controleert die binding opnieuw vóór activatie en rollback. Eén atomische `current`-wissel verplaatst app én bijbehorende configuratie. Een gedeeld overschreven envbestand is niet de reguliere route.

Wijziging van een `NEXT_PUBLIC_*`-waarde vereist een nieuwe bundel én herbuild. Verwijder of herroep configuratie/credentials van de actieve en benodigde vorige gezonde release niet. Credentialrotatie, het laten vervallen van oude databasecredentials en incompatibele schemawijzigingen vereisen een apart getest herstelplan; immutable bestanden maken externe credentialrotatie niet automatisch terugdraaibaar.

Configureer in het eigen Supabase Auth-project Site URL `https://staging.dartflow.nl` en callback `https://staging.dartflow.nl/auth/callback`. Google client-ID/-secret staan bij de Supabase Google-provider; de Google-console gebruikt de door dat project getoonde `/auth/v1/callback`. SMTP-credentials en geverifieerde afzender staan in Supabase Auth. Leg toegestane ontvangers en Google-testaccounts vast vóór echte tests. Code voor OTP/Google/SSR is aanwezig; provideracceptatie is nog Open. `DARTFLOW_DATA_MODE=local` blijft uitsluitend voor expliciete loopbackfixtures en wordt nooit de publieke stagingconfiguratie.

## Normale release, lockconflict en rollback

1. Commit/push naar de vastgelegde integratiebranch en wacht op de vereiste **push-CI voor de volledige SHA**.
2. Start **Deploy DartFlow staging** handmatig op die branch met `sha` en een bestaande toegelaten `config_id`. De workflow bouwt op de doel-VPS opnieuw met locked dependencies. Het GitHub-inspectieartifact wordt niet gekopieerd naar de actieve app.
3. Bewaar de gate-/deployrun, volledige SHA, releasenaam en configuratie-ID. De broker controleert `/api/health` en `/api/ready` op **loopback én publiek HTTPS**, telkens met dezelfde SHA/run/buildconfig/runtimeconfig. Controleer de echte gebruikersflow afzonderlijk.

Concrete CLI-syntaxis, pas na repository-/branch-/installatieverificatie. Vervang de zichtbare placeholders door vastgelegde waarden; dit zijn geen uit te voeren huidige projectwaarden:

```bash
gh workflow run deploy-staging.yml --repo '<geverifieerde-eigenaar/repository>' --ref '<integratiebranch>' -f sha='<volledige-lowercase-40-tekens-SHA>' -f config_id='<bestaand-immutable-config-ID>'
gh run list --repo '<geverifieerde-eigenaar/repository>' --workflow deploy-staging.yml --branch '<integratiebranch>' --event workflow_dispatch --limit 5 --json databaseId,status,conclusion,headSha,url
gh run watch '<bijbehorend-deployrun-ID>' --repo '<geverifieerde-eigenaar/repository>' --exit-status
```

Kies het bijbehorende run-ID uit de zojuist gestarte handmatige uitvoering. `headSha` van de workflowrun identificeert de controlworkflow; de brokeruitvoer en health bewijzen daarnaast de apart ingevoerde applicatie-SHA. Een geslaagde dispatchopdracht betekent alleen dat GitHub de aanvraag heeft aangenomen.

Deploy en rollback delen GitHub-concurrencygroep **`dartflow-staging-activation`**, `cancel-in-progress: false`, en nemen steeds eerst `/run/lock/dg-build.lock` en daarna `/run/lock/dartflow-staging.deploy.lock`. Beide locks zijn nonblocking en blijven tot het einde van de operatie vast. Daardoor overlapt DartFlow ook bij een handmatige brokeroproep niet met zijn eigen activatie/rollback of een Milo-build die de gedeelde lock gebruikt.

De nieuwe root-owned **lockbewaker** draait als afzonderlijke tijdelijke systemd-service `dg-dartflow-lock-<run-id>-<attempt>.service`, buiten de runner-/helper-cgroup. Hij krijgt dezelfde reeds vergrendelde open-file-descriptions via stdin/stdout overgedragen; deze descriptors gaan nooit naar repository-/buildcode. Het helperpad start pas buildcode nadat de bewaker de locks en de exacte helperidentiteit via pidfd heeft bevestigd en gereedheid meldt. De bewaker ontvangt geen GitHub-token of runtimeconfiguratie en schrijft niet naar de lockdescriptors.

Bij een normaal einde, afgevangen onderbreking of waargenomen helperdood stopt de bewaker uitsluitend de vier vaste buildunits van die poging (`extract`, `versions`, `install`, `build`) en bevestigt dat ze niet actief zijn. Hij wacht ook tot er geen manager-side job voor die units of `dartflow-staging.service` meer loopt. Hij start/stopt de app niet en voert geen approllback uit. Kan hij veilige cleanup niet aantonen, dan houdt hij de locks vast en is bevoegde rootdiagnose nodig. De bestaande Milo-app blijft hierbij ongemoeid; volgende native builds op dezelfde globale lock blijven bewust geblokkeerd.

Een harde helperdood tijdens activatie geeft daarom **geen garantie op automatisch appherstel**. Controleer na afloop de actuele app/configidentiteit en health/readiness; herstel zo nodig via een bekende compatibele rollback zodra cleanup en lockvrijgave aantoonbaar veilig zijn. Verwijder of vervang nooit `/run/lock/dg-build.lock` om een blokkade te omzeilen. De beheerder moet de vaste buildunits en pending appjob eerst onderzoeken/afwikkelen voordat een vastgehouden lockbewaker bewust kan worden beëindigd. Gelijktijdige geforceerde beëindiging van helper én bewaker valt buiten deze bescherming.

Deze implementatie heeft lokale proces-/FD-controles, maar **de werkelijke systemd-`--pipe`-FD-overdracht en een gecontroleerde helper-SIGKILL-proef op de doelhost zijn nog Open**. Voer die uit binnen DartFlow staging en bevestig vóór een tweede build dat er geen overlappende build-/activatiejob bestaat. Markeer de native hostinstallatie niet als geaccepteerd op basis van alleen lokale fixtures.

Alleen **exitcode `75`** betekent lockbezetting. De retryadapter wacht dan achtereenvolgens **15, 30 en 45 seconden**, maximaal vier pogingen inclusief de eerste, voor deploy én rollback. Exitcode `1` of iedere andere code wordt niet opnieuw geprobeerd. De lock vormt geen wachtrij en wordt niet gewist, omzeild of vervangen. Blijft de vierde poging bezet, wacht dan op de lopende operatie en start dezelfde handmatige workflow opnieuw; herhaal geen mislukte activatie alsof het een lockconflict was.

Voor een bewuste rollback start je **Roll back DartFlow staging** op de integratiebranch, met een bestaande verzegelde releasenaam `<sha12>-<run-id>-<attempt>`. De broker gebruikt uitsluitend de bekende release en haar oorspronkelijke nog geldige configbundel; geen willekeurig pad, nieuwe bronbuild of databaseactie. De rollbackroute kan een ongezonde huidige installatie herstellen. Het doel moet zijn integriteits-/configuratiecontrole en alle health/readinesschecks doorstaan. Bij een mislukte overgang herstelt de broker alleen een vooraf gezond bevonden voorganger; faalt ook dat herstel, dan stopt hij uitsluitend DartFlow.

Gebruik het eerder vastgelegde geaccepteerde release-ID; kies geen willekeurige directory:

```bash
gh workflow run rollback-staging.yml --repo '<geverifieerde-eigenaar/repository>' --ref '<integratiebranch>' -f release_id='<bekende-sha12-run-id-attempt>'
gh run list --repo '<geverifieerde-eigenaar/repository>' --workflow rollback-staging.yml --branch '<integratiebranch>' --event workflow_dispatch --limit 5 --json databaseId,status,conclusion,headSha,url
gh run watch '<bijbehorend-rollbackrun-ID>' --repo '<geverifieerde-eigenaar/repository>' --exit-status
```

Controleer na afloop opnieuw beide endpoints via loopback/publiek HTTPS én de gebruikersflow, op de gekozen SHA en oorspronkelijke configuratie-ID; controleer Milo tegen zijn vooraf vastgelegde baseline.

Bij een **eerste mislukte installatie zonder gezonde voorganger** stopt de service en verwijdert de broker `current`. Er is dan geen geslaagde release te claimen. Verzegelde kandidaten en configuratie blijven beschikbaar voor diagnose; actieve/vorige releases worden niet automatisch opgeruimd. De broker voert geen databaserollback, destructieve migratie of automatische restore uit.

## Verificatie en actuele resterende poorten

De lokale tests voor CI-weigering, bronextractie, secretisolatie, locks en app/configuratieherstel vervangen geen installatiebewijs. Root vult de definitieve nieuwe tests, geteste bron-SHA en resultaten aan in het [acceptatierapport](../voorbeelden/release-acceptatie.md). Voltooi op de echte omgeving: beperkte DB-rol/schema/TLS, OTP en Google met toegelaten accounts, een wedstrijd starten, scores en resultaat na herladen, twee apparaten/9:16-scherm, compatibele rollback en Milo's ongewijzigde werking.

Vóór native ingebruikname zijn ook de werkelijke systemd-versie en beide FD-overdrachten te testen: naar de onafhankelijke guardian én naar de vertrouwde `systemd-run --wait`-client. Het buildaccount mag geen van beide lockdescriptors ontvangen. De lokale procesproeven dekken een harde helperdood en een vertraagde clientstart; het volledige hostprotocol en rootherstel staan in [GUARDIAN.md](../infra/staging/GUARDIAN.md).

De afhankelijke uitvoering blijft geblokkeerd door **repository-identiteit/integratiebranch**, **bevoegde hostbootstraptoegang**, **eigen Supabase-configuratie/databasegeheim/testaccounts** en **DNS/TLS**. Deze ontbrekende gegevens worden niet door een template, lokale fixture of handmatig groen gemaakte readiness vervangen.
