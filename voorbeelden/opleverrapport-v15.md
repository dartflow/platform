# DartFlow v15 — releasebewijs

Peildatum: 11 november 2026. **V15 draait op staging; productie draait de voorafgaande gezonde release.** De technische staginguitrol, publieke rooktest en rollback/herstel zijn geslaagd. Echte OTP-, Google-, Resend- en publieke media-acceptatie staan nog open. De masterprompt vereist functioneel groene staging vóór productiepromotie; v15 is daarom nog niet naar productie gepromoveerd.

| Veld | Staging | Productie |
| --- | --- | --- |
| HTTPS-origin | https://staging.dartflow.nl | https://dartflow.nl |
| Repository / branch | `dartflow/platform` / `main` | Dezelfde geaccepteerde bron-SHA |
| Actieve bron vóór v15 | `4634852c17cc7737bec246c0b48310e975a36920` | `4634852c17cc7737bec246c0b48310e975a36920` |
| Nu actieve bron | `38bceb0dfdfed70046d550e7b2f82839564f41cb` | `4634852c17cc7737bec246c0b48310e975a36920` |
| Nu actieve release | `43038238892-1` | `42995766522-1` |
| Nu actieve configuratie | `staging-2026-11-11-v15-1` | `production-2026-11-11-v1` |
| Voorbereide v15-config | `staging-2026-11-11-v15-1` | `production-2026-11-11-v15-1` |
| Supabase-ref | `dsnqnvbckkqpzadblshu` | `wlrnowuownakqqgjxnbb` |
| Kernschema / uitbreiding | `1` / `v15=15`, toegepast | `1`, uitbreiding wacht op promotie |
| v15-appdeployment | Geslaagd; opnieuw gezond na rollback en herstel | Wacht op geaccepteerde staging |
| Loopback / publieke HTTPS | Health en ready: 200, juiste SHA en configuratie | Health en ready: 200, voorafgaande SHA en configuratie |
| Mailtimer | Actief; oneshot exit 0; effectieve modus Log | Uitgeschakeld tot v15-activatie |
| OTP / Google | Open: eigenaar configureert SMTP en Google-webclient | Open: eigen providerconfiguratie |
| Resend / webhook | Open: eigen app-key, webhook en echte bezorgproef | Open: eigen app-key, webhook en echte bezorgproef |
| Publieke TURN-relay | Hostauthenticatie bewezen; externe netwerkroute nog open | Eigen relay, dezelfde externe afhankelijkheid |

## Bron en herleidbaarheid

De 98 bestanden, Git-blobhashes en Git-tree van de aangeleverde v15-bron zijn geverifieerd. De broncommit is `e27cccdbd0b6cd2144cc2f26cab9e2986a903e61`; dit is de prototypecommit en geen deploy-SHA. De onveranderde referentie heeft 46 geslaagde tests en een geslaagde eigen build. Zie [het bronbewijs](../docs/evidence/v15-source-verification-2026-11-11.json), [de featurematrix](../docs/v15-featurepariteit.md) en de bewaarde overdracht onder `docs/reference/v15`.

De doelapp gebruikt de bestaande Next.js/native releaseketen. Hosted businessdata wordt niet met prototypefixtures gevuld. Synthetische accounts, lokaal media-testmateriaal en fixturemail blijven in de loopback-developmentomgeving.

## Lokale kandidaatcontrole

De definitieve productiebuild slaagt. De volledige applicatiereeks telt **99 geslaagde tests, geen fouten of skips**. De gerichte platformreeks telt 24 gevallen met echte lokale Postgres-transacties. De native deployer-/extractorcontroles tellen 57 gevallen; de hostupgradegrenzen tellen 8 in de appcommit en 10 na de tijdens de uitrol gevonden rechtenreparatie. De behouden prototypebron heeft 46 geslaagde tests.

