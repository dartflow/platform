# Dartflow doelhost: alleen-lezen inventaris

Waargenomen op **11 november 2026, 03:07–03:12 CET**, vanaf `codex-worker-01` en de bestaande Milo-runner. De hoofdtaak heeft de bestaande alleen-lezen inspectieworkflow gestart; die is geslaagd. Er zijn geen doelhost-, DNS-, account-, service- of GitHub-configuratiewijzigingen uitgevoerd. Er zijn geen private keys of geheime configuratiewaarden uitgelezen. De workflowlogs zijn uitsluitend via een allowlist van host-/proces-/bestandssysteemmetadata samengevat; de ruwe logs zijn niet in deze documentatie opgenomen.

## Actueel bevestigd: netwerk, toegang en Milo vóór wijzigingen

| Onderdeel | Waarneming |
|---|---|
| Doelpeer | Actuele Tailscale-netmap: `dg-nxttrack-01`, Linux, online |
| Beheeradres | `100.111.66.17`; MagicDNS `dg-nxttrack-01.tail4ca740.ts.net` |
| Tailscale-bereikbaarheid | `tailscale ping --c=1 --timeout=5s dg-nxttrack-01`: pong via directe IPv6 `2a01:4f8:c015:60a6::1`, circa 38 ms |
| Lokale beheerconfiguratie | Geen `/home/codex/.ssh/config`, geen private sleutelfiles in die directory, geen bruikbare SSH-agent; directory `codex:codex 0700`, `known_hosts` `codex:codex 0600` |
| Bestaande hostkey | `known_hosts` heeft voor `dg-nxttrack-01` ED25519 fingerprint `SHA256:rPmgt1Uvwb5/mSibtVL6mbomRuP9uxdGG0MIvYlUKTc` |
| OpenSSH-toegang | `ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=6 dgadmin@dg-nxttrack-01 …` én dezelfde uitsluitend-lezen proef als `root`: `Permission denied (publickey)` |
| Tailscale SSH | Bestaande wrapper geprobeerd zonder wijzigingen: weigert omdat geen ED25519-hostkey voor de FQDN wordt geadverteerd. Strikte hostkeycontrole is behouden |
| Milo HTTPS | `https://milo-staging.dgwebservices.nl`: HTTP `200`, TLS-verificatie `0`, werkelijk remote IPv4 `128.140.93.95` |
| Milo health | `/api/health`: HTTP `200`; JSON hieronder |
| Milo via onafhankelijk IPv6-pad | `curl --resolve milo-staging.dgwebservices.nl:443:[2a01:4f8:c015:60a6::1] …/api/health`: HTTP `200`, TLS-verificatie `0`, dezelfde volledige release-identiteit |
| Milo via vast IPv4-pad | Dezelfde controle met `--resolve …:128.140.93.95`: HTTP `200`, TLS-verificatie `0`, dezelfde volledige release-identiteit |
| Actuele Milo-servicestatus | Later via de bestaande readonly-runnerjob bevestigd: `loaded`, `active`, `enabled`, eigen account `app-mil-stg`. De werkelijke `current`-symlink/configfile is daarmee nog niet opnieuw uitgelezen of gestat |

Actueel publieke Milo-health, vóór enige Dartflow-hostwijziging:

```json
{
  "status": "ok",
  "revision": "729d962b7401b100ce9cacb94ce4e4da16a699f2",
  "releaseId": "42804436092-1",
  "configVersion": "staging-2026-11-05-v1",
  "checks": ["http"]
}
```

Deze identiteit stemt overeen met de bestaande lokale Milo-bron `docs/STAGING-RESULTAAT.md`. Het oudere `verification/staging-release.json` van 5 november beschrijft een vroegere release en is geen actuele hostmeting.

## Actuele hostmeting via de bestaande readonly-workflow

