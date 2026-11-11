# Dartflow

Native Next.js-app met de v15-ontwerpbron, lokale ontwikkeling en afzonderlijke omgevingen op **https://staging.dartflow.nl** en **https://dartflow.nl**. De [v15-omgevingsmatrix](docs/v15-omgevingen.md) onderscheidt de nieuwe inrichting van actieve releases. Het installatie- en uitrolbewijs staat in `docs/evidence/` en `voorbeelden/release-acceptatie.md`.

## Lokaal starten

Vereist: Node **24.18.0**, npm **11.16.0**, PostgreSQL 16-serverbinaries en een vrije lokale poort 55432. De toolchain, projectafhankelijkheden en lockfile zijn vastgelegd.

```bash
npm ci
cp .env.example .env.local
npm run db:start
npm run db:migrate
npm run db:seed
npm run dev
```

Open **http://localhost:3000/inloggen**. Kies één van de duidelijk gemarkeerde lokale testaccounts. Danny is wedstrijdleider, Michael en Raymond zijn spelers bij Duindorp SV. De vierde speler hoort bij de andere club. Gebruik aparte browserprofielen om twee spelers tegelijk te testen.

Ontbreken PostgreSQL-serverbinaries op Ubuntu, dan kan het lokale script het serverpakket zonder root uitpakken: `DARTFLOW_DOWNLOAD_LOCAL_POSTGRES=1 npm run db:start`. Bestaande database-inhoud wordt niet vervangen. De lokale wachtwoorden worden willekeurig aangemaakt in genegeerde bestanden met modus 0600. `npm run db:stop` stopt uitsluitend deze lokale instance. `npm run db:reset` wist uitsluitend de expliciet gecontroleerde lokale fixture-database en seedt daarna opnieuw.

De lokale database staat persistent in de genegeerde map `.local/postgres`. Na een hostherstart start je deze opnieuw met `npm run db:start`; bestaande data blijft bewaard. Installeer de testbrowser met `npx playwright install chromium`; `DARTFLOW_BROWSER_PATH` kan expliciet naar een reeds geïnstalleerde Chromium verwijzen. Bron, dependencies, build en lockfile staan in de repository.

## Pilot doorlopen

1. Michael en Raymond openen Evenementen en kiezen **Ik ben aanwezig**.
2. Danny opent de geplande partij of plant een nieuwe partij in Wedstrijdleiding, roept deze op een vrije baan op en koppelt daar een scherm.
3. Beide spelers openen dezelfde wedstrijdlink of de baan-QR en bevestigen hun deelname. Danny start de partij.
4. De schrijver voert bezoeken in. De andere speler kan het schrijven overnemen. De vorige schrijver verliest direct het recht om nieuwe bezoeken te plaatsen.
5. Bij een finish wordt de beslissende dubbel expliciet bevestigd. Beide spelers bevestigen de uitslag. Historie en clubavondstand worden één keer bijgewerkt.
6. De wedstrijdleider kan een betwisting gemotiveerd beoordelen, een resultaatverwerking veilig herhalen en de baan vrijgeven. Een schermkoppeling is tijdelijk, alleen-lezen en intrekbaar.

Een netwerkfout bewaart de onbevestigde actie met haar oorspronkelijke ID. Een herhaling telt geen tweede beurt. Bij een gewijzigde revisie verschijnt een zichtbaar conflict. Het scherm en de telefoons pollen dezelfde servergegevens en verversen na reconnect of terugkeer uit de achtergrond.

## Controleren

```bash
npm run typecheck
npm run lint
npm test
npm run test:deploy
npm run test:prototype
npm run build
npx playwright install chromium
npm run test:e2e
```

Database- en browsertests gebruiken geïsoleerde synthetische fixtures in de lokale database en ruimen die op. De actieve v15-stagingrelease is daarnaast via HTTPS en een publieke browser gecontroleerd; zie [het v15-opleverrapport](voorbeelden/opleverrapport-v15.md). De eerste uitrol van beide voorafgaande releases staat in [het historische acceptatierapport](voorbeelden/release-acceptatie.md). Fysieke iOS-/Android-toestellen, toegelaten pilotaccounts en echte OTP-/Google-login blijven afzonderlijke acceptatiestappen.

## GitHub en hosting

De herbruikbare [DG Webservices-uitrolprocedure](docs/dg-webservices-uitrolprocedure.md) beschrijft de volledige route van dev-VPS naar staging en productie, inclusief Supabase, SSH, beheer en herstel. Gebruik voor nieuwe projecten het [projectintakeformulier en de startopdracht](docs/dg-webservices-projectintake.md).

De **exacte GitHub-configuratie**, providerlocaties, callbacks en uitrolvolgorde staan in [docs/deployment.md](docs/deployment.md). De twee native hostcontracten zijn geïnstalleerd en geverifieerd (`nativeEnabled: true`); iedere release vereist daarnaast groene CI voor de exacte bron-SHA. De native route gebruikt geen zelf aan te maken GitHub-secrets; de GitHub-environments bevatten ieder vier publieke variabelen. Databasecredentials blijven in een immutable root-only hostbundel.

De vastgelegde repository is `dartflow/platform`, branch `main`. Staging op `dg-nxttrack-01` draait v15-bron `38bceb0dfdfed70046d550e7b2f82839564f41cb`, release `43038238892-1`. De vorige gezonde app is gecontroleerd teruggezet en v15 is daarna met dezelfde bron-SHA hersteld. Productie draait nog bron `4634852c17cc7737bec246c0b48310e975a36920`; de v15-promotie wacht op de vereiste echte provideracceptatie en externe mediaproef. De actieve releases, controles en resterende eigenaarstappen staan in [het v15-opleverrapport](voorbeelden/opleverrapport-v15.md). Het algemene SSH-beheeraccount met geldigheid tot 11 november 2027 staat beschreven in [SSH-beheer](docs/ssh-management.md).

De app gebruikt Supabase voor hosted Auth. Het score- en rechtenmodel draait in servercode binnen PostgreSQL-transacties met een beperkte `dartflow_app`-verbinding. De private tabellen zijn niet beschikbaar via Supabase Data API. Browsergebruikers krijgen geen databasecredential of verhoogde Supabase-key. Migraties/seed gebruiken een apart beheeraccount, buiten de app-runtime. Zie [docs/architecture.md](docs/architecture.md).

De v15-overdracht en onveranderde prototypebron staan in `docs/reference/v15/` en `prototype-v15/`, broncommit `e27cccdbd0b6cd2144cc2f26cab9e2986a903e61`. De eerdere overdracht blijft bewaard in `docs/reference/` en `prototype/`. Prototypecommits zijn referenties en geen deploy-SHA. De actuele uitrolstatus staat in [het v15-opleverrapport](voorbeelden/opleverrapport-v15.md).
