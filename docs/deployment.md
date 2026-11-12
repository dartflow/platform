# DartFlow: staging en productie

De oorspronkelijke v17-opdracht van 12 november vroeg uitsluitend staging. Na acceptatie heeft de eigenaar afzonderlijk productie geautoriseerd; dezelfde geteste SHA is inmiddels op beide omgevingen actief. Volg het [v17-stagingverslag](v17-uitrol.md) en het [productieverslag](v17-productie.md) voor de actuele release en acceptatiegrenzen.

De vastgelegde repository is **[dartflow/platform](https://github.com/dartflow/platform)**, integratiebranch **`main`**, doelhost **`dg-nxttrack-01`**. De gebruiker heeft staging én productie geautoriseerd en beheer-SSH/sudo is beschikbaar. Beide omgevingen hebben afzonderlijke backendprojecten, accounts, runners, services, configuratiebundels en releasepaden. De eerdere inventaris waarin repository en beheerlogin ontbraken is historisch; actuele uitrol-/acceptatieresultaten staan in [het v15-opleverrapport](../voorbeelden/opleverrapport-v15.md).

De native hostcontracten zijn op 11 november 2026 geïnstalleerd en geverifieerd; beide policies hebben `nativeEnabled: true`. De daadwerkelijke accounts, rootbestanden, twee online runners, databaseverbindingen, overdracht van lockdescriptors, afgebroken helpers en geblokkeerde cleanup met gericht rootherstel zijn vastgelegd in `docs/evidence/*-2026-11-11.json`. Dit installatiebewijs staat los van de CI- en applicatierelease: ook de ingeschakelde broncommit moet eerst groene CI krijgen en door de beide deployworkflows lopen.

De actuele v15-projectrefs, configuratie-ID's, services en providerstatus staan in [v15-omgevingen.md](v15-omgevingen.md). De stappen voor de eigenaar om OTP/SMTP, Google en Resend werkelijk te activeren staan in [v15-integraties.md](v15-integraties.md). Dit document beschrijft de bron-, database- en hostrelease die deze instellingen gebruikt.

## Ontwikkeling en v15-architectuur

De developmentcheckout op de dev-VPS is de bron voor wijzigingen. Het overgenomen prototype blijft beschikbaar als referentie en voor zijn eigen tests; de draaiende applicatie bestaat uit Next.js-pagina's, geauthenticeerde server-API's en de private PostgreSQL-database. Browseropslag bepaalt geen platformrol, clublidmaatschap, wedstrijdstatus of providercredential. Supabase Auth levert de geverifieerde gebruikersidentiteit; platform- en clubrechten komen uit actuele serverdata. De beperkte databasegebruiker `dartflow_app` voert geen migraties uit.

Gebruik voor development de geïsoleerde lokale PostgreSQL-fixture: `npm ci`, `npm run db:start`, `npm run db:migrate` en `npm run db:seed`. Controleer dat de developmentconfiguratie loopback en `DARTFLOW_DATA_MODE=local` gebruikt voordat fixturedata wordt geladen. Synthetische accounts en seeddata gaan niet naar staging of productie. De reguliere CI controleert types, lint, domein-/integratietests, het bronprototype, de native deploygrenzen, de standalonebuild en de browserflows. Alleen een geslaagde push-CI op de gekozen volledige SHA telt voor de releasegate.

CI verifieert de aanwezige PostgreSQL 16-binaries op de Ubuntu 24.04-runner en gebruikt datzelfde vaste pad voor de geïsoleerde database. [Playwright downloadt de gepinde Chromium](https://playwright.dev/docs/browsers) en controleert bij de echte browserstart de aanwezige native libraries. CI weigert een overgeslagen hostvalidatie of een afwijkend browserpad; alle browserflows in de testsuite blijven verplicht. De runner levert de benodigde libraries en DartFlow levert DM Sans en Barlow zelf. De herhaalde DNS-storingen bij APT betroffen herinstallatie van aanwezige database-/browsercomponenten en negen extra fallbackfontpakketten. Deze CI-route gebruikt de aanwezige systeemcomponenten en valideert hun daadwerkelijke werking met de database- en browsertests.

Applicatiemail gebruikt een duurzame outbox: domeinwijziging en mailjob worden in dezelfde transactie opgeslagen, daarna verwerkt een omgevingsgebonden worker beperkte batches. Supabase Auth blijft verantwoordelijk voor OTP en zijn eigen SMTP-configuratie. Voor cameramedia gebruiken de browsers WebRTC en de eigen native TURN-service; app-, signaling- en relayautorisatie blijven afzonderlijk. Een geslaagde appbuild bewijst geen externe mailbezorging, Google-login of bereikbare publieke mediarelay.

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

De optionele hosted `Staging candidate`-workflow leest de stagingvariables voor een inspectieartifact. De normale native deploy leest zijn publieke waarden uit de beschermde hostbundel; de GitHub-variables vervangen die bundel niet. **Database-, encryptie-, worker-, TURN- en Management-credentials blijven uitsluitend server-side**. Google-/SMTP-secrets staan in het bijbehorende Supabase Auth-project; de Resend-appsleutel en het webhooksecret staan versleuteld in de private applicatiedatabase. Migratiecredentials blijven in het afzonderlijke beheerpad.

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
runtime.env   # uitsluitend de expliciete server-allowlist hieronder
```

Gebruik de veldvoorbeelden `ops/public-config.example.json` en `ops/runtime.env.example`; echte waarden blijven buiten Git. Bundeldirectory `root:root 0700`, bestanden `root:root 0600`. Een ID bestaat uit 1–96 tekens, alfanumeriek begin, daarna alleen letters/cijfers/punt/underscore/koppelteken. Nieuwe waarden krijgen een nieuw toegelaten ID; een gebruikt ID wordt niet overschreven. Stage- en productieprojecten/configuraties worden niet uitgewisseld.

De v15-broker accepteert alleen deze runtimevelden en weigert onbekende of dubbele namen:

| Naam | Grens |
| --- | --- |
| `DARTFLOW_DATABASE_URL` | Eigen beperkte databasegebruiker en project; verplichte TLS-verificatie |
| `DARTFLOW_ENV` | Exact de eigen omgeving |
| `DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY` | Eigen base64-gecodeerde 32-byte sleutel, gegenereerd op de doelhost |
| `DARTFLOW_MAIL_WORKER_TOKEN` | Eigen willekeurig token van 64 hextekens, gegenereerd op de doelhost |
| `DARTFLOW_MAIL_ALLOWED_FROM` | Exact toegestane afzenderadressen; providerverificatie blijft daarnaast nodig |
| `DARTFLOW_MAIL_ALLOWED_REPLY_TO` | Optionele extra exacte Reply-To-adressen; verruimt From en testontvangers niet |
| `DARTFLOW_MAIL_TEST_RECIPIENTS` | Exact toegestane echte testontvangers |
| `DARTFLOW_MAIL_MAX_MODE` | Hoogstens `test` op staging; hoogstens `live` op productie |
| `DARTFLOW_TURN_SECRET` | Eigen base64-gecodeerd 32-byte relaysecret |
| `DARTFLOW_TURN_URLS` | Expliciete TURN-URL's van deze omgeving, met toegestane transportkeuze |
| `SUPABASE_MANAGEMENT_TOKEN` | Optioneel projectgebonden server-token voor Google-configuratiebeheer |
| `DARTFLOW_ADMIN_REQUIRE_MFA` | Optionele extra eis; pas activeren na ingerichte en geteste eigenaar-MFA |

Ook met een runtimebovengrens `test` of `live` begint de opgeslagen mailinstelling in **Log**. Een nieuwe secret of allowlist krijgt een nieuwe immutable bundel en wordt via een gereviewde configuratierelease geactiveerd. Het wijzigen van de integratie-encryptiesleutel vraagt een plan om bestaande credentials opnieuw te versleutelen of in te voeren. Bewaar benodigde eerdere sleutels volgens het toegestane herstelbeleid; een databaseback-up alleen ontsleutelt de credentials niet. De afzonderlijke bronbestanden `integrations.key`, `mail-worker.token` en `turn-secret` onder de eigen `/etc/dg-sites/<site>/` zijn root-only en worden nooit buildinput.

De [mailconfiguratievoorbereiding](evidence/v15-reauth-mail-host-prepared-2026-11-11.json) heeft nieuwe immutable IDs `staging-2026-11-11-v15-mail-1` en `production-2026-11-11-v15-mail-1` toegelaten: From uitsluitend `noreply@dartflow.nl`, extra Reply-To `support@dartflow.nl`, testontvanger uitsluitend `info@dgwebservices.nl`. Beide brokers, sudo-digests en oude/nieuwe bundels zijn gecontroleerd onder dezelfde bestaande buildlock. Staging gebruikt nu de nieuwe bundel; de productiebundel is alleen voorbereid. De [stagingapp-afzender](evidence/v15-noreply-sender-2026-11-11.json) is vervolgens afzonderlijk geauditeerd opgeslagen en teruggelezen: `DartFlow <noreply@dartflow.nl>`, Reply-To `support@dartflow.nl`, revisie 1, modus Log. Er zijn geen appkeys/webhookcredentials of geselecteerde testontvangers opgeslagen. Supabase SMTP is hierbij niet aangepast.

De URL-gate dwingt de eigen projecthost/session-pooler, accountnaam `dartflow_app` en `sslmode=verify-full` af. Werkelijke rolflags, lidmaatschappen en DDL-/tabelrechten moeten met beheeracceptatie en negatieve proeven worden bewezen. Een accountnaam alleen bewijst geen least privilege. Migraties/backup/restore lopen apart; de broker voert geen automatische schemawijziging of databaseherstel uit.

Het standalone-pakket bevat `server.js`, getraceerde dependencies, `public/`, `.next/static/` en `build-config.json`, dat bron-SHA/config-ID/hash van de publieke buildwaarden vastlegt. De verzegelde release bevat daarnaast een `.runtime.env`-symlink naar de exacte bundel, een gegenereerde `.release.env` met uitsluitend publieke configuratie/SHA/run/config-ID's en root-only `.release.json` met integriteits-/CI-/toolchainbewijs. De appunit leest beide envbestanden via dezelfde atomisch verwisselde `current`-verwijzing. Wijziging van `NEXT_PUBLIC_*` vereist een herbuild.

## Database-uitbreiding en compatibiliteit

De v15-uitbreiding is een afzonderlijk beoordeelde, additieve migratie onder `supabase/migrations/`. De SQL omvat de account-/eigenaarsgrenzen, platformdata en private integratietabellen. Pas de gereviewde migratie met de beheeridentiteit afzonderlijk toe op staging en controleer rechten en bestaande IDs. Herhaal dit op productie vóór de applicatiepromotie. Laad daar geen developmentseed. De app- en runneraccounts krijgen geen beheercredential of migratierecht.

Het bestaande kerncontract blijft `dartflow_private.schema_migrations` versie **1**; de uitbreiding registreert `feature_versions(name='v15', version=15)`. De nieuwe readinesscontrole vereist beide versies en de runtimegebruiker `dartflow_app`. Daardoor kan een eerdere compatibele kernrelease haar bestaande versie-1-controle blijven uitvoeren. Controleer de werkelijke vorige release vóór rollback; een nieuwe marker is geen algemene garantie voor toekomstige destructieve schemawijzigingen.

Maak vóór beheermigraties een herstelbaar databaseback-up en controleer het herstelpad. De releasebroker migreert of herstelt geen database automatisch. Een applicatierollback draait geregistreerde gebruikers, scores, outboxjobs, verzonden mail en externe providerconfiguratie niet terug. Na databaseherstel blijft mail gepauzeerd of in Log totdat outbox en providerhistorie zijn gecontroleerd.

## Installatie en bevoegdheden

De hoofdtaak installeert de twee afzonderlijk gerenderde vaste brokers uit `infra/staging/`. Het omgevingsargument van de renderer is een beheerhandeling; de runner kan bij de geïnstalleerde broker geen host/site/repository/service/poort/omgeving kiezen. Controleer het gerenderde manifest en de daadwerkelijke root-owned bestanden, hashes, accountidentiteiten, poorten en sudoers vóór `nativeEnabled: true` voor die omgeving wordt gecommit.

`infra/install-runners.py --apply` is uitsluitend een beoordeelde root-bootstrap op `dg-nxttrack-01`, geen CI-stap. De vooraf aangemaakte runneraccounts hebben een eigen private home en uitsluitend hun eigen groep plus `dg-build`. De installer ontvangt één stdin-JSON met `stagingToken` en `productionToken`; tokens worden niet als argument of bestand doorgegeven. De officiële runnerrelease **2.338.2** wordt tegen SHA256 `baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40` gecontroleerd en als runneraccount uitgepakt. Registratie gebruikt `ACTIONS_RUNNER_INPUT_TOKEN`, vaste repository/naam/labels en `--disableupdate`. De eigen root-owned units `dartflow-actions-staging.service` en `dartflow-actions-production.service` starten de runner uitsluitend als het betreffende runneraccount. Bestaande overeenkomende registratie wordt hergebruikt; andere of onvolledige toestand wordt geweigerd, zonder automatische verwijdering of vervanging. De installer voert geen `svc.sh` als root uit. De [officiële runnercode voor tokeninvoer](https://github.com/actions/runner/blob/v2.338.2/src/Runner.Listener/CommandSettings.cs) is de bron voor dit invoercontract. Installerbron en offline tests bewijzen op zichzelf nog geen registratie of actieve service.

De stagingentry blijft `/usr/local/bin/dg-dartflow-deploy`; productie krijgt `/usr/local/bin/dg-dartflow-production-deploy`. Elke entry pint zijn eigen helperhash. De rootpolicy pint rootgate, extractor en guardian. Alle bron-/installatiebestanden en padcomponenten blijven root-owned en niet overschrijfbaar door runner/build/app. Alleen de eigen digest-/argumentgebonden `deploy`- en `rollback`-helperacties zijn via sudo toegestaan; geen algemene shell, `sudo -E`, systemctl-, Caddy- of file-installrechten voor de runners.

De geïnstalleerde entries, helpers en extractors bevatten alleen programmacode en hebben modus `root:root 0755`. De onprivileged entry moet de helper kunnen lezen om diens digest vóór sudo te controleren; de afzonderlijke builder moet de Python-extractor kunnen lezen. Modus `0700` blokkeert deze controles of de bronextractie. Sudoers blijft `0440`; configuratiebundels en secrets houden hun eigen root-only grens. Publiek leesbare programmacode geeft geen schrijfrecht of algemene sudo-toegang.

De stagingretryadapter wordt geïnstalleerd als `/usr/local/libexec/dartflow-retry-deploy.mjs`; de productiecopy als `/usr/local/libexec/dartflow-production-retry-deploy.mjs`. Die vaste bestandsnamen kiezen uitsluitend hun eigen vaste entry. De native service start rechtstreeks de gepinde Node-binary met `<site>/current/server.js`. Root stelt uitsluitend de eigen Caddy-hostfragmenten in, valideert de volledige configuratie vóór reload en behoudt alle bestaande sites en Milo's route. Log geen Auth-callbacks of schermcapabilities. Verifieer DNS, certificaten en beide HTTPS-origins apart; gebruik geen certificaatbypass.

De bestaande root-owned globale buildlock wordt hergebruikt, niet vervangen. Een gewone release bouwt als eigen buildaccount en krijgt geen appgeheimen. Rechten-/capaciteits-/cgroup-/guardianproeven horen bij de daadwerkelijke hostacceptatie; zie ook `ops/deploy-contract.md` en `infra/staging/GUARDIAN.md`.

De zes Dartflow-UID's worden daarnaast door `dartflow-admin-guard.service` geweigerd op Caddy's beheerpoort 2019 via IPv4- en IPv6-loopback. De guard gebruikt uitsluitend een eigen nftables-tabel; root en Milo blijven buiten de selectie. De twee app- en runnerunits vereisen de geladen guard. Het echte kernelgedrag, de zes geweigerde verbindingen en de behouden toegang voor root/Milo zijn gecontroleerd; een echte reboot van de gedeelde VPS is niet uitgevoerd. Zie `infra/CADDY-ADMIN-GUARD.md` en het afzonderlijke verificatiebewijs.

### Eenmalige v15-hostvoorbereiding

`infra/upgrade-v15-host.py` is een beoordeelde beheerhandeling voor uitsluitend deze host, buiten de CI-/runnerrechten. De operator controleert de bron en rendermanifesten en plaatst ze in een beschermde rootdirectory, bijvoorbeeld `/root/dartflow-v15-reviewed`. `--renders` accepteert alleen een absoluut pad: alle padcomponenten moeten root-owned zijn, zonder symlink en zonder schrijfbevoegdheid voor groep of anderen. Bestanden moeten gewone bestanden met één link zijn. Een directory onder `/tmp` voldoet niet, ook als de laatste directory root-owned is. De upgrader leest begrensde bestanden met symlinkbescherming en vergelijkt de inhoud met het manifest voordat hij reviewed helpercode gebruikt.

Voer eerst de validatie zonder `--apply` uit. Pas daarna kan de operator de eigen brokers/policies, nieuwe immutable configuratiebundels en mailworkerunits installeren. De upgrader gebruikt de bestaande globale buildlock en bewaart eerdere hostbestanden; het waargenomen v15-backuppad staat in [het omgevingenoverzicht](v15-omgevingen.md). Hij weigert een reeds bestaand v15-configuratie-ID. Herhaal de volledige eenmalige toepassing daarom niet voor een losse servicecorrectie; beoordeel en installeer die correctie gericht.

Voor uitsluitend een gereviewde extractorreparatie ondersteunt dezelfde operator `--extractor-only`. Gebruik nieuwe, gecontroleerde renders en valideer eerst zonder `--apply`; de daadwerkelijke toepassing vervangt onder de bestaande globale buildlock alleen beide extractors en hun `extractorSha256` in de eigen beschermde policies. Bestaande digests moeten vooraf overeenkomen. De operator controleert en rapporteert ook de vereiste modus `0755`; identieke bytes met een onleesbare modus worden alsnog gerepareerd. Beide oude bestand-/policypaaren krijgen een back-up en worden bij een opgevangen installatiefout hersteld. Deze gerichte route wijzigt geen configuratiebundel of service. De bronextractor laat alleen `.env.example`, `.env.staging.example` en `.env.production.example` toe; private envbestanden blijven geweigerd.

De root-only mailtick leest het token uit de actieve bundel en roept uitsluitend de eigen loopbackapp aan. Caddy weigert publieke toegang tot `/api/mail/process`; de applicatie controleert loopback en het exacte bearer-token. De tick heeft een HTTP-time-out van 160 seconden en de oneshot-unit `TimeoutStartSec=175`, zodat een begrensde batch van tien providerpogingen kan eindigen. De timer wacht na voltooiing van een tick, zodat een trage batch geen overlappende ticks start. Activeer `dartflow-mail-staging.timer` respectievelijk `dartflow-mail-production.timer` pas na verificatie van de eigen v15-app; controleer daarna unitstatus en wachtrij. Logmodus veroorzaakt geen externe bezorging.

De native coturn-services gebruiken afzonderlijke secrets en quota: staging luistert op UDP/TCP `3478` en gebruikt UDP-relaypoorten `49160–49179`; productie gebruikt `3479` en `49180–49199`. De actuele status staat in [v15-omgevingen.md](v15-omgevingen.md). Voor provisioning op deze vaste host moeten de gereviewde `infra/provision-media.py` en de aangrenzende `infra/turn-peer-guard.py` samen in een beschermde rootdirectory staan. Beide bestanden en alle bovenliggende directories moeten root-owned zijn, zonder symlinks of schrijfrechten voor groep/anderen. De provisioner installeert de helper als root-only `0700` onder `/usr/local/libexec/`, met een beschermde parentdirectory `0755`, en controleert of nftables beschikbaar is. Hij stopt bestaande eigen TURN-units vóór een configuratiewijziging die verkeer naar het eigen publieke IP mogelijk maakt; daarna start hij ze met de verplichte guard. Wijzig geen bestaande toepassingen of hun firewallregels.

Iedere TURN-unit voert eerst `ExecStartPre=+/usr/local/libexec/dg-turn-peer-guard.py <omgeving>` uit. De helper accepteert uitsluitend de actuele eigen cgroup `/system.slice/dg-turn-<omgeving>.service` en vervangt atomair alleen zijn eigen nftables-tabel. Naar het eigen publieke IP `128.140.93.95` is uitsluitend UDP toegestaan met zowel bron- als doelpoort binnen de eigen relayreeks. Andere eigen hostpoorten en de relayreeks van de andere omgeving krijgen een kernel-`DROP`. Een fout verhindert de servicestart; na iedere herstart wordt de nieuwe cgroupbinding opnieuw gecontroleerd. De private IPv4-/loopbackdenials, de uitsluiting van IPv6-sockets en `IPAddressDeny=::/0` blijven actief. `no-tcp-relay` blijft ingesteld; TCP als clientverbinding naar TURN is wel beschikbaar.

Controleer na startup of herstart de werkelijk geladen regels en huidige cgroupbinding zonder iets te wijzigen:

```bash
sudo -n /usr/local/libexec/dg-turn-peer-guard.py --inspect staging
sudo -n /usr/local/libexec/dg-turn-peer-guard.py --inspect production
```

Beide controles moeten succesvol eindigen met `installed: true`, `serviceCgroupBound: true` en de eigen bron-/doelpoortreeks. De uitvoer bevat ook de actuele cgroup-ID en tellers voor toegestaan relayverkeer en geweigerd eigen hostverkeer. Het [installatiebewijs van de guard](evidence/v15-turn-guard-install-2026-11-11.json) bevat tevens de vernieuwde stagingbinding na een herstart. Activiteit en tellers alleen bewijzen geen publieke mediaverbinding. De [geslaagde externe workerproef](evidence/v15-turn-guarded-public-2026-11-11.json) bewijst voor beide omgevingen geauthenticeerde UDP-/TCP-clientverbindingen, relayverkeer in beide richtingen, twee relayclients op dezelfde host en de poortgrenzen. Hostlokale TURN-controlproeven vallen bewust buiten de uitzondering. De fysieke WebRTC-pilot met echte browsers, camera's en deelnemers via onafhankelijke netwerken blijft afzonderlijk acceptatiebewijs.

De optionele liveproef is `python3 -B tests/turn-relay-live.py --run-target --run-guarded-relay` vanaf de vastgelegde worker. Elke verboden UDP-doelpoort gebruikt een eigen TCP-controlverbinding, die na de proef wordt gesloten: coturn sluit de relay na een kernelweigering, terwijl een opruimantwoord de quota niet onmiddellijk vrijgeeft. De IPv6-weigeringsproeven staan daarom als laatste; antwoord 437 bewijst uitsluitend dat geen allocatie bestaat. De uitgevoerde [proefopruiming](evidence/v15-turn-probe-cleanup-2026-11-11.json) heeft vervolgens onder de bestaande buildlock, zonder actieve eigen relaypoorten, alleen beide TURN-units herstart en hun nieuwe cgroupbinding gecontroleerd. Het [hostbewijs na de proeven](evidence/v15-post-turn-host-2026-11-11.json) bevestigt daarnaast de gezonde apps en mailtimer.

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

## Historische v15 Auth-acceptatie

Staging draait bron `e8317d22fcb7c4d1150962c94d18454af2f4a69b`, release `43074167296-1`, met configuratie `staging-2026-11-11-v15-mail-1`. [CI 43073501502](evidence/v15-reauth-ci-2026-11-11.json) is groen met 104 applicatie-, 46 prototype-, 57 native-deployer- en acht browsertests; [deploy 43074167296](evidence/v15-reauth-staging-deploy-2026-11-11.json) is geslaagd. Publieke en loopback-health/ready bevestigen dezelfde identiteit; productie en Milo behouden hun bron, release, PID en servicestarttijd.

Staging gebruikt callback `https://staging.dartflow.nl/auth/callback`; productie `https://dartflow.nl/auth/callback`, elk in het eigen Supabase Auth-project en met de eigen Site URL. Google gebruikt de door dat project getoonde `/auth/v1/callback`; SMTP/providersecrets blijven in dat project. Volg [de integratiewerkinstructie](v15-integraties.md) eerst voor de echte eigenaar-OTP en daarna voor Google, Resend en een ondertekende webhook. Google uitschakelen vraagt naast recente eigenaarautorisatie een door Supabase geverifieerde OTP-aanmelding van maximaal vijftien minuten oud en een ingeschakelde e-mailprovider. Een tokenrefresh of profielveld levert dat bewijs niet.

Op 11 november 2026 meldt de gebruiker Google-login als werkend. Na herstel van de Supabase URL-instellingen bevestigt [de effectieve redirectcontrole](evidence/v15-auth-redirect-corrected-2026-11-11.json) voor beide projecten de juiste Site URL en appcallback. De proef met een synthetisch ongeldig token volgt geen redirect en bewijst geen echte login. De [eerdere redirectproef](evidence/v15-google-redirects-2026-11-11.json) blijft historisch bewijs van aangevraagde doelen en Google-projectcallbacks; de [providercontrole](evidence/v15-provider-readiness-2026-11-11.json) bevestigt ingeschakelde providers.

De [nieuwe eigenaarsdiagnose op staging](evidence/v15-reauth-diagnosis-2026-11-11.json) bevestigt voor `info@dgwebservices.nl` één eigenaarrol en een OTP-sessie. De [eerdere nulrollencontrole](evidence/v15-owner-auth-readiness-2026-11-11.json) blijft historisch. De waargenomen authenticatie was circa twintig minuten oud en viel buiten de beheertermijn van vijftien minuten. Het [UI-herstel voor nieuwe authenticatie is live](evidence/v15-reauth-public-ui-2026-11-11.json), met vier geslaagde publieke presentatieproeven zonder echte authenticatie; de servertermijn blijft intact.

De gemelde Auth-mail gebruikt de standaard bevestigingslink zonder zichtbare OTP-code. De templates `supabase/templates/confirm-signup.html` en `supabase/templates/magic-link.html` zijn gereviewd en gereed; de plaatsing in Supabase is nog niet bevestigd. De verduidelijkte code-invoer en hulptekst zijn nu op staging uitgerold; de invoeracceptatie blijft 6–10 cijfers. De [browsercontrole met fixtures](evidence/v15-auth-ui-browser-2026-11-11.json) slaagt op 320/390 px, zonder echte Auth-aanvraag of OTP-verificatie. Toepassen van Auth-templates gebeurt afzonderlijk via het projectgebonden Management-beheerpad of Supabase Dashboard. Het verandert de actieve applicatierelease niet.

Een nieuwe beheerbevestiging, Google-login met de aangewezen eigenaar en Resend-appmail met ondertekende bezorgwebhook blijven **Open**. De stagingmetadata bevat nog geen aparte Resend-appsleutel of webhookcredential. Management-tokens ontbreken in beide omgevingen; Supabase SMTP/templatebeheer vraagt daarom afzonderlijke Dashboard-handelingen. Er is geen SMTP-wijziging door de worker bewezen. Health/readiness bewijst appidentiteit en backendgereedheid. Test daarnaast club-/rolgrenzen, wedstrijdstart, score, herladen, retry, uitslag en cameramedia tussen twee echte gebruikers. Publieke `DARTFLOW_DATA_MODE=local` blijft verboden.

Het acceptatierapport onderscheidt code-/CI-bewijs, daadwerkelijke hostinstallatie, actieve HTTPS-release, echte gebruikersflow en herstelbewijs. Alleen werkelijk uitgevoerde controles krijgen Pass; configuratievoorbereiding of een groen artifact maakt geen omgeving geaccepteerd.