De zeven browsergevallen gebruiken de productiebuild en afzonderlijke sessies. Ze bewijzen onder meer ontvangen WebRTC-frames met browser-testcamera's, scorebevoegdheid, vaste Sprint-lettergroottes en lange scorekaart, echte fysieke-baankoppeling, sessiegebonden schermlinks, cast preview/program, toernooiaanvraag/review, training en clubchat. De gezamenlijke lokale browseruitvoering is geslaagd: **7/7 in 1,2 minuut**. Ook [CI 43036327257](https://github.com/dartflow/platform/actions/runs/43036327257) voor exact de actieve v15-bron is geslaagd, inclusief alle zeven browsergevallen. Dit bewijst geen fysieke telefoon of externe relayverbinding.

## Werkelijke staginguitrol

De eerste [staginguitrol 43037068421](https://github.com/dartflow/platform/actions/runs/43037068421) slaagde in poging 2. Poging 1 weigerde vóór de doelhostbuild, doordat de operator-upgrader de vaste helper en extractor met modus 0700 had geplaatst. Beide afzonderlijke runner-/builderaccounts moeten deze programmacode kunnen lezen. De gereviewde bestanden hebben nu `root:root 0755`; inhoudsdigests, root-only secrets en sudo-grenzen bleven behouden. De toekomstige upgrader en regressiecontroles zijn gecorrigeerd. Zie [hostvoorbereiding en reparatie](../docs/evidence/v15-host-prepared-2026-11-11.json).

De [publieke browserproef](../docs/evidence/v15-public-staging-2026-11-11.json) controleerde dezelfde bron op desktop en 390/320 px: geladen beelden, geen horizontale overflow, geen browserfouten, geen testaccounts op login, afgeschermde anonieme API's en verborgen mailworker. Staging heeft noindex-metadata. Na herstel zijn de [marketingopnamen opnieuw vastgelegd](../docs/evidence/v15-staging-final-capture-2026-11-11.json).

De [rollbackworkflow 43038096799](https://github.com/dartflow/platform/actions/runs/43038096799) herstelde werkelijk de voorafgaande stagingrelease `42995422162-1` met haar oorspronkelijke configuratie. Loopback en publieke HTTPS waren daarna health/ready 200. Vervolgens herstelde [workflow 43038238892](https://github.com/dartflow/platform/actions/runs/43038238892) exact dezelfde v15-bron, nu als release `43038238892-1`. Kernschema 1 en uitbreiding v15=15 bleven behouden. Zie [rollbackbewijs](../docs/evidence/v15-staging-rollback-2026-11-11.json) en [eindcontrole van de host](../docs/evidence/v15-final-host-2026-11-11.json).

## Database en herstel

De staginguitbreiding voegt functionaliteit toe en behoudt kernschema 1. Alle 44 private tabellen hebben RLS. Browserrollen hebben geen toegang tot het private schema; de runtime kan geen platformrollen toekennen of de eigenaarsallowlist lezen/uitvoeren.

De eigenaarbootstrap heeft bewust geen runtime/browserpolicy: alleen de afgeschermde trigger kan de vooraf aangewezen, geverifieerde Auth-identiteit eenmalig koppelen. Het Supabase-advies hiervoor is informatief en volgt uit die standaardweigering; zie [RLS zonder policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

De applicatiebackup vóór migratie is op de doelhost gemaakt en in een aparte tijdelijke lokale database hersteld. De controle vond de verwachte 18 oorspronkelijke tabellen, nul profielen/wedstrijden en kernschema 1. Dit bewijst applicatieherstel; een volledig Supabase/Auth-herstel wordt daarmee niet geclaimd. De voorafgaande app bleef na de migratie via HTTPS ready. Zie [migratie- en herstelbewijs](../docs/evidence/v15-staging-migration-2026-11-11.json).

## Eigenaarstappen en echte acceptatie

`info@dgwebservices.nl` is door Danny aangewezen als platformeigenaar en ontvanger van echte OTP- en proefmail. Danny heeft gemeld dat Google-webclients en custom SMTP nog niet zijn ingericht. De exacte afzonderlijke projectrefs, callbacks en stappen staan in [het integratierunbook](../docs/v15-integraties.md). Deel geheimen via het beschermde serverpad of de bevoegde write-only beheerformulieren.

Echte Google-login, ontvangst/verificatie van OTP, Resend-bezorging en ondertekende bezorgwebhooks blijven open tot de eigenaar deze providers heeft geconfigureerd. Ook de aangemelde hosted kernflows, twee echte telefoons, een apart Sprint-scherm en fysieke offline-/mediapilot zijn nog niet geaccepteerd. De mailinstellingen beginnen in Log; een geslaagde lokale transportmock telt niet als provideracceptatie.

Op 11 november om 15:07 UTC is precies één toegestane OTP-aanvraag voor `info@dgwebservices.nl` via de publieke staging-UI gedaan. Het code-invoerscherm verscheen met de uniforme HTTP 200-reactie. De aansluitende databasecontrole vond één echte, nog onbevestigde Auth-identiteit en nul profielen/eigenaarsrollen. Verzending, ontvangst en verificatie zijn hiermee niet bewezen; er zijn geen codes verzameld. Zie [het aanvraagbewijs](../docs/evidence/v15-staging-otp-request-2026-11-11.json).

De native relay draait met afzonderlijke credentials en poorten voor beide omgevingen. Zelfproeven op de VPS bewijzen authenticatie, omgevingsscheiding en weigering van private peers. Externe proefpakketten bereikten de publieke doelinterface niet, terwijl gelijktijdig TCP443 wel aankwam. De meting onderscheidt worker-egress en provider-ingress nog niet definitief. Zie [TURN-bewijs](../docs/evidence/v15-turn-native-2026-11-11.json) en [routediagnose](../docs/evidence/v15-turn-route-2026-11-11.json).

Voor de resterende acceptatie zijn deze eigenaarshandelingen nodig:

1. Configureer afzonderlijke Google OAuth-webclients en Resend custom SMTP in beide Supabase-projecten volgens het integratierunbook. Lever de projectgebonden Management-tokens aan via de beschreven root-only overdrachtspaden.
2. Verifieer het verzenddomein en voer per omgeving de eigen Resend-appsleutel en het webhooksecret in via de write-only beheerformulieren. Doorloop eerst op staging een echte OTP- en Google-login, proefmail en ondertekende bezorgwebhook met `info@dgwebservices.nl`.
3. Controleer de providerfirewall van `128.140.93.95`: inkomend TCP+UDP3478/3479 en UDP49160–49199. Als dit al is toegestaan, test vanaf een onafhankelijk netwerk. Daarna volgen de geauthenticeerde publieke relayproef en media-/baantest met fysieke apparaten op afzonderlijke verbindingen.

Na functionele stagingacceptatie kan dezelfde geaccepteerde appbron met de eigen productieconfiguratie worden gepromoveerd: eerst productiebackup en beide expansiemigraties, daarna de expliciete productieworkflow, loopback/publieke verificatie en eigen auth-/mailproeven. De voorbereide productiehostconfiguratie activeert niets vanzelf.

## Omgevingen en beheer

Zie [de omgevingsmatrix](../docs/v15-omgevingen.md), [deployment](../docs/deployment.md) en [SSH-beheer](../docs/ssh-management.md). De bestaande native route heeft vier publieke GitHub Variables per environment en geen zelf aan te maken GitHub-secrets. Database-, integratie-, mailworker- en TURN-geheimen blijven op de doelhost.

De eindcontrole bevestigt dat Milo op poort 4173 gezond is: bron `f1550dd028ef668f09ed6e45a7c6b9d88c4dc5ee`, release `43026808427-1`, configuratie `staging-2026-11-11-v2`, service `milobingo-staging.service`, PID 70911. Caddy en beide afzonderlijke TURN-units zijn actief. Deze uitrol heeft geen Milo-bestanden of -services gewijzigd.
