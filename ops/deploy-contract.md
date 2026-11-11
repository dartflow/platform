# DartFlow native broker: vast contract en installatiestatus

**11 november 2026 — lokaal geïmplementeerd, niet op de VPS geïnstalleerd.** De actieve workflowbestanden bestaan, maar `ops/release-policy.json` bevat nog `repository: null`, `integrationBranch: null`, `nativeEnabled: false`. De workflow stopt daardoor vóór de dedicated runner. De echte repository, hostbootstraptoegang en eigen stagingbackend ontbreken; DNS wijst nog verkeerd. Zie `docs/deployment.md` voor de praktische installatie-/releaseprocedure en `docs/host-inventory.md` voor actuele metingen.

## Vaste scope

De nieuwe broker bedient uitsluitend host `dg-nxttrack-01`, site `/srv/sites/dartflow-staging` en service `dartflow-staging.service`. Nieuwe voorgestelde identiteiten zijn `run-dart-stg`, `build-dart-stg`, `app-dart-stg`; zij zijn nog niet aangemaakt. De runnernaam wordt `dg-nxttrack-01-dartflow-staging` en selectielabels worden `self-hosted,Linux,X64,dg-nxttrack-01,dartflow,staging`. Werkelijke UID/GID's, runnerregistratie en poort worden pas na inventarisatie vastgelegd. `4174` was op 03:08 CET niet gebonden, maar is niet gereserveerd. `4173` blijft Milo's poort.

Milo's `/usr/local/bin/dg-site-deploy` en helper blijven ongewijzigd. Hun actuele entryhash en beperkte sudo-policy zijn via readonly-run [42943887248](https://github.com/milobingo/platform/actions/runs/42943887248) bevestigd. DartFlow krijgt een aparte entry en helper; hij gebruikt uitsluitend dezelfde bestaande globale buildlock.

## Geïnstalleerde grens na bevoegde bootstrap

| Object | Vast pad / regel |
|---|---|
| Unprivileged entry | `/usr/local/bin/dg-dartflow-deploy` |
| Privileged helper | `/usr/local/libexec/dg-dartflow-deploy-helper` |
| Onafhankelijke GitHub-gate | `/usr/local/libexec/dartflow-release-gate.mjs` |
| Begrensde bronextractor | `/usr/local/libexec/dartflow-extract-source.py` |
| Onafhankelijke lockbewaker | `/usr/local/libexec/dartflow-lock-guardian.py`, gepind met `guardianSha256` |
| Alleen-lock retryadapter | `/usr/local/libexec/dartflow-retry-deploy.mjs` |
| Rootpolicy | `/etc/dg-sites/dartflow-staging/deploy.json`, `root:root 0600` |
| Configbundels | `/etc/dg-sites/dartflow-staging/configs/<config_id>/`, root-only `0700`, files `0600` |
| Verhoogde toegang | Alleen de digest-/argumentgebonden helperregels uit `infra/staging/dartflow-staging.sudoers.example` |

Entry/helper/gate/extractor/lockbewaker/retryadapter en alle bovenliggende padcomponenten zijn root-owned en niet schrijfbaar voor runner, builder, app, groep of anderen. Render de helper-SHA-256 in de entry en sudoers; de bronplaceholder weigert uitvoering. De rootpolicy pint gate/extractor/guardianhashes, repository/branch/checks, backendproject, echte accounts, poort, toolchain en resourcegrenzen. Het voorbeeldbeleid bevat opzettelijk ontbrekende waarden en wordt geweigerd.

De entry accepteert exact:

```text
dg-dartflow-deploy deploy <lowercase-full-sha> <numeric-run-id>-<attempt> <config_id>
dg-dartflow-deploy rollback <sha12>-<numeric-run-id>-<attempt>
```

Er is geen invoer voor site, shellopdracht, service, repository-URL, poort of pad. `config_id` is 1–96 tekens met uitsluitend letters/cijfers/punt/underscore/koppelteken en een alfanumeriek begin. Deployment ontvangt begrensde JSON met alleen `githubToken` op stdin; rollback ontvangt `{}`. Het token is het standaard kortlevende workflowtoken. Geen PAT, appsecret of inherited provideromgeving wordt doorgegeven. De helper controleert host, rootprivilege, `SUDO_USER/UID/GID`, vaste argumenten en de rootpolicy opnieuw.

## Onafhankelijke bron- en CI-poort

De hosted workflow draait eerst de vertrouwde gate, vóór applicatiecheckout of een self-hosted job. De root-owned helper herhaalt dezelfde GitHub-controle onafhankelijk met zijn eigen policy. De exacte verplichte DartFlow-bron is `ci.yml`, event `push`, jobnaam **`Verify`**:

