# Twee vaste native brokers

`render-deployer.py` produceert afzonderlijke, beoordeelbare copies. Er is geen installatie, hostmutatie of runtimekeuze van omgeving, site, repository, service of poort. Beide brokers accepteren uitsluitend `deploy <sha40> <run-id>-<attempt> <config-id>` en `rollback <bekende-release-id>`; deploymentcredentials komen uitsluitend via JSON-stdin.

```sh
python3 -I infra/staging/render-deployer.py --environment staging --output /tmp/dartflow-staging-render
python3 -I infra/staging/render-deployer.py --environment production --output /tmp/dartflow-production-render
```

De bovenliggende uitvoermap moet bestaan; de rendermap zelf moet nieuw zijn. De uitvoer spiegelt absolute installatiepaden. `manifest.json` bevat iedere bestandsdigest en de vaste identiteit. Review beide renders vóór installatie, inclusief de gerenderde helperdigest in entry en sudoers. De gatebron mag na rendering niet worden veranderd zonder opnieuw renderen en reviewen.

| Onderdeel | Staging | Production |
| --- | --- | --- |
| Site/service | `dartflow-staging` | `dartflow-production` |
| Origin | `https://staging.dartflow.nl` | `https://dartflow.nl` |
| Loopbackpoort | `4174` | `4175` |
| Accounts | `run-dart-stg`, `build-dart-stg`, `app-dart-stg` | `run-dart-prd`, `build-dart-prd`, `app-dart-prd` |
| Entry onder `/usr/local/bin/` | `dg-dartflow-deploy` | `dg-dartflow-production-deploy` |
| Helper onder `/usr/local/libexec/` | `dg-dartflow-deploy-helper` | `dg-dartflow-production-deploy-helper` |
| Extractor onder `/usr/local/libexec/` | `dartflow-extract-source.py` | `dartflow-production-extract-source.py` |
| Gate onder `/usr/local/libexec/` | `dartflow-release-gate.mjs` | `dartflow-production-release-gate.mjs` |
| Guardian onder `/usr/local/libexec/` | `dartflow-lock-guardian.py` | `dartflow-production-lock-guardian.py` |
| Deployworkflow | `deploy-staging.yml` | `deploy-production.yml` |
| Supabase-project | `dsnqnvbckkqpzadblshu` | `wlrnowuownakqqgjxnbb` |
| Transient units | `dg-dartflow-staging-{build,lock}-…` | `dg-dartflow-production-{build,lock}-…` |

Beide zijn vast gebonden aan host `dg-nxttrack-01`, repository `dartflow/platform` en integration branch `main`. De rootpolicy moet deze identiteit, de omgevingspoort en het eigen backendproject exact bevestigen. De andere omgeving en Milo mogen geen UID/GID of aanvullende groepen delen met de drie eigen accounts. De bestaande gedeelde lock blijft `/run/lock/dg-build.lock`; de eigen sitelock is `/run/lock/<site>.deploy.lock`. Een gelijke GitHub-runidentiteit tussen omgevingen veroorzaakt hierdoor geen systemd-unitcollision.

Installeer reviewed executables als root:root `0755`, servicefiles `0644`, sudoers `0440` en de ingevulde `deploy.json` `0600` onder niet schrijfbare root-owned ouders. Renderbestanden zijn conservatief `0700`/`0600`; kopieer de rendermap niet blind over `/`. `deploy.example.json` blijft onuitvoerbaar totdat echte host-UID/GID en expliciete `allowedConfigIds` zijn ingevuld. De gerenderde toolchain is Node `24.18.0`, npm `11.16.0`; npm wijst naar de geverifieerde absolute `npm-cli.js` binnen die Node-installatie. Verifieer versies en root-only schrijfbaarheid opnieuw op de host. Valideer de daadwerkelijke sudoers met `visudo -cf` vóór installatie.

De service gebruikt uitsluitend voor de eigen app `NODE_EXTRA_CA_CERTS=/usr/local/share/dg-certificates/supabase-prod-ca-bundle.crt`. Dit is publieke, gepinde root-owned infrastructuur (`0644`, ouders `0755`), geen runtimecredential en geen globale Node-/Milo-wijziging. Bootstrap moet de officiële Supabase CLI CA-bundle (2021 + 2025) verifiëren: `2738` bytes, SHA256 `6ecd239038a7db063a6619b71742372ecfe06c0b0ec12a9993fee4445bf0d4d6`. De database-URL blijft uitsluitend `sslmode=verify-full` toestaan.

# Expliciete hostproef

De shared proof-executable `/usr/local/libexec/dartflow-probe-lock-lifetime.py` staat in beide manifests met dezelfde digest. Installeer root:root `0755`; er komt geen sudo-regel voor de runner bij. Alleen een bevoegde rootbeheerder voert hem expliciet uit nadat beide eigen policy/accounts/locks/toolchain/guardian zijn geïnstalleerd en voordat native deployment wordt vrijgegeven:

```sh
sudo -n /usr/bin/python3 -I /usr/local/libexec/dartflow-probe-lock-lifetime.py --environment staging
sudo -n /usr/bin/python3 -I /usr/local/libexec/dartflow-probe-lock-lifetime.py --environment production
```

De proef weigert een andere host, onbetrouwbare script-/helperpaden en een niet voor FD-behoud beoordeelde systemd-versie buiten `255`. Hij leest geen configbundles, tokens of databasecredentials. Hij gebruikt de echte gedeelde en eigen sitelock; voer hem uit wanneer geen andere build loopt. Iedere omgeving krijgt drie begrensde scenario's:

1. Een echte tijdelijke builderunit zonder lockdescriptors; daarna harde dood van de helper én de buildclient. De guardian moet beide bestaande OFDs vasthouden totdat de build daadwerkelijk is gestopt. Een vaste korte `ExecStop` maakt de cleanup observeerbaar.
2. Een echte vertraagde `systemd-run --wait`-client, gestart vóór helperdood maar met de D-Busrequest pas erna. Beide locks moeten afzonderlijk bezet blijven tot de echte builderunit eindigt; de builder controleert `/proc/self/fd` op beide lockinodes.
3. Hetzelfde met een echte synchrone `systemctl restart`-client tegen uitsluitend een eigen tijdelijke `<site>-fd-proof-…service`. De proef observeert de echte managerjob, houdt beide locks vast tot de client eindigt en controleert dat de opnieuw gestarte onprivileged worker geen lockdescriptors kreeg.

De echte appservice en Milo worden nooit herstart of gestopt door deze proef. Cleanup raakt uitsluitend de vaste eigen proof-/buildunits van de gekozen proof-run. Alle subprocessen en controles zijn begrensd. Alleen volledige JSON-uitvoer met `status: passed` en drie geslaagde scenario's sluit deze hostproef af. De workdirs `fd-proof-…` onder de eigen buildroot blijven als kleine, niet geheime evidence behouden. Bij een mislukking: geen deployment vrijgeven; inspecteer units, jobs en guardian volgens `GUARDIAN.md`. Een onzekere guardian houdt de locks vast; verwijder of vervang lockfiles nooit om dat te omzeilen.
