# Vaste hostbootstrap voor Dartflow

`bootstrap-host.py` installeert uitsluitend de twee vaste Dartflow-omgevingen op `dg-nxttrack-01`. Het script is lokaal voorbereid; het uitvoeren is een afzonderlijke rootbeheerhandeling. Zonder `--apply` wordt alleen een plan geprint. Een plan bewijst geen hostinstallatie.

## Invoer en review

Render beide varianten met het afzonderlijk beoordeelde `infra/staging/render-deployer.py`. De uitvoer bevat vaste absolute doelpaden onder een nieuwe rendermap, een digest per bestand en `manifest.json`.

```sh
python3 -I infra/staging/render-deployer.py --environment staging --output /review/staging
python3 -I infra/staging/render-deployer.py --environment production --output /review/production
```

Controleer broncode, renders, systeemd-units, sudoers en manifestdigests voordat root ze ontvangt. Plaats de beoordeelde renders op de doelhost onder een root-owned directory zoals `/root/dartflow-reviewed/`; alle bovenliggende mappen moeten root-owned en niet schrijfbaar door andere accounts zijn. Een rendermap onder een gebruikershome of `/tmp` wordt bij `--apply` geweigerd. Pin de twee manifestdigests buiten die mappen in de beoordeelde installatieaanroep.

De publieke Supabase-CA-bundel bestaat uit de officiële 2021- en 2025-certificaten uit `supabase/cli` revisie `e8e440bbebdd18f843a8919aa36e5eaa1e11a462`. De beoordeelde combinatie is 2738 bytes en heeft SHA-256 `6ecd239038a7db063a6619b71742372ecfe06c0b0ec12a9993fee4445bf0d4d6`. Geef een root-owned bestand met precies deze bytes mee via `--database-ca`. Het script installeert uitsluitend `/usr/local/share/dg-certificates/supabase-prod-ca-bundle.crt`, root:root 0644. Het wijzigt de algemene CA-store en Milo niet. Alleen de nieuwe Dartflow-units gebruiken `NODE_EXTRA_CA_CERTS` naar dit bestand.

Stdin accepteert exact twee configuratie-identificaties, zonder providerwaarden of credentials:

```json
{
  "staging": {"configId": "staging-2026-11-11-v1"},
  "production": {"configId": "production-2026-11-11-v1"}
}
```

De identificaties zijn voorbeelden: gebruik de werkelijk afgesproken onveranderbare bundel-ID's. Het script maakt lege root-only bundelmappen. `public.json` en `runtime.env` worden later via het afzonderlijke beschermde beheerpad geleverd. Het script genereert, leest of kopieert geen databasewachtwoord en accepteert geen runtimewaarden in stdin.

Een installatieaanroep heeft deze vorm; vul de werkelijk beoordeelde hashes in:

```sh
sudo python3 -I /root/dartflow-reviewed/bootstrap-host.py \
  --render-staging /root/dartflow-reviewed/staging \
  --render-production /root/dartflow-reviewed/production \
  --database-ca /root/dartflow-reviewed/supabase-prod-ca-bundle.crt \
  --staging-manifest-sha256 '<reviewed-64-hex>' \
  --production-manifest-sha256 '<reviewed-64-hex>' \
  --apply < /root/dartflow-reviewed/config-identities.json
```

## Vaste grenzen

| Onderdeel | Staging | Productie |
|---|---|---|
| Domein | `staging.dartflow.nl` | `dartflow.nl` |
| Loopback | `127.0.0.1:4174` | `127.0.0.1:4175` |
| Site | `/srv/sites/dartflow-staging` | `/srv/sites/dartflow-production` |
| Service | `dartflow-staging.service` | `dartflow-production.service` |
| Runner | `run-dart-stg` | `run-dart-prd` |
| Builder | `build-dart-stg` | `build-dart-prd` |
| App | `app-dart-stg` | `app-dart-prd` |