- Repository-ID/naam, toegestane integratiebranch, exacte volledige commit en afstamming van de waargenomen branch-HEAD moeten overeenkomen.
- Alleen de nieuwste eigen relevante CI-run voor diezelfde SHA/branch telt; status en conclusie moeten `completed/success` zijn.
- Iedere vereiste job in de exacte runpoging moet uniek aanwezig zijn op dezelfde SHA, met `completed/success`. Ontbrekend, skipped, cancelled, failure of pending weigert.
- De gate controleert de run opnieuw om een gewijzigde poging/status tijdens de verificatie te weigeren. Metadatarequests zijn gepagineerd en begrensd.

De helper levert ook deployrun-ID en poging aan de rootgate. Deze moet een bestaande lopende `workflow_dispatch` van de eigen vaste `deploy-staging.yml` op de integratiebranch zijn, met overeenkomende huidige poging en toegestane controlbron. GitHub geeft de dispatchinputs niet via deze API terug; de controle is dus geen cryptografisch bewijs dat het SHA-inputveld bij de run hoort. De SHA zelf wordt onafhankelijk exact tegen CI en branchafstamming getoetst.

De rootgate is werkelijk alleen-lezen beproefd tegen Milo's bestaande bekende groene bron `729d962b7401b100ce9cacb94ce4e4da16a699f2` en [CI 42802522209](https://github.com/milobingo/platform/actions/runs/42802522209). Dat is bewijs van de validator/API-route, **geen DartFlow-CI of deployacceptatie**. Milo's verplichte job heet `verify`; DartFlow's job heet `Verify`.

## Bron, build en configuratie

De runner checkt geen applicatiebron uit en krijgt geen algemene hostbevoegdheid. De roothelper downloadt uitsluitend het archief van de geverifieerde vaste GitHub-repository en exacte SHA via begrensde HTTPS naar GitHub-API/codeload. Het token staat niet in argv, een bronbestand, archive of buildomgeving.

Het aparte buildaccount pakt de bron uit met de root-owned begrensde extractor. Traversal, speciale/hardlinked bestanden en escaping links worden geweigerd. Extractie, versiechecks, `npm ci` en build draaien in tijdelijke systemd-units met eigen HOME/TMP, lege gecontroleerde omgeving, beperkte filesystemtoegang, `NoNewPrivileges`, cgroup-/looptijdgrenzen en opruiming van de echte build-cgroup. Het buildaccount heeft geen aanvullende groepen en geen toegang tot `/etc/dg-sites`, `/srv/sites` of de runnerhome.

De gepinde toolchain is Node `24.18.0` en npm `11.16.0`. Alleen de vier publieke configwaarden en niet-geheime SHA/run/config-ID's bereiken install-/buildscripts. Databasecredentials zijn niet nodig voor de build. De standalone-uitvoer moet `server.js`, `public`, `.next/static` en de passende `build-config.json` bevatten. De helper kopieert/sealt uitsluitend toegestane output via no-follow directorydescriptors, controleert bron-/artifactbudgetten en berekent een inhoudsdigest.

Een immutable configbundel bevat precies:

```text
/etc/dg-sites/dartflow-staging/configs/<config_id>/
  public.json     # precies de vier publieke buildwaarden
  runtime.env     # uitsluitend DARTFLOW_DATABASE_URL
```

Gebruik `ops/public-config.example.json` en `ops/runtime.env.example` als veldvoorbeelden, zonder echte waarden te committen. De backendref is een eigen geverifieerd DartFlow-stagingproject. De URL-controle dwingt dezelfde projecthost/session-pooler, accountnaam `dartflow_app` en geverifieerde TLS af; readiness controleert werkelijke accountnaam en schema. Werkelijke superuser-/BYPASSRLS-flags, rollidmaatschappen en DDL-/tabelrechten krijgen nog afzonderlijke beheeracceptatie en negatieve tests. Config-ID's staan expliciet in de rootallowlist. Een nieuwe configuratie krijgt een nieuw ID; bestanden onder een gebruikt ID worden niet overschreven.

De verzegelde release is:

```text
/srv/sites/dartflow-staging/releases/<sha12>-<run-id>-<attempt>/
  server.js
  public/
  .next/static/
  build-config.json
  .runtime.env -> /etc/dg-sites/dartflow-staging/configs/<config_id>/runtime.env
  .release.env    # publieke waarden, NODE_ENV, loopbackpoort, SHA/run/config-ID's
  .release.json   # integriteits-/config-/toolchain-/CI-metadata, root-only
```

De appunit leest `.runtime.env` en daarna `.release.env` via `current`. Voor activatie/rollback worden metadata, configuratiehashes, bundelallowlist en exacte runtimeverwijzing opnieuw gecontroleerd. `current` wisselt atomair; app en oorspronkelijke configuratie blijven gekoppeld. Een gewijzigde `NEXT_PUBLIC_*`-waarde vereist een nieuwe build. De broker migreert of herstelt geen database.

