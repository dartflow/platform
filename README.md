# Dartflow · lokale staging

Native Next.js-app voor de eerste clubavondpilot, voorbereid op **https://staging.dartflow.nl**. De app draait lokaal; de VPS is niet gewijzigd en er is geen externe stagingrelease uitgevoerd.

## Lokaal starten

Vereist: Node **24.18.0**, npm, PostgreSQL 16-serverbinaries en een vrije lokale poort 55432. De projectafhankelijkheden en lockfile zijn vastgelegd.

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

Op de huidige ontwikkelhost zijn de lokale database en de browser voor controles wegens beperkte schijfruimte onder `/dev/shm/dartflow-*` geplaatst. Deze tijdelijke gegevens verdwijnen bij herstart van de host. Bron, dependencies, build en lockfile staan in de repository. De tijdelijke database-root staat in `.env.local`; verwijder die lokale regel vóór een nieuwe persistente setup en herhaal `db:start`, `db:migrate` en `db:seed`.

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
npm run test:prototype
npm run build
npx playwright install chromium
npm run test:e2e
```

Database- en browsertests gebruiken geïsoleerde synthetische fixtures in de lokale database en ruimen die op. Browsercontroles gebruiken aparte sessies en Chromium; fysieke iOS-/Android-toestellen, echte OTP-/Google-login en externe HTTPS-acceptatie staan afzonderlijk open.

## GitHub en hosting

De **exacte GitHub-variabelen en secrets**, providerlocaties, callbacks en uitrolvolgorde staan in [docs/deployment.md](docs/deployment.md). De actieve workflows bouwen en testen kandidaten. De native deploytemplate blijft gesloten totdat de bestaande DG-deployinterface en doelhost zijn geverifieerd. Er worden geen poorten, Linux-accounts, SSH-secrets of wrapperflags verzonnen.

De app gebruikt Supabase voor hosted Auth. Het score- en rechtenmodel draait in servercode binnen PostgreSQL-transacties met een beperkte `dartflow_app`-verbinding. De private tabellen zijn niet beschikbaar via Supabase Data API. Browsergebruikers krijgen geen databasecredential of verhoogde Supabase-key. Migraties/seed gebruiken een apart beheeraccount, buiten de app-runtime. Zie [docs/architecture.md](docs/architecture.md).

De overdracht en oorspronkelijke prototypetests zijn bewaard in `docs/reference/` en `prototype/`. Prototypebroncommit: `578f58eceabae88e5fce5676c6740d66a6eae689`. Dit is de referentie-SHA, niet de SHA van deze implementatie.
