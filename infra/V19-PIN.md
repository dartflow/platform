# v19: server-only spelers-PIN en native configuratie-upgrade

De PIN-configuratie hoort uitsluitend in de beschermde runtimebundel. De vier publieke buildvariabelen en GitHub-environmentvariables blijven gelijk. Er komen geen GitHub-secrets voor PIN-peppers en geen `NEXT_PUBLIC_*`-PIN-velden. Install-/buildscripts krijgen deze runtimewaarden niet.

| Runtimevariabele | Contract / appdefault |
| --- | --- |
| `DARTFLOW_PLAYER_PIN_PEPPERS` | Komma-gescheiden `VERSION:BASE64`-map; elke versie 1–32 letters/cijfers/`_`/`-`, uniek; elke waarde precies 32 bytes in canonieke Base64 |
| `DARTFLOW_PLAYER_PIN_PEPPER_VERSION` | Bestaande geselecteerde versie uit dezelfde map |
| `DARTFLOW_PLAYER_PIN_MEMORY_KIB` | Optioneel 19456–131072; default 32768 |
| `DARTFLOW_PLAYER_PIN_PASSES` | Optioneel 2–8; default 3 |
| `DARTFLOW_PLAYER_PIN_ACTOR_LIMIT` | Optioneel 1–100; default 10 |
| `DARTFLOW_PLAYER_PIN_TARGET_LIMIT` | Optioneel 1–50; default 5 |
| `DARTFLOW_PLAYER_PIN_WINDOW_SECONDS` | Optioneel 30–3600; default 900 |
| `DARTFLOW_PLAYER_PIN_GLOBAL_LIMIT` | Optioneel 1–1000; default 60 per minuut |
| `DARTFLOW_PLAYER_PIN_CONCURRENCY` | Optioneel 1–8; default 4 |

Zodra een PIN-variabele aanwezig is, vereist de broker beide peppervelden. Oude immutable bundels zonder PIN-velden blijven geldig voor een bekende compatibele approllback. De nieuw geprovisioneerde bundels gebruiken de appdefaults en versie `v1` met afzonderlijk op de doelhost gegenereerde willekeurige 256-bit peppers.

## Gerichte operator

`infra/upgrade-v19-host.py` is een eenmalige, door root beoordeelde operator voor `dg-nxttrack-01`. Hij is geen runneringang. Standaard voert hij alleen een hostpreflight uit; `--apply` is expliciet. Voorwaarde: gezonde actieve v18-bron `0503413f96fcf2288f48f5dbacc9bd54ea42e823`, met bestaande `staging-2026-11-11-v15-mail-1` respectievelijk `production-2026-11-11-v15-mail-1`.

De operator controleert beide root-owned renders tegen vooraf onafhankelijk vastgelegde manifest-SHA256's, controleert alle manifestbestanden en toetst de bestaande entry/helper/sudoers-digestketen, echte accountidentiteiten en beleidsgrenzen. Alleen deze bestaande DartFlow-bestanden wijzigen:

- Eigen helper en zijn hashpins in eigen entry en sudoers; vaste host-, account- en deploy-/rollbackgrenzen blijven gelijk.
- Eigen `deploy.json`: uitsluitend toevoeging van de nieuwe config-ID aan `allowedConfigIds`.
- Nieuwe `configs/staging-2026-11-12-v19-pin-1/` en `configs/production-2026-11-12-v19-pin-1/`, elk binnen de eigen `/etc/dg-sites/dartflow-<omgeving>/`.

De nieuwe bundeldirectories zijn `root:root 0700`; `public.json` en `runtime.env` zijn `root:root 0600`. Publieke bytes worden exact gekopieerd; oorspronkelijke runtimebytes blijven een exacte prefix, gevolgd door uitsluitend de twee PIN-velden. Peppers bestaan alleen in het geheugen van de rootoperator en daarna in het beschermde nieuwe runtimebestand. De operator geeft geen waarde of pepperhash uit en zet ze niet in argv, developmentbestanden, artifacts of GitHub.

Bestaande bundels blijven ongewijzigd en nieuwe IDs worden nooit hergebruikt of overschreven. Gate, extractor en guardian moeten al overeenkomen met de reviewrender; de operator weigert een gecombineerde validatorwijziging. Hij wijzigt geen apprelease, services, timers, database, Caddy of Milo. De bestaande globale buildlock `29:6` blijft dezelfde inode en wordt alleen tijdens preflight/apply vastgehouden. Een bezette lock geeft 75, zonder upgrade.

## Review- en uitvoercommando's

Na de definitieve bronreview renderen op development; de map bevat uitsluitend broncode en manifesten:

```sh
mkdir -m 700 '<nieuwe-reviewmap>'
python3 -I infra/staging/render-deployer.py --environment staging --output '<nieuwe-reviewmap>/staging'
python3 -I infra/staging/render-deployer.py --environment production --output '<nieuwe-reviewmap>/production'
sha256sum '<nieuwe-reviewmap>/staging/manifest.json' '<nieuwe-reviewmap>/production/manifest.json'
```

Leg beide hashes onafhankelijk vast. Breng uitsluitend de gereviewde bronoperator en de twee renders over naar een nieuwe beschermde rootdirectory op de vaste host. De operator en alle padcomponenten moeten root-owned zijn, zonder symlinks of groeps-/wereldschrijfrechten. Gebruik de nieuwe rootdirectory bij de preflight; voer deze opdracht niet uit vanuit een door een applicatie- of runneraccount schrijfbare checkout.

```sh
sudo -n /usr/bin/python3 -I /root/<gereviewde-map>/upgrade-v19-host.py \
  --renders /root/<gereviewde-map>/renders \
  --staging-manifest-sha256 '<onafhankelijk-gereviewde-staging-manifest-SHA256>' \
  --production-manifest-sha256 '<onafhankelijk-gereviewde-productie-manifest-SHA256>'
```

Na groene CI, actuele back-ups en acceptatie van de concrete hostpreflight herhaalt root exact dezelfde opdracht met `--apply`. Dit is geen deployment. Controleer daarna de veilige JSON met nieuwe IDs en helperhashes, ongewijzigde huidige app-/Milo-identiteit en lock. Gebruik vervolgens de normale handmatige exact-SHA-releaseflow: staging bouwen met `staging-2026-11-12-v19-pin-1`, accepteren, productie opnieuw bouwen met dezelfde SHA en `production-2026-11-12-v19-pin-1`.

De operator bewaart vooraf de oude controlbestanden en modes als root-only back-up onder `/var/backups/dartflow/v19-pin-host-<UTCstamp>/`; een geslaagde toepassing legt daar `upgrade-proof.json` vast. Bij een opgevangen installatiefout herstelt hij uitsluitend de door hem geschreven controlbestanden wanneer hun bytes nog bekend zijn. Nieuwe private configbundels blijven dan ongoedgekeurd behouden voor rootreview. Herhaal `--apply` niet om een gedeeltelijke upgrade te overschrijven. Bij een harde proces-/hostonderbreking controleert root de controlhashes en herstelt gericht vanuit deze back-up; er wordt geen automatische SIGKILL-herstelgarantie geclaimd.

Bewaar bij de reguliere private databaseback-up ook de bijbehorende beschermde runtimebundel. Verwijder bij latere rotatie geen eerdere pepperversie zolang bestaande PIN-verifiers die versie nodig hebben. Een rotatie krijgt een nieuwe immutable configuratie en afzonderlijke app-/herstelacceptatie; deze eerste provisioner is geen rotatiegereedschap.