## Locking, timeouts en herstel

Zowel deploy als rollback nemen nonblocking eerst `/run/lock/dg-build.lock` en daarna `/run/lock/dartflow-staging.deploy.lock`. De bestaande gedeelde lock wordt niet vervangen of inhoudelijk aangepast. Locks blijven over bron/build/activatie/nacontrole vast. GitHub gebruikt daarnaast voor beide workflows `dartflow-staging-activation`, zonder annulering van een lopende operatie.

Een afzonderlijke root-owned guardianunit `dg-dartflow-lock-<run-id>-<attempt>.service` neemt dezelfde open-file-descriptions over via systemd `--pipe` op FD 0 en 1. De helper sluit bij cleanup alleen zijn eigen descriptors; hij ontgrendelt de gedeelde open-file-descriptions niet expliciet. De guardian valideert locks en helper-pidfd vóór zijn gereedmelding. De helper wacht daarop vóór bron-/install-/buildcode draait. De vertrouwde `systemd-run --wait`-buildclient en synchrone vaste `systemctl restart/stop`-appclient behouden beide descriptors via `pass_fds`, zodat ook late starts na helperdood beschermd blijven. Builder en app krijgen ze niet via D-Bus, stdio of omgeving; guardiancommands krijgen eigen gecontroleerde stdin/stdout. De guardian heeft geen token/runtimeconfiguratie en geen appactivatietaak. Zie `infra/staging/GUARDIAN.md` voor de gecontroleerde systemd-v255-semantiek en verplichte hostproeven.

Na een einde-/cleanupverzoek of waargenomen helperdood stopt en controleert de guardian uitsluitend de vier vaste `dg-dartflow-build-<run-id>-<attempt>-{extract,versions,install,build}.service`-units. Hij wacht daarnaast tot `systemctl list-jobs` geen pending job voor die units of `dartflow-staging.service` meer bevat. Een onzekere of mislukte cleanup houdt de locks vast voor rootdiagnose; er wordt dan geen nieuwe build toegelaten. De helper vangt ook `SIGHUP` af; tegen harde helperdood is juist de onafhankelijke guardian bedoeld.

De guardian herstelt de app niet automatisch na een harde helperdood midden in activatie. Na cleanup zijn controle van de werkelijke app/configidentiteit, health/readiness en zo nodig een bekende compatibele rollback vereist. Beëindig een vastgehouden guardian pas na onafhankelijke bevestiging dat zijn vaste builds gestopt zijn en pending appjobs zijn afgewikkeld; vervang of verwijder nooit de globale lockfile. Gelijktijdige `SIGKILL` van alle root-lockhouders (helper, guardian en vertrouwde clients) is geen gedekte fout. De echte systemd-FD-overdracht, afwezigheid van builder-lockdescriptors en gecontroleerde helper-SIGKILL-proeven op de doelhost blijven **Open**; lokale FD-/procesfixtures bewijzen die hostintegratie niet.

Alleen lockbezetting levert exitcode **75**. De retryadapter doet voor deploy én rollback maximaal vier pogingen, met 15/30/45 seconden tussenruimte; geen enkele andere fout wordt automatisch herhaald. Blijft de vierde poging bezet, wacht op de lopende operatie en start dezelfde expliciete workflow opnieuw. Milo's bestaande generieke foutcode 1 wordt nooit als locksignaal gebruikt.

De policy begrenst buildresources, bron-/artifactomvang, servicecommando's en healthpogingen. De service wordt alleen via de vaste `restart/stop`-route bediend. `/api/health` én `/api/ready` moeten op loopback én publiek HTTPS dezelfde volledige SHA, run-ID, buildconfig-ID en runtimeconfig-ID tonen. De bestaande readinessbetekenis blijft intact.

Een gewone deploy weigert een bestaande ongezonde baseline. Na een mislukte nieuwe activatie herstelt hij alleen een vooraf gezond bevonden vorige app/configcombinatie en controleert die opnieuw. Faalt ook dat herstel, dan stopt de DartFlow-service. Bij de eerste installatie zonder gezonde voorganger stopt de service en verdwijnt `current`. De expliciete rollbackroute kan een ongezonde huidige installatie vervangen door een bekende, integere release; het doel moet alsnog alle checks halen. Bij falen zonder gezonde fallback blijft de service veilig gestopt.

Actieve releases, benodigde voorgangers en hun configbundels worden niet automatisch verwijderd. Credentialrotatie en schema-/datacompatibiliteit blijven afzonderlijke beheertaken; een approllback draait die externe toestanden niet terug. Lokale faalinjectietests bewijzen de codepaden; de echte eerste installatie, beperkte rechten, lockconflicten, compatibele rollback en Milo-nacontrole blijven uit te voeren hostacceptatie.