Bewijs: **[Inspect Milo staging — run 42943887248](https://github.com/milobingo/platform/actions/runs/42943887248)**, poging 1, `completed/success`. Gestart vanaf `main` op exacte workflowbron `67e1039a270488601c5e010da4eb25b1c7619812`. De inspectiejob liep van **02:08:16 tot 02:08:22 UTC** (03:08:16–03:08:22 CET). De hoofdtaak heeft de workflowbron vooraf beoordeeld; de job verricht geen releaseactivatie. De CLI heeft de logs alleen in geheugen gelezen en met expliciet toegestane metadatapatronen gefilterd.

| Onderdeel | Actueel waargenomen in run 42943887248 |
|---|---|
| Werkelijke host | `dg-nxttrack-01` |
| Runnernaam | `dg-nxttrack-01-nxttrack-staging` |
| Geselecteerde runnerlabels | `self-hosted`, `Linux`, `X64`, `dg-nxttrack-01`, `milobingo`, `staging` |
| Effectieve runneridentiteit | `run-mil-stg`, UID `1001`, primaire GID `1002`, aanvullend `dg-build` GID `1001` |
| Workspace / runnerwerkdirectory | `/home/run-mil-stg/_work/platform/platform`; `/home/run-mil-stg/_work` |
| Filesystem voor workspace en `/srv` | Beide `/dev/sda1`, mount `/`; totaal `160921083904` bytes, gebruikt `11196203008`, beschikbaar **`143154114560` bytes (133,32 GiB)**; gerapporteerd gebruik `8%` |
| Inodes voor beide locaties | Totaal `9888528`, gebruikt `145444`, vrij **`9743084`**; gerapporteerd gebruik `2%` |
| Siteroot | `/srv/sites/milobingo-staging`, `root:app-mil-stg`, `0750` |
| Bovenliggende project/configdirectories | `/srv/sites` `root:root 0755`; `/etc/dg-sites` `root:root 0700`; `/etc/caddy` en `/etc/caddy/sites` `root:root 0755` |
| Milo-appaccount | `app-mil-stg`, UID `996`, primaire GID `987`, home `/srv/sites/milobingo-staging`, shell `/usr/sbin/nologin` |
| Milo-service | `milobingo-staging.service`, `enabled`, `LoadState=loaded`, `ActiveState=active`; unit `/etc/systemd/system/milobingo-staging.service` |
| Milo-servicecontract | `User=app-mil-stg`, `Group=app-mil-stg`; werkmap `/srv/sites/milobingo-staging/current/.next/standalone`; `EnvironmentFiles=/srv/sites/milobingo-staging/current/.runtime.env (ignore_errors=no)` |
| Alternatieve servicenaam | `milo-staging.service`: `not-found/inactive`; dit is geen fout van de werkelijk aanwezige `milobingo-staging.service` |
| Caddy-service | `loaded/active`, unit `/usr/lib/systemd/system/caddy.service` |
| Zichtbare Caddybestanden | `/etc/caddy/Caddyfile` en `/etc/caddy/sites/milobingo-staging.caddy`; het laatste bevat op regel 4 de Milo-hostmatcher |
| Geïnstalleerde wrapper | `/usr/local/bin/dg-site-deploy`, `root:root 0755`, 3054 bytes; actuele SHA-256 **`aee3e1e2e76f05d99f668ed7c756802da82033c4983216b90d7ea50de9f49bc7`** |
| Werkelijke beperkte sudo-policy | Eén toegestane helper: `/usr/local/libexec/dg-milobingo-deploy-helper`, gepind op SHA-256 `ce93bfeffa573616394d1f28dc5dd101bc7e0ce076b7bf25b35a38827ed9aba8`, uitsluitend vaste site/workspace en volledige SHA/run-ID-poging-regex; geen algemene shell/systemctl-regel aangetroffen in deze policy-output |
| Toollocaties | `node=/usr/local/bin/node`, `pnpm=/usr/local/bin/pnpm`, PostgreSQL-clients onder `/usr/bin`, `caddy=/usr/bin/caddy`; tevens native Node-binary `/opt/node-v24.18.0-linux-x64/bin/node` gevonden |
| Milo-listener | Uitsluitend **`127.0.0.1:4173`** voor de app in het volledige `ss -ltn`-overzicht |
| Overige TCP-listeners | DNS `127.0.0.53:53`/`127.0.0.54:53`, Caddy-admin `127.0.0.1:2019`, Tailscale-adressen op poorten `55418` en `46115`, SSH `0.0.0.0:22` en `[::]:22`, publiek `*:80` en `*:443` |

De volledige socketlijst toont op dit meetmoment geen andere loopback-applistener. Dit reserveert nog geen Dartflow-poort en controleert geen afzonderlijk siteregister. Publieke SSH-listeners zeggen evenmin dat publieke SSH-ingress door de provider-/hostfirewall wordt toegelaten; die netwerkpolicy is niet door deze workflow gemeten.

De job meet **geen** RAM/CPU, Node/npm-/Caddy-versienummers, daadwerkelijke helperinhoud/-eigendom, `current`-linkdoel, runtime-envbestandmetadata, de lockfile-eigenaar/-modus of daadwerkelijke lockbezetting. De helperdigest hierboven is in de sudo-policy waargenomen; hij is niet in deze run opnieuw over het helperbestand berekend. Dit blijft te onderscheiden van de wel opnieuw gehashte entry.

De vóór-wijzigingenbaseline van Milo bestaat nu uit de publieke healthidentiteit hierboven **én** het actieve/eigen servicecontract en de loopbacklistener uit deze inspectie. Na eventuele Dartflow-hostwijzigingen moeten dezelfde controles opnieuw worden uitgevoerd en moet Milo dezelfde gezonde identiteit behouden, tenzij een afzonderlijke geautoriseerde Milo-release plaatsvindt.

### Nameting: Milo ongewijzigd gezond

De bestaande readonly-workflow is opnieuw succesvol uitgevoerd: **[Inspect Milo staging 42945932719](https://github.com/milobingo/platform/actions/runs/42945932719)**, poging 1, `completed/success`, dezelfde workflowbron `67e1039a270488601c5e010da4eb25b1c7619812`. De job liep **11 november 2026, 03:25:37–03:25:42 CET** (`02:25:37–02:25:42Z`). De service bleef actief als `app-mil-stg`, met dezelfde standalonewerkmap en runtime-envroute; Caddy bleef actief en `127.0.0.1:4173` bleef de Milo-listener. De entryhash bleef `aee3e1e2e76f05d99f668ed7c756802da82033c4983216b90d7ea50de9f49bc7`.

De vrije ruimte bedroeg toen **`143154008064` bytes**, met **`9743083` vrije inodes**. Publiek Milo-HTTPS gaf bij de nacontrole HTTP **200**, TLS-verificatie **0**, remote IPv4 `128.140.93.95` en dezelfde revision `729d962b7401b100ce9cacb94ce4e4da16a699f2`, release `42804436092-1`, config `staging-2026-11-05-v1`. Er zijn geen Milo-/doelhostconfiguraties gewijzigd. Dit bewijst ongewijzigde HTTP-/release-/servicegezondheid binnen het meetbereik, geen nieuwe volledige Milo-gebruikersflow. Dartflows A/AAAA bleven bij de nacontrole naar de verkeerde ingress wijzen en de eigen TLS-hostnaamcontrole bleef falen.

## Actueel bevestigd: DNS en HTTPS van Dartflow

| Naam / type | Huidig resultaat |
|---|---|
| `staging.dartflow.nl A` | `185.151.30.138` |
| `staging.dartflow.nl AAAA` | `2a07:7800::138` |
| `milo-staging.dgwebservices.nl A` | `128.140.93.95` |
| `milo-staging.dgwebservices.nl AAAA` | Geen antwoord bij de meting |
| Dartflow HTTPS | TLS-fout `60`: certificaat bevat `staging.dartflow.nl` niet; HTTP-status `000`; remote IPv6 `2a07:7800::138` |

De huidige Dartflow-records verwijzen naar een ander ingressadres. Voor een gecontroleerde aansluiting zijn de **werkelijk via geldige Milo-HTTPS gecontroleerde** ingressadressen beschikbaar: IPv4 `128.140.93.95` en IPv6 `2a01:4f8:c015:60a6::1`. De DNS-hercontrole rond 03:11 CET bevestigde de bovenstaande A/AAAA-waarden opnieuw, met resterende cache-TTL circa `3308` seconden. Er is tijdens deze inventaris niets aan DNS gewijzigd.

Exacte benodigde wijziging, **nadat** het eigen Caddy-fragment op de doelhost is ingericht en gevalideerd:

| DNS-record | Wijziging |
|---|---|
| `staging.dartflow.nl A` | Vervang `185.151.30.138` door **`128.140.93.95`** |
| `staging.dartflow.nl AAAA`, bij dual stack | Vervang `2a07:7800::138` door **`2a01:4f8:c015:60a6::1`**, en controleer Dartflows eigen HTTPS/health/readiness ook via IPv6 |
| `staging.dartflow.nl AAAA`, bij IPv4-only aansluiting | Verwijder het huidige foutieve AAAA-record; laat het niet naar de oude host wijzen |

Wijzig alleen de bedoelde stagingrecords. Het doeladres is onafhankelijk door geldige HTTPS op Milo's bestaande hostnaam bevestigd; dat bewijst nog geen certificaat of bruikbare app voor Dartflows nieuwe hostnaam. Controleer na DNS-propagatie TLS-hostnaam, A én eventuele AAAA, en de exacte Dartflow-health/readiness zonder een certificaatfout te negeren.

## Concrete bronreferenties en aanvullende historische gegevens

De lokale Milo-checkout `/home/codex/repos/milobingo` is schoon en staat op `67e1039a270488601c5e010da4eb25b1c7619812`. Relevante bestaande bronnen zijn:

- `docs/STAGING-HOST.md`, `docs/STAGING-NATIVE-WRAPPER.md`, `docs/STAGING-DEPLOY.md` en `docs/DG-Webservices-Masterprompt-Bouw-en-Deploy.txt`;
- `.github/workflows/staging-preflight.yml` (**Inspect Milo staging**) en `.github/workflows/deploy-staging.yml`;
- `infra/staging/deploy-entry.py`, `infra/staging/deploy-helper.py`, service- en Caddyvoorbeelden;
- `verification/simple-show/staging-gates.json`, gemeten op 10 november 2026 `11:08:02Z`;
- `docs/STAGING-RESULTAAT.md`, dat de actuele publiek teruggelezen release vermeldt.

De lokale `dg-ops-control`-repository is fixture-first en levert geen bestaande geautoriseerde live SSH-gateway voor deze host. De relevante AGENTS-instructies en documentatie zijn gelezen; er is in die repository niets gewijzigd.

Onderstaande gegevens zijn **historisch vastgelegd door Milo en moeten vóór hostinrichting opnieuw op de werkelijke host worden gemeten**:

| Onderdeel | Bestaande broninformatie |
|---|---|
| Host / OS | `dg-nxttrack-01`, Ubuntu 24.04 x86_64 |
| Milo-runnernaam | `dg-nxttrack-01-nxttrack-staging` |
| Milo-runnerlabels | `self-hosted`, `Linux`, `X64`, `dg-milobingo-01`, `dg-nxttrack-01`, `milobingo`, `staging` |
| Milo-runner | `run-mil-stg`, UID 1001, primaire GID 1002, aanvullend `dg-build` GID 1001 |
| Milo-checkout | `/home/run-mil-stg/_work/platform/platform` |
| Milo-buildaccount | `build-mil-stg`, UID 990, eigen primaire GID 983, geen aanvullende groepen |
| Milo-appaccount | `app-mil-stg`, UID 996, GID 987 |
| Site / service / poort | `/srv/sites/milobingo-staging`, `milobingo-staging.service`, uitsluitend `127.0.0.1:4173` |
| Site-eigendom | Root/appgroep; siteroot en releases `0750`; verzegelde artifactdirectories `0550`, files `0440` of `0550` |
| Runtimeconfiguratie | `/etc/dg-sites/milobingo-staging.runtime.d/<release>.env`, root-only directory `0700`, files `0600`; `.runtime.env` per release is een symlink, gekoppeld aan `current` |
| Appservice | Absolute Node-binary; werkmap `current/.next/standalone`; eigen appidentiteit; readonly appboom; alleen `shared` expliciet schrijfbaar |
| Node | `/opt/node-v24.18.0-linux-x64/bin/node`, versie `24.18.0` |
| Milo-package manager | pnpm `11.25.0`; **niet hergebruiken als Dartflows npm-contract** |
| npm / Caddy-versie | Niet actueel gemeten; vereist vóór Dartflow-installatie |
| PostgreSQL-clienttools | Historisch `17.11` onder `/usr/lib/postgresql/17/bin` |
| Buildroot | `/var/lib/dg-build/milobingo-staging`, root/buildgroep `0710` |
| Caddy-import | Bestaande `/etc/caddy/sites/*.caddy`-include; eigen Milo-fragment behouden |
| Bestaande wrapper | `/usr/local/bin/dg-site-deploy`, root:root `0755`; vaste Milo-site/caller/workspace |
| Bestaande helper | `/usr/local/libexec/dg-milobingo-deploy-helper`, root:root `0755` |
| Sudoers | `/etc/sudoers.d/milobingo-staging-deploy`, root:root `0440`; beperkte helperdigest en vaste argumentgrens, geen algemene shell/systemctl |
| Gedeelde lock | `/run/lock/dg-build.lock`, root:`dg-build`, `0660`, nonblocking exclusieve lock |
| Capaciteitsgrens | Historische helpergrens minstens 4 GiB en 50.000 vrije inodes vóór build, artifactomvang bovenop kopieerbudget; actuele bytes/inodes staan in de readonly-runmeting hierboven |
| Tijdelijke oude beheerrechten | Milo-documentatie bevestigt dat taakgebonden root-/beheer-SSH op 5 november is ingetrokken en de private sleutels zijn verwijderd |

De bewaarde hostgate van **10 november** rapporteert wrapperhash `aee3e1e2e76f05d99f668ed7c756802da82033c4983216b90d7ea50de9f49bc7` en helperhash `ce93bfeffa573616394d1f28dc5dd101bc7e0ce076b7bf25b35a38827ed9aba8`. De actuele lokale helperbron heeft dezelfde SHA-256. De readonly-run van **11 november** heeft de geïnstalleerde entry opnieuw gehasht en deze entryhash bevestigd; de helperhash is daar alleen als sudo-commandodigest waargenomen. De lokale entrybron bevat een niet-gerenderde helperplaceholder en heeft daarom een andere hash dan de geïnstalleerde gerenderde entry.

## Broninspectie: wrapper en lockgedrag

De bestaande Milo-ingang accepteert uitsluitend:

```text
/usr/local/bin/dg-site-deploy milobingo-staging /home/run-mil-stg/_work/platform/platform <volledige-SHA> <run-ID>-<poging>
```

De helper controleert host/caller, vaste parameters, root-owned toolchainpaden en begrensde runtime-JSON via stdin. Git-archivering draait als runner; uitpakken, package-installatiescripts en build draaien als afzonderlijk buildaccount in tijdelijke begrensde systemd-units. Runtimecredentials gaan niet naar dat buildaccount.

De bron opent `/run/lock/dg-build.lock` met `O_NOFOLLOW`, controleert type, root-eigenaar, linkaantal en veilige groepsrechten, en gebruikt `fcntl.flock(LOCK_EX | LOCK_NB)`. De lock staat om `deploy()` heen en blijft dus ook tijdens activatie vast. De bestaande Milo-helper heeft **geen wachtrij**. Zijn algemene exceptionpad gebruikt exitcode `1` en onderscheidt lockconflict niet van een andere fout. Behoud die Milo-route; Dartflows afzonderlijke ingang moet een herkenbare eigen lockconflictcode bieden wanneer begrensde alleen-lock-retries worden toegevoegd. Een algemene Milo-foutcode `1` opnieuw proberen zou ook mislukte activaties kunnen herhalen.

Een Dartflow-loopbackpoort, eigen accounts, runnerlabels, sitepaden, servicenaam, sudo-grens en site-activatielock zijn **nog niet op de doelhost vastgesteld of aangemaakt**. Poort `4173` blijft voor Milo. Geen alternatieve poort is als vrij geclaimd.

## Open toegangs- en uitvoeringspoort

Voor rechtstreekse inventarisatie en hostinrichting ontbreekt een geldige beheerauthenticatie voor `dg-nxttrack-01`. Het netwerk en de bestaande hostkey zijn beschikbaar; `dgadmin` en `root` accepteren deze werkomgeving niet met de aanwezige middelen. Er is geen interactieve login, nieuwe sleutelregistratie, hostkeyversoepeling, algemene sudo-uitzondering of SSH-policywijziging uitgevoerd.

Het bestaande, beperktere **alleen-lezen** alternatief is inmiddels succesvol gebruikt: **Inspect Milo staging**, run [42943887248](https://github.com/milobingo/platform/actions/runs/42943887248). De hoofdtaak heeft die workflow gestart en de resultaten hierboven zijn uit zijn geslaagde inspectiejob samengevat. De job controleert dedicated runneridentiteit en leest service-, socket-, entry-, pad-, sudo-policy- en bytes/inodemetadata. Hij verleent geen hostbootstraprechten en maakt een Dartflow-deployingang niet vanzelf beschikbaar.

Totdat de beheerpoort is opgelost, blijven onder meer `current`/config-bestandsmetadata, buildaccountidentiteit, Caddy-importinhoud en versie, volledige toolchainversies, geheugen-/CPU-budget, lockeigendom/-bezetting en toekomstige Dartflow-account-/service-/runnerregistratie **nog rechtstreeks te meten of in te richten**. De service, volledige TCP-socketlijst, runneridentiteit, sudo-policy, entryhash en vrije bytes/inodes zijn wel actueel via de runner gemeten. Publieke Milo-HTTPS blijft beschikbaar en kan vóór/na elke later geautoriseerde handeling met bovenstaande exacte identiteit worden vergeleken.
