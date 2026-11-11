# DartFlow staging: inventaris en open uitvoeringspoorten

Momentopname: **11 november 2026**, Europe/Amsterdam. Geheimwaarden staan uitsluitend in de beheerde secretvoorziening; dit bestand bevat alleen identiteit, bronverwijzingen en status.

| Onderdeel | Status | Bron / vervolgstap |
|---|---|---|
| Lokale app | Uitgewerkt | `/home/codex/repos/dartflow`; bestaande Next-app en pilot behouden, geen nieuwe app/frameworkmigratie |
| Lokale branch / remote | Vastgesteld | `codex/staging`; nog geen GitHub-remote |
| DartFlow-doelrepository / integratiebranch | Open | Connector én volledig gepagineerde geautoriseerde GitHub CLI-inventaris geven geen bevestigde DartFlow-match. `dartspoint/platform` is aantoonbaar een ander product en niet gekozen. Exacte URL/afspraak nodig; geen eigenaar geraden of repository gemaakt |
| Vereiste CI | Lokaal vastgelegd | `ops/release-policy.json`: `ci.yml`, event `push`, verplichte job `Verify`; nieuwste eigen run en exacte attemptjobs moeten voor dezelfde volledige SHA `completed/success` zijn |
| GitHub-environment / platformbescherming | Open voor DartFlow | Environment `staging`, integratiebranch/reviewregels en eventuele branch-protection moeten op de echte repository worden geverifieerd. Milo's onbeschermde platforminstellingen zijn geen DartFlow-contract |
| Native workflows en broker | Geïmplementeerd, niet geïnstalleerd | Handmatige deploy-/rollbackworkflows, onafhankelijke rootgate, exacte GitHub-bron, npm-buildisolatie, immutable app/config, locking en herstelcode aanwezig. `repository/integrationBranch=null`, `nativeEnabled=false` weigeren native uitvoering vóór self-hosted scheduling |
| Node / npm | Gepind | Node `24.18.0`; npm `11.16.0` in `.npm-version`, `packageManager`, `engines`; locked dependencies in `package-lock.json` |
| Doelhost | Actueel bevestigd | `dg-nxttrack-01`, via [readonly-inspectie 42943887248](https://github.com/milobingo/platform/actions/runs/42943887248), geen hostmutatie |
| Milo vóór wijzigingen | Pass binnen meetbereik | Publiek revision `729d962b7401b100ce9cacb94ce4e4da16a699f2`, release `42804436092-1`, config `staging-2026-11-05-v1`; service loaded/active/enabled en app uitsluitend `127.0.0.1:4173` |
| Hostcapaciteit | Actueel deels bevestigd | `143154114560` vrije bytes en `9743084` vrije inodes; geheugen/CPU en gemeten buildpiek nog Open |
| Bestaande wrapper/lock | Concrete bron + gedeeltelijke hostmeting | Milo-entry root:root `0755`, actuele hash bevestigd; helperdigest in beperkte sudo-policy. Bron gebruikt bestaande `/run/lock/dg-build.lock` nonblocking. Actuele lockfilemetadata/-bezetting nog rechtstreeks te meten |
| Beheer-/bootstraptoegang | Geblokkeerd | Netwerk en hostkey beschikbaar; aanwezige OpenSSH-middelen worden voor `dgadmin`/`root` geweigerd met `Permission denied (publickey)`. Geen sleutels toegevoegd of hostkeycontrole versoepeld |
| Eigen DartFlow-objecten | Voorgesteld, niet aangemaakt | `run-dart-stg`, `build-dart-stg`, `app-dart-stg`; runnernaam `dg-nxttrack-01-dartflow-staging`, labels `dg-nxttrack-01,dartflow,staging`; site `/srv/sites/dartflow-staging`, service `dartflow-staging.service`. Werkelijke UID/GID/registratie nog Open |
| DartFlow-loopbackpoort | Open | `4174` had geen listener in de meting van 03:08 CET maar is niet gereserveerd. `4173` blijft voor Milo |
| DNS/TLS | Fail voor huidige route | A `185.151.30.138`, AAAA `2a07:7800::138`; certificaat dekt `staging.dartflow.nl` niet. Na Caddy-inrichting A naar geverifieerd `128.140.93.95`; AAAA bewust naar `2a01:4f8:c015:60a6::1` of verwijderen. Niets gewijzigd |
| Eigen Supabase-backend/Auth | Open | Beide verbonden accounts op 11 november opnieuw alleen-lezen geïnventariseerd, geen DartFlow-project aangewezen. Eigen projectref, publishable key, beperkte DB-verbinding en toegelaten Auth-testaccounts ontbreken |
| Native appconfiguratie | Geïmplementeerd, waarden ontbreken | Root-only immutable `configs/<ID>/{public.json,runtime.env}`; runtime bevat uitsluitend `DARTFLOW_DATABASE_URL`. Geen zelf aan te maken GitHub-appsecrets nodig; de vier hosted variables zijn alleen voor optionele inspectieartifacts |
| Backups / RPO-RTO / echte rollback | Open | Native broker voert geen migratie/restore uit. Databasebeheer, compatibiliteit, backup en daadwerkelijke app/configrollback moeten vóór acceptatie bewezen worden |
| Gehele DG-fleet/providerinventory | Open, buiten actuele hostmeting | Concreet Milo-masterprompt en native docs lokaal beschikbaar; geen volledige geverifieerde inventory van alle zeven VPS'en aangetroffen |
| DartFlow live release / CI-/deployrun | Open | Geen remote/push, geen DartFlow-CI of deployrun, geen hostinrichting of DNS-/providerwijziging uitgevoerd |

Het onderzoek gebruikte leesverzoeken en lokale broninspectie. De enige aanvullende GitHub-actie was de vooraf beoordeelde bestaande **readonly Inspect Milo staging**-workflow; geen release is gestart. De onafhankelijke releasevalidator is ook alleen-lezen op Milo's bekende groene SHA/CI getest. Deze resultaten bewijzen geen DartFlow-deploy of echte gebruikersacceptatie.

Uitgebreid bewijs: `docs/host-inventory.md`, `docs/release-reference.md`, `ops/host-profile.staging.example.json` en `voorbeelden/release-acceptatie.md`. Praktische bootstrap-/release-/rollbackprocedure: `docs/deployment.md` en `ops/deploy-contract.md`.
