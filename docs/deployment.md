# Dartflow lokaal en staging voorbereiden

Deze workspace bevat de lokale stagingimplementatie en de bouwketen voor `https://staging.dartflow.nl`. De meegeleverde actieve GitHub-workflows testen en bouwen artifacts; zij wijzigen geen VPS, database, DNS of Auth-provider. De native deploy wordt aangesloten zodra het echte DG-host- en wrappercontract beschikbaar is. De ontbrekende gegevens staan in `docs/inventory.md` en `ops/host-profile.staging.example.json`.

## Exacte GitHub-instellingen

Maak in de **werkelijke Dartflow-repository** onder **Settings → Environments** de environment **`staging`**. Zet deze vier waarden onder **Environment variables**. De workflow heet `Staging candidate` en leest precies deze namen:

| Variable | Exacte waarde / herkomst | Moment |
|---|---|---|
| `DARTFLOW_APP_ORIGIN` | `https://staging.dartflow.nl` | Build en later runtime |
| `DARTFLOW_DATA_MODE` | `supabase` | Build en later runtime; lokale login mag niet publiek worden aangezet |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<staging-project-ref>.supabase.co`, uit het geïsoleerde stagingproject | Build en later runtime |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | De `sb_publishable_...`-sleutel van precies datzelfde stagingproject, uit **Supabase → Settings → API Keys** | Build en later runtime |

De publiceerbare sleutel is browserconfiguratie; toegang wordt bepaald door serverautorisatie en databasebeleid. Gebruik hiervoor nooit `sb_secret_...`, `service_role` of een databasewachtwoord. De voorbeeldwaarde `<staging-project-ref>` kan pas worden ingevuld nadat het echte stagingproject is gekozen; een waarde verzinnen zou de app op een verkeerde database aansluiten.

**Secrets die de huidige GitHub-workflows vereisen: geen.** GitHub levert zelf het beperkte `GITHUB_TOKEN`; maak daarvoor geen PAT. De build vraagt geen databaseverbinding en verstuurt geen e-mail.

**Runtime vereist wél één databasegeheim: `DARTFLOW_DATABASE_URL`.** Dit is de PostgreSQL-verbindingsstring van de beperkte staging-app-role; geen `postgres`-beheerlogin, geen superuser en geen BYPASSRLS. Plaats hem via het DG-beheerpad in het beschermde runtimebestand op de doelhost. Als de geverifieerde DG-deployinterface credentials vanuit GitHub ontvangt, voeg hem **ook als Environment secret `DARTFLOW_DATABASE_URL` onder `staging`** toe. Dat extra GitHub-secret is pas nodig wanneer die adapter aantoonbaar bestaat; de huidige workflows lezen of kopiëren het niet. Draag het dan uitsluitend over via de beoordeelde stdin/beschermde-file-interface, nooit als commandoregelargument of logregel.

Voor deze versie zijn **geen** `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, SSH-key, Hetzner-token, Tailscale-key of SMTP-/Google-secret in GitHub nodig. Migraties en backups hebben later een afzonderlijk beheerpad en worden niet met de app-role uitgevoerd. Voeg alleen credentials toe die een werkelijk aangesloten workflow gebruikt.

`DARTFLOW_RELEASE_SHA` komt automatisch uit de volledige commit-SHA in de workflow. Vul die niet met de hand in als GitHub-variable. Node/pakketversies staan in `.nvmrc` en `package-lock.json`. Hostnaam, site-ID, Linux-account, runnerlabels en poort worden later uit de getoetste inventory overgenomen; het zijn nu open punten, geen verborgen vereiste GitHub-secrets.

Beperk de staging-environment tot de beschermde standaardbranch van de werkelijke repository en stel passende reviewers in. Laat PR-code uitsluitend op GitHub-hosted runners testen. Bescherm workflow- en migratiewijzigingen met review en vereis de `CI / Verify`-check op de geaccepteerde SHA. Het bestaande branchbeleid is nog niet waargenomen en wordt niet als reeds ingesteld geclaimd.

## Supabase en Auth buiten GitHub

Configureer in het geïsoleerde stagingproject de Site URL `https://staging.dartflow.nl` en de exact door de app gebruikte callback-URL `https://staging.dartflow.nl/auth/callback`. Sta alleen bedoelde callbacks toe; voeg localhost uitsluitend als afzonderlijke ontwikkelconfiguratie toe. Google client-ID/client-secret worden bij de Google-provider in **Supabase Auth** geplaatst. De Google-console krijgt de door Supabase getoonde callback `https://<staging-project-ref>.supabase.co/auth/v1/callback`.

SMTP-host, poort, gebruiker, wachtwoord en afzender horen in **Supabase Auth → SMTP**, met een geverifieerd afzenderdomein en afgesproken testontvangers. Voor de e-mailcodeflow moet het e-mailtemplate de token tonen volgens het actuele Supabase-templatecontract. Leg vóór echte mailtests vast welke ontvangers en Google-testaccounts zijn toegestaan. De app heeft deze providersecrets niet nodig. Voer migraties met het aparte beheerkanaal uit en lever de app uitsluitend de beperkte rol uit de migratie/runbookbeschrijving.

## CI en staging-artifact

