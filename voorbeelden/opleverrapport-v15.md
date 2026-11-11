# DartFlow v15 — releasebewijs

Peildatum: 11 november 2026. Dit rapport wordt bijgewerkt met de daadwerkelijke release-uitkomsten. Een voorbereide hostconfiguratie, een lokale browsertest en een externe providerproef zijn afzonderlijke bewijzen.

| Veld | Staging | Productie |
| --- | --- | --- |
| HTTPS-origin | https://staging.dartflow.nl | https://dartflow.nl |
| Repository / branch | `dartflow/platform` / `main` | Dezelfde geaccepteerde bron-SHA |
| Actieve bron vóór v15 | `4634852c17cc7737bec246c0b48310e975a36920` | `4634852c17cc7737bec246c0b48310e975a36920` |
| Voorbereide v15-config | `staging-2026-11-11-v15-1` | `production-2026-11-11-v15-1` |
| Supabase-ref | `dsnqnvbckkqpzadblshu` | `wlrnowuownakqqgjxnbb` |
| Kernschema / uitbreiding | `1` / `v15=15`, toegepast | `1`, uitbreiding wacht op promotie |
| v15-appdeployment | Nog vast te leggen | Wacht op geaccepteerde staging |
| OTP / Google | Open: eigenaar configureert SMTP en Google-webclient | Open: eigen providerconfiguratie |
| Resend / webhook | Open: eigen app-key, webhook en echte bezorgproef | Open: eigen app-key, webhook en echte bezorgproef |
| Publieke TURN-relay | Hostauthenticatie bewezen; externe netwerkroute nog open | Eigen relay, dezelfde externe afhankelijkheid |

## Bron en herleidbaarheid

De 98 bestanden, Git-blobhashes en Git-tree van de aangeleverde v15-bron zijn geverifieerd. De broncommit is `e27cccdbd0b6cd2144cc2f26cab9e2986a903e61`; dit is de prototypecommit en geen deploy-SHA. De onveranderde referentie heeft 46 geslaagde tests en een geslaagde eigen build. Zie [het bronbewijs](../docs/evidence/v15-source-verification-2026-11-11.json), [de featurematrix](../docs/v15-featurepariteit.md) en de bewaarde overdracht onder `docs/reference/v15`.

De doelapp gebruikt de bestaande Next.js/native releaseketen. Hosted businessdata wordt niet met prototypefixtures gevuld. Synthetische accounts, lokaal media-testmateriaal en fixturemail blijven in de loopback-developmentomgeving.

## Lokale kandidaatcontrole

De definitieve productiebuild slaagt. De volledige applicatiereeks telt **99 geslaagde tests, geen fouten of skips**. De gerichte platformreeks telt 24 gevallen met echte lokale Postgres-transacties. De native deployer-/extractorcontroles tellen 57 gevallen en de hostupgradegrenzen 8. De behouden prototypebron heeft 46 geslaagde tests.

De zeven browsergevallen gebruiken de productiebuild en afzonderlijke sessies. Ze bewijzen onder meer ontvangen WebRTC-frames met browser-testcamera's, scorebevoegdheid, vaste Sprint-lettergroottes en lange scorekaart, echte fysieke-baankoppeling, sessiegebonden schermlinks, cast preview/program, toernooiaanvraag/review, training en clubchat. De gezamenlijke lokale browseruitvoering is geslaagd: **7/7 in 1,2 minuut**. De CI-run voor de definitieve commit wordt na uitvoering hieronder vastgelegd. Dit bewijst geen fysieke telefoon of externe relayverbinding.

## Database en herstel

De staginguitbreiding voegt functionaliteit toe en behoudt kernschema 1. Alle 44 private tabellen hebben RLS. Browserrollen hebben geen toegang tot het private schema; de runtime kan geen platformrollen toekennen of de eigenaarsallowlist lezen/uitvoeren.

De eigenaarbootstrap heeft bewust geen runtime/browserpolicy: alleen de afgeschermde trigger kan de vooraf aangewezen, geverifieerde Auth-identiteit eenmalig koppelen. Het Supabase-advies hiervoor is informatief en volgt uit die standaardweigering; zie [RLS zonder policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

De applicatiebackup vóór migratie is op de doelhost gemaakt en in een aparte tijdelijke lokale database hersteld. De controle vond de verwachte 18 oorspronkelijke tabellen, nul profielen/wedstrijden en kernschema 1. Dit bewijst applicatieherstel; een volledig Supabase/Auth-herstel wordt daarmee niet geclaimd. De voorafgaande app bleef na de migratie via HTTPS ready. Zie [migratie- en herstelbewijs](../docs/evidence/v15-staging-migration-2026-11-11.json).

## Eigenaarstappen en echte acceptatie

`info@dgwebservices.nl` is door Danny aangewezen als platformeigenaar en ontvanger van echte OTP- en proefmail. Danny heeft gemeld dat Google-webclients en custom SMTP nog niet zijn ingericht. De exacte afzonderlijke projectrefs, callbacks en stappen staan in [het integratierunbook](../docs/v15-integraties.md). Deel geheimen via het beschermde serverpad of de bevoegde write-only beheerformulieren.

Echte Google-login, ontvangst/verificatie van OTP, Resend-bezorging en ondertekende bezorgwebhooks blijven open tot de eigenaar deze providers heeft geconfigureerd. De mailinstellingen beginnen in Log; een geslaagde lokale transportmock telt niet als provideracceptatie.

De native relay draait met afzonderlijke credentials en poorten voor beide omgevingen. Zelfproeven op de VPS bewijzen authenticatie, omgevingsscheiding en weigering van private peers. Externe proefpakketten bereikten de publieke doelinterface nog niet; de externe firewall/netwerkroute moet worden gecontroleerd vóór de echte relayproef. Zie [TURN-bewijs](../docs/evidence/v15-turn-native-2026-11-11.json).

## Omgevingen en beheer

Zie [de omgevingsmatrix](../docs/v15-omgevingen.md), [deployment](../docs/deployment.md) en [SSH-beheer](../docs/ssh-management.md). De bestaande native route heeft vier publieke GitHub Variables per environment en geen zelf aan te maken GitHub-secrets. Database-, integratie-, mailworker- en TURN-geheimen blijven op de doelhost.

De laatste vóór deze uitrol gemeten Milo-release op poort 4173 was `f1550dd028ef668f09ed6e45a7c6b9d88c4dc5ee`, release `43026808427-1`, configuratie `staging-2026-11-11-v2`, service `milobingo-staging.service`, PID 70911. Deze gedeelde dienst valt buiten DartFlow en wordt niet gewijzigd.
