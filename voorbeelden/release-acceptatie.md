# Acceptatierapport DartFlow staging

Bijgewerkt op **11 november 2026 (Europe/Amsterdam)**. De nieuwe native releaseketen is lokaal geïmplementeerd en getest, maar **niet op de doel-VPS geïnstalleerd of als DartFlow-release uitgevoerd**. Repository/integratiebranch, beheer-SSH en eigen stagingbackend ontbreken; DNS/TLS is onjuist. `ops/release-policy.json` houdt daarom de identiteit leeg en `nativeEnabled: false`.

De functionele tabellen verderop bewaren het **historische lokale appbewijs van 10 november**, bron **`7d8dff64be15489d397ca7069814b403538beb26`**, branch `codex/staging`; exact toenmalig afrondingstijdstip staat in `docs/evidence/verification.json`. Die resultaten keuren de nieuwe releasecode of een externe stagingomgeving niet automatisch goed. De definitieve bron-SHA en aanvullende complete verificatieregistratie voor de nieuwe wijzigingen worden na afronding door de hoofdtaak toegevoegd.

## Gevraagde oplevering: actuele stand op 11 november

| Nr. | Gevraagd resultaat | Werkelijk behaalde status |
|---|---|---|
| 1 | Werkende staging-URL | **Niet behaald.** Beoogd `https://staging.dartflow.nl`; huidige DNS verwijst naar andere ingress en TLS dekt de hostnaam niet. Geen echte DartFlow-release uitgevoerd |
| 2 | Repository, integratiebranch, volledige release-SHA, CI/deploy | **Open.** Exacte DartFlow-doelrepo ontbreekt, remote niet geconfigureerd; geen DartFlow-CI-/deployrun of externe release-SHA. Voorgestelde integratiebranch `main` wordt pas na projectverificatie vastgelegd |
| 3 | Host, runnerlabels, accounts, site/service/poort | Host **`dg-nxttrack-01` bevestigd**. Nieuwe voorgestelde runner `dg-nxttrack-01-dartflow-staging`, labels `dg-nxttrack-01,dartflow,staging`, accounts `run-dart-stg/build-dart-stg/app-dart-stg`, site `/srv/sites/dartflow-staging`, service `dartflow-staging.service`: **nog niet geïnstalleerd**. Poort 4174 had geen listener in de inspectie maar is niet gereserveerd; 4173 blijft Milo |
| 4 | Actieve app en configuratie-ID | **Geen DartFlow-release/configbundel actief.** Code koppelt elke verzegelde release aan een immutable hostbundel en config-ID; echte configuratiewaarden ontbreken |
| 5 | Health/readiness, login/wedstrijd en rollback | Nieuwe lokale controles hieronder; historische lokale pilot verderop. **Echte staging-Auth, wedstrijdflow en hostrollback Open**; readiness niet kunstmatig aangepast |
| 6 | Milo functioneert na afloop | **Pass binnen meetbereik.** Readonly vóór- en nameting bevestigen dezelfde gezonde release, actieve service en `127.0.0.1:4173`; er is niets aan Milo gewijzigd. Dit is geen nieuwe volledige Milo-gebruikersacceptatie |
| 7 | Wijzigingen, blokkades en normale procedure | Concrete broker/entry/extractor/rootpolicy, workflowgate/deploy/rollback, npm-pin, release-/configmetadata en tests aanwezig. Procedure in `docs/deployment.md` en `ops/deploy-contract.md`; ontbrekende repo/toegang/backend/DNS/TLS expliciet open |

## Nieuwe releaseverificatie, 11 november