De zes accounts hebben aparte UID/GID-combinaties. Alleen runners krijgen de bestaande aanvullende groep `dg-build`. Runnerhomes zijn 0700 en passwords zijn vergrendeld. Build- en appaccounts krijgen `/usr/sbin/nologin`, geen extra groepen en geen sudo-regels. Alleen de vaste runner-brokeraanroepen uit de gerenderde sudoers worden geïnstalleerd.

Root vult de werkelijk gemaakte UID/GID's en de goedgekeurde configuratie-ID in `deploy.json` in. De bestaande Node 24.18.0 en npm 11.16.0 worden gecontroleerd en hergebruikt. npm verwijst naar de op de doelhost waargenomen `/opt/node-v24.18.0-linux-x64/lib/node_modules/npm/bin/npm-cli.js`; er wordt geen toolchain geïnstalleerd of vervangen.

Het script neemt de bestaande niet-blokkerende `/run/lock/dg-build.lock` voordat wijzigingen beginnen. De bestaande eigenaar, groep, modus, inode en inhoud worden behouden. Beide site-locks worden afzonderlijk root:root 0600 aangemaakt. Een bezette globale lock weigert de bootstrap; er ontstaat geen parallelle Milo- of Dartflow-build.

Dit is een eerste bootstrap. Een bestaande `current`-release wordt geweigerd. Een bestaand beheerd bestand moet exact dezelfde inhoud, eigenaar en modus hebben; afwijkende bestanden worden niet overschreven. Een volgende wijziging aan bestaande brokers of configuratie vraagt opnieuw een gerichte beoordeelde beheerhandeling.

## Validatie, Caddy en fouten

Voor en na de bootstrap worden Milo's actieve service/PID, `current`-link, drie vaste beheerbestanden en publieke healthidentiteit vergeleken. Milo's domeinfragment, service, deployentry, accounts en poort 4173 worden niet gewijzigd. Milo's beschermde readiness wordt niet omzeild.

Sudoers worden vóór installatie met `visudo -cf` en na installatie met `visudo -c` gecontroleerd. De nieuwe units worden met `systemd-analyze verify` gecontroleerd en vervolgens met `daemon-reload` geregistreerd. Er volgt geen `enable`, `start` of `restart` voor Dartflow. Runnerregistratie is een aparte stap.

Caddy moet de waargenomen import `/etc/caddy/sites/*.caddy` gebruiken. Het productiefragment behandelt ook `www.dartflow.nl` met een permanente redirect naar `https://dartflow.nl{uri}`; er komt geen afzonderlijke www-backend. Het script valideert eerst de volledige bestaande configuratie met de twee staged nieuwe fragmenten. Pas daarna worden uitsluitend ontbrekende Dartflow-fragmenten atomair geïnstalleerd, wordt de echte configuratie opnieuw gevalideerd en volgt een Caddy-reload. Bestaande hostfragmenten worden niet vervangen. Bij een validatie- of reloadfout worden alleen de door deze aanroep gemaakte fragmenten verwijderd en de oorspronkelijke configuratie opnieuw gevalideerd. Na een al gepoogde reload wordt Caddy daarop herladen. Wijzigingen door een andere beheerder tijdens deze transactie worden geweigerd.

Bij een fout kunnen nieuw gemaakte accounts, lege mappen en nieuwe root-owned brokerbestanden achterblijven. Het script verwijdert die niet automatisch: dat zou bestaande of inmiddels gebruikte identiteiten kunnen beschadigen. Er draait dan geen door dit script gestarte Dartflow-app of runner. Lees de foutstatus en controleer de benoemde vaste paden voordat opnieuw wordt geprobeerd. Een afwijkende Milo-baseline wordt gemeld zonder automatische wijziging aan Milo.

Een geslaagde bootstrap meldt `bootstrapped_not_deployed`. DNS, TLS-uitgifte voor de nieuwe hostnamen, runtimeconfiguratie, migraties, echte FD-overdracht, runnerregistratie, CI en de eigenlijke releases moeten afzonderlijk worden geverifieerd. De bootstrap zet geen releasegate of `nativeEnabled`-beleid open.
