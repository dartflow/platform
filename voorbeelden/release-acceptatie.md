# Acceptatierapport Dartflow staging

Uitgevoerd op **10 november 2026 vanaf 11:24 CET (Europe/Amsterdam)**; exact afrondingstijdstip staat in `docs/evidence/verification.json`. Geteste applicatiebron: **`7d8dff64be15489d397ca7069814b403538beb26`**, branch `codex/staging`. De volgende documentatiecommit voegt uitsluitend dit bewijs en lokale gebruiksinformatie toe. Dit rapport bewijst de lokale stagingkandidaat; externe stagingacceptatie blijft apart Open.

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
| Host / site-ID / appuser / runner / poort / wrapper | Open — DG-hostprofiel en geïnstalleerde deployinterface ontbreken |
| Supabase stagingproject | Open — beide verbonden accounts alleen-lezen geïnventariseerd; geen Dartflow-project aangewezen |
| HTTPS / provideracceptatie / herstel | Open — geen externe uitrol, providerwijziging, uitgaande testmail of VPS-mutatie uitgevoerd |

## Lokale verificatie

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