| Controle | Status | Bewijs en grens |
|---|---|---|
| Onafhankelijke rootgate op echte GitHub-metadata | Pass | Alleen-lezen geaccepteerd: Milo-bron `729d962b7401b100ce9cacb94ce4e4da16a699f2`, eigen [CI 42802522209](https://github.com/milobingo/platform/actions/runs/42802522209), job `verify`. Werkelijk geweigerd: latere documentatie-SHA `67e1039a270488601c5e010da4eb25b1c7619812` zonder eigen exacte CI. Geen DartFlow-CI en geen deploy |
| Releasepoort/-identiteit/-packagingtests | Pass lokaal | Hoofdtaak rapporteert 40 geslaagde tests; definitieve bron-/commandoregistratie wordt aangevuld |
| Native brokergrenzen en fout-/herstelpaden | Pass lokaal | 44 native tests geslaagd; echte bronarchive-/filesystemfixtures, fork/pidfd/SIGKILL/OFD-proeven en geïsoleerde callbacks. Beide locks afzonderlijk getoetst, ook bij vertraagde clientstart; builder ontvangt geen lock-FDs in de procesfixture. Dit voert geen systemd-/sudo-/providerdeploy uit |
| Vier GitHub-workflows | Pass voor syntax | Actionlint `1.7.12`: alle vier workflows/GitHub-expressies geldig, voorgestelde runnerlabels geconfigureerd; shellcheck hierbij uitgeschakeld. Geen GitHub-configuratie of workflowbestand extern geplaatst |
| Locked install/build zonder runtimegeheim | Pass lokaal | Geïsoleerde `npm ci` en volledige standalone-build met synthetische publieke configuratie; geen database-runtimeomgeving |
| Smoke van die isolated build | Pass voor geteste grens | `/api/health` HTTP 200; `/api/ready` HTTP 503 zoals vereist zonder databaseconfiguratie. Dit is **geen database-readinessacceptatie** |
| Prototype-regressiecontrole | Pass lokaal | Op 11 november opnieuw 26/26 geslaagd; de aangeleverde prototypebron blijft een referentie, geen native release |
| Broncredentialscontrole | Pass voor gecontroleerde bestanden | Hoofdtaak controleerde 179 bronbestanden: geen lek van lokale databasecredentials; definitieve bron-SHA wordt hieronder vastgelegd |
| Native installatie en eigen runner | Open | Geen bevoegde beheerlogin; geen accounts, sudo-policy, units, bundels, labels of portregistratie op de host aangebracht |
| Eigen DB/Auth-project en least privilege | Open | Projectref/publishable key/DB-geheim/testaccounts ontbreken. Werkelijke rolflags, lidmaatschappen en DDL-/tabelrechten nog te verifiëren; accountnaam alleen is geen privilegebewijs |
| Publieke DartFlow-health/readiness | Fail voor huidige route | DNS A `185.151.30.138`, AAAA `2a07:7800::138`; TLS-hostnaam fout. Na Caddy-bootstrap A naar `128.140.93.95`, AAAA naar geverifieerd `2a01:4f8:c015:60a6::1` of oude AAAA verwijderen |
| Echte OTP/Google/score/herladen | Open | Lokale fixturepilot vervangt geen echte Supabase-identiteit of providerconfiguratie |
| Echte lockbezetting/activatiefout/rollback/restore | Open | Lokale faalinjectie aanwezig; doelhostproef en compatibele app/configrollback niet uitgevoerd. Geen destructieve migratie of automatische databaserestore onderdeel van gewone deploy |
| Onafhankelijke lockbewaker bij harde helperdood | Hostacceptatie Open | Nieuwe root-owned guardian met gepinde `guardianSha256` houdt dezelfde lockdescriptors, stopt/bevestigt de vier vaste buildunits en wacht pending app-/buildjobs af. Onzekere cleanup houdt locks vast voor rootherstel; geen automatische approllback bij harde helperdood. Echte systemd-FD-overdracht en SIGKILL-proef op de doelhost nog niet uitgevoerd; definitieve lokale guardian-testregistratie volgt bij de hoofdtaak |

Milo's vóórmeting: [Inspect 42943887248](https://github.com/milobingo/platform/actions/runs/42943887248), 03:08:16–03:08:22 CET; nameting: [Inspect 42945932719](https://github.com/milobingo/platform/actions/runs/42945932719), **03:25:37–03:25:42 CET**, beide `completed/success` op workflowbron `67e1039a270488601c5e010da4eb25b1c7619812`. Service loaded/active, app `app-mil-stg`, werkmap `current/.next/standalone`, bijbehorend envpad en Caddy actief; listener `127.0.0.1:4173`. Entryhash blijft `aee3e1e2e76f05d99f668ed7c756802da82033c4983216b90d7ea50de9f49bc7`. Bij de nameting: `143154008064` vrije bytes en `9743083` vrije inodes. Publiek HTTPS HTTP 200/TLS-verificatie 0 via `128.140.93.95`, met ongewijzigde revision `729d962b7401b100ce9cacb94ce4e4da16a699f2`, release `42804436092-1`, configuratie `staging-2026-11-05-v1`. Zie `docs/host-inventory.md` voor de precieze meetgrenzen.

### Definitieve nieuwe lokale bronregistratie

Deze velden worden door de hoofdtaak na de broncommit en laatste build/browsercontrole ingevuld. Zij zijn geen ontbrekende externe stagingacceptatie die met lokale tests kan worden afgevinkt.

| Vastlegging | Eindresultaat |
|---|---|
| Volledige nieuwe lokale bron-SHA / branch | Nog in te vullen na de broncommit |
| Volledige typecheck/lint/unit/native/prototype-testregistratie | Nog in te vullen met definitieve commandoregel, aantallen, tijdstip en bewijs |
| Build-/standalone-artifact en bron-/configidentiteit | Nog in te vullen na de laatste build op die bron |
| Laatste browserpilot / viewportmatrix op die bron | Nog in te vullen met echte uitkomst; historische resultaten hieronder blijven apart |
| Eindstatus GitHub-remote / nativeEnabled / externe deploy | Repo nog onbevestigd, remote niet ingesteld, `nativeEnabled:false`, geen DartFlow-deploy; alleen aanpassen wanneer werkelijk uitgevoerd |

## Historisch lokaal appbewijs, 10 november

| Onderdeel | Waarde / bewijs |
|---|---|
| Werkmap en lokale app | `/home/codex/repos/dartflow`, `http://localhost:3000/inloggen` |
| Gewenste staging-origin | `https://staging.dartflow.nl` |
| Toolchain | Node 24.18.0, npm 11.16.0, Next 16.4.6, TypeScript 6.0.3; gepinde package-lock |
| Backend | Echte lokale PostgreSQL 16, schema-versie 1, beperkte `dartflow_app`-rol |
| Browser | Chromium 158.0.8127.18, aparte browsercontexten voor organisator, twee spelers en onafhankelijk scherm |
| Releasepakket | `artifacts/dartflow-7d8dff64be15489d397ca7069814b403538beb26-local.tgz`, bijbehorende `.sha256` en manifest |
| Bronverificatie | Lokale commit; geen geverifieerde GitHub-run. Manifest `sourceVerified:false` |
| Doelrepo / branchbeleid | Open — geen Git-remote en geen geverifieerde Dartflow-doelrepo in de verbonden GitHub-inventaris |
| Host / site-ID / appuser / runner / poort / wrapper | Toen Open; actuele hostinspectie en voorgestelde afzonderlijke DartFlow-installatie staan hierboven. Nieuwe broker nog niet geïnstalleerd |
| Supabase stagingproject | Open — beide verbonden accounts alleen-lezen geïnventariseerd; geen Dartflow-project aangewezen |
| HTTPS / provideracceptatie / herstel | Open — geen externe uitrol, providerwijziging, uitgaande testmail of VPS-mutatie uitgevoerd |

## Historische lokale verificatie

| Controle | Status | Bewijs, 10 november 2026 |
|---|---|---|
| Locked install vanaf lege map | Pass | Schone `npm ci` in `/dev/shm/dartflow-locked`; 406 pakketten, nul auditbevindingen |
| TypeScript en lint | Pass | `npm run typecheck` en `npm run lint`, geen fouten of waarschuwingen |
| Nieuwe domein-, Auth-grens- en DB-tests | Pass | `npm test`: **25/25**, nul skips; echte transacties en onafhankelijke DB-clients |
| Oorspronkelijk prototype | Pass | `npm run test:prototype`: **26/26**; referentiebron `578f58eceabae88e5fce5676c6740d66a6eae689` |
| Native productiebuild | Pass | `npm run build`; standalone-server plus gekopieerde public/static-assets |
| Complete browserpilot | Pass | `tests/e2e/pilot.spec.ts`: twee spelers en organisator, check-in → planning → oproep → akkoord → score → overname → herladen → offline/retry → bust → expliciete dubbel → twee bevestigingen → één uitslag |
| Mobiele layout en scherm | Pass | Tweede browsertest: zes werkruimtes op 320×568, 360×780, 390×844, 667×375, 768×900 en 1440×1000; geen pagina-overflow. Actief en bevestigd 9:16-scherm op 390×693 en 540×960 zonder horizontale of verticale uitloop |
| Browser totaal | Pass | **2/2**; `npm run test:e2e`, laatste run 23,4 seconden |
| Club- en API-afscherming | Pass | Andere club 403, anoniem 401, cross-originmutatie 403, publieke Host bij lokale login geweigerd, grote aanvraag 413, actie voor andere match 409 |
| Race, retry en schrijfrecht | Pass | Eén commit bij concurrerende acties; payload-/revisieconflicten; dezelfde spelers niet op twee banen; vorige schrijver geweigerd; ontvangstbewijs en score samen opgeslagen |
| Uitslag en audit | Pass | Twee toegewezen spelers vereist; unieke uitslag en stand exact eenmaal; betwisting en gemotiveerde herstelroute; runtime kan audit/uitslag niet wijzigen of verwijderen |
| Schermbevoegdheid | Pass | Beperkte projectie zonder account-ID’s, schrijfrecht of contactgegevens; verval en intrekken getest |
| Oude links | Pass | Bekende hubs krijgen alias; UUID-match blijft dezelfde identiteit; numerieke prototype-ID’s en demobanen gaan naar expliciete foutpagina |
| Geheimen in build | Pass | 2.188 bestanden in standalone/static gecontroleerd: nul bestanden met lokale databasecredentials. Pakket sluit `.env*` en `.local` uit |
| Zelfstandig releasepakket | Pass | Uitgepakt naar aparte map, gestart op tijdelijke loopbackpoort: health `ok`, database `ready`, schemaVersion 1, logo HTTP 200; proces daarna gestopt |
| Lokale runtime-SHA | Pass | `/api/health` en `/api/ready` tonen de volledige geteste bron-SHA op de lokale app |
| Lokale persistentie en herstart | Pass | Database geordend gestopt, naar persistente `.local/postgres` verplaatst en opnieuw gestart; schema en app-readiness blijven geldig |

Visueel bewijs met uitsluitend synthetische testgegevens: [desktop](../docs/evidence/dashboard.png), [mobiele scorekaart](../docs/evidence/mobile-score.png), [9:16-scherm](../docs/evidence/vertical-screen.png). De browserfixtures en bijbehorende schermcapabilities zijn na de test verwijderd. Traces met sessiegegevens worden niet gecommit of opgenomen in release-artifacts.

## Overdrachtsmatrix A01–A13

| ID | Status | Uitkomst en grens |
|---|---|---|
| A01 | Open | SSR/OTP/Google-code aanwezig; echte e-mailcode, verlopen/hergebruikte code, OAuth en sessieverversing vereisen gekozen providers en testaccounts |
| A02 | Open | Lokale club- en rolafscherming Pass; platformcontext en echte staging-identiteiten nog niet geaccepteerd |
| A03 | Pass | Lokale inschrijving, capaciteit, wachtlijstpromotie, afmelden en check-in getest |
| A04 | Open | Exclusieve baan- en spelerstoewijzing en aanwezigheidscontrole Pass; reserveringsbeheer en oproepverval nog niet gebouwd |
| A05 | Open | Lokale vaste matchlink, toegangscontrole en beperkte schermprojectie Pass; QR-scannen met fysieke camera’s nog Open |
| A06 | Pass | Browser scoren en overnemen Pass; 501→321 na 180 ook in nieuwe domeintests; scherm volgt serverstand |
| A07 | Pass | Echte concurrerende DB-verzoeken, veilige herhaling, andere payload onder dezelfde ID en oude revisie getest |
| A08 | Pass | Browser restscore één → bust, D20 met expliciet akkoord; undo en leg-/setherstel in domeintests |
| A09 | Pass | Eerste bevestiging publiceert niets; tweede publiceert eenmaal; retry en herstel tellen niet dubbel |
| A10 | Open | Browser offline/online met bewaarde actie-ID en herladen Pass; echte toestelachtergrond en afwijkende mobiele verbinding nog Open |
| A11 | Open | 301/501/701, best-of, vaste acht legs met 4–4, sets en undo Pass; knock-outvervolgmodel niet gebouwd |
| A12 | Open | Browserviewports en 9:16 Pass; fysieke iOS Safari/Android Chrome met toetsenbord nog Open |
| A13 | Pass | Lokale navigatie, context, gevulde/lege weergaven en expliciet gemarkeerde niet-beschikbare functies gecontroleerd |

## Nog nodig voor externe stagingacceptatie

GitHub CI en native deploy op dezelfde volledige SHA, geverifieerde DG-runneridentiteit en wrapper, geïsoleerd Supabase-project met Auth/SMTP/Google, toegelaten testidentiteiten, echte HTTPS-revision en pilot op fysieke apparaten blijven **Open**. Approllback, externe DB-backup/restore, RPO/RTO, parallelle/onderbroken deploy en rebootherstel zijn niet gemeten en blijven **Open**. Liveness of een groen buildartifact geeft hiervoor geen acceptatie.

De lokale database staat persistent in de genegeerde map `.local/postgres`; `npm run db:start` start deze na een hostherstart opnieuw. Dit is een ontwikkelvoorziening; staginggegevens horen later in het afzonderlijke beheerde Supabase-project. Zie `README.md`, `docs/deployment.md` en `docs/inventory.md` voor setup en ontbrekende brongegevens.