`DARTFLOW_DATA_MODE=local` is een expliciete lokale fixturestand. Zij werkt uitsluitend met een loopbackorigin en lokaal gebonden server, ook wanneer je voor een lokale smokecontrole een gecompileerde Next-build start. Dit is geen toegestane configuratie voor een publiek domein. Publieke staging gebruikt altijd `supabase`; de stagingvalidator weigert `local`.

`CI` draait op push, PR en handmatige aanvraag met een locked install, typecontrole, lint, domeintests, Next-build en browser-/API-smokecontrole. CI gebruikt uitsluitend lokale testconfiguratie. `ops/package-release.mjs` maakt een standalone `.tgz`, SHA-256-checksum en manifest in `artifacts/`; `.env*`-bestanden, `.local`-runtimegegevens en `.git` worden niet meegenomen. Een lokale build zonder GitHub-run blijft in het manifest `local-uncommitted`/ongeverifieerd.

Na een geslaagde **push-CI op de standaardbranch** start je `Staging candidate` vanaf diezelfde standaardbranch met de volledige 40-tekens-SHA. De workflow controleert branchafstamming en een succesvolle CI-run voor exact deze SHA, valideert de vier stagingvariabelen, bouwt met die publieke waarden en uploadt het artifact. Een groen artifact is nog geen geaccepteerde stagingrelease: externe HTTPS, database, Auth, fysieke toestellen en herstel moeten op de echte omgeving worden bewezen.

De eerste keer moet de workflowcode zelf op de standaardbranch staan voordat handmatig starten beschikbaar is. De standaardbranch is bewust niet als `main` of `master` vastgezet. Gebruik de branchnaam van de echte doelrepository.

## Native runtimecontract

Next gebruikt `output: 'standalone'`. Het pakket bevat `server.js`, getraceerde afhankelijkheden, `public/`, `.next/static/` en `release-manifest.json`. De app start met de gepinde absolute Node-binary en `server.js`, `NODE_ENV=production`, `HOSTNAME=127.0.0.1` en de werkelijk toegewezen `PORT`. Kies geen poort op basis van het lokale ontwikkelvoorbeeld.

`ops/systemd/dartflow.service.example`, `ops/caddy/staging.Caddyfile.example` en `ops/runtime.env.example` zijn templates met verplichte placeholders. Laat de bestaande DG-infra-repository de definitieve root-owned bestanden beheren. Houd runtimegeheimen buiten releases. Stem schrijfrechten voor eventuele Next-cache af op de gebruikte features; maak de release niet algemeen schrijfbaar voor het appaccount.

Het Caddy-template slaat accesslogging over voor Auth-callbacks en schermcapabilities, volgens [Caddy log_skip](https://caddyserver.com/docs/caddyfile/directives/log_skip). Verifieer Caddy ≥ 2.8 en behoud die uitsluiting bij integratie met het DG-logbeleid. Gebruik voor de database de projectverbinding uit [Supabase Connect](https://supabase.com/docs/guides/database/connecting-to-postgres): direct of de session-pooler, met eigen rol `dartflow_app` (bij de gedeelde pooler `dartflow_app.<project-ref>`), URL-gecodeerd wachtwoord en geverifieerde TLS. Een willekeurige `postgres`-verbinding wordt door de runtime geweigerd.

Controleer `ops/deploy-contract.md` voordat de native workflow wordt geactiveerd. `deploy-staging.yml.example` is opzettelijk geen actieve workflow en bevat daarnaast `if: false`. De geverifieerde doelrunner bouwt opnieuw met de stagingconfiguratie volgens de DG-flow; later bouwt productie dezelfde geaccepteerde bron-SHA opnieuw met de eigen configuratie.

## Controle na echte uitrol en herstel

Controleer de actieve SHA via loopback en via `https://staging.dartflow.nl/api/health`. Controleer database/schema en Auth-bereikbaarheid afzonderlijk via `https://staging.dartflow.nl/api/ready`. Een HTTP 200 bewijst geen Auth- of wedstrijdketen. Doorloop met twee goedgekeurde testaccounts de OTP-/Google-login, check-in, QR-route, score, schrijverswissel, retry, resultaatbevestiging en hetzelfde 9:16-scherm. Leg de actieve SHA, databaseversie, CI-run, deployrun en geredigeerd bewijs vast in `voorbeelden/release-acceptatie.md`.

Een mislukte kandidaat moet de actieve release beschikbaar houden. Rol alleen via de bewezen DG-rollbackactie terug naar een compatibele release; verifieer daarna dezelfde endpoints en pilotflow opnieuw. Een approllback herstelt geen schema, data of Auth-configuratie. Een onverenigbare migratie vereist een afzonderlijk databaseherstel-/voorwaarts migratieplan. Bewijs de geïsoleerde restore, gemeten RPO/RTO en herstelmiddelen buiten de doelhost voordat de server als geaccepteerd wordt gemarkeerd.

## Geverifieerde leveranciersbronnen

De standalone-layout en het apart kopiëren van assets volgen [Next.js output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output). De workflowgrenzen en gepinde actions volgen [GitHub Secure use](https://docs.github.com/en/actions/reference/security/secure-use). Environment-scoping volgt [GitHub secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets) en [GitHub variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables). De loopbackproxy volgt [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy). Geraadpleegd op 10 november 2026; de exacte actionrevisies zijn op die datum via de officiële repositories gecontroleerd.
