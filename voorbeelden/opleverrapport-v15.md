# DartFlow v15 — releasebewijs

Peildatum: 11 november 2026. **V15 draait op staging; productie draait de voorafgaande gezonde release.** De technische staginguitrol, publieke rooktest en rollback/herstel zijn geslaagd. De gebruiker heeft ontvangst van de staging-OTP-mail bevestigd. Publieke TURN-gegevensproeven via UDP en TCP zijn voor beide omgevingen geslaagd. Volledige OTP-login, Google-, Resend- en fysieke browser-/media-acceptatie staan nog open. De masterprompt vereist functioneel groene staging vóór productiepromotie; v15 is daarom nog niet naar productie gepromoveerd.

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
| OTP / Google | OTP-ontvangst door gebruiker bevestigd; verificatie/sessie open. SMTP en Google-webclient worden ingericht | Open: eigen providerconfiguratie |
| Resend / webhook | Open: eigen app-key, webhook en echte bezorgproef | Open: eigen app-key, webhook en echte bezorgproef |
| Publieke TURN-relay | Publieke worker- en eigen-hostrelayproeven via UDP-/TCP-control geslaagd; fysieke browserpilot open | Eigen relay: dezelfde proeven geslaagd; v15-browserpilot volgt na promotie |

## Bron en herleidbaarheid

De 98 bestanden, Git-blobhashes en Git-tree van de aangeleverde v15-bron zijn geverifieerd. De broncommit is `e27cccdbd0b6cd2144cc2f26cab9e2986a903e61`; dit is de prototypecommit en geen deploy-SHA. De onveranderde referentie heeft 46 geslaagde tests en een geslaagde eigen build. Zie [het bronbewijs](../docs/evidence/v15-source-verification-2026-11-11.json), [de featurematrix](../docs/v15-featurepariteit.md) en de bewaarde overdracht onder `docs/reference/v15`.

De doelapp gebruikt de bestaande Next.js/native releaseketen. Hosted businessdata wordt niet met prototypefixtures gevuld. Synthetische accounts, lokaal media-testmateriaal en fixturemail blijven in de loopback-developmentomgeving.

## Lokale kandidaatcontrole

De definitieve productiebuild slaagt. De volledige applicatiereeks telt **99 geslaagde tests, geen fouten of skips**. De gerichte platformreeks telt 24 gevallen met echte lokale Postgres-transacties. De native deployer-/extractorcontroles tellen 57 gevallen; de hostupgradegrenzen tellen 8 in de appcommit en 10 na de tijdens de uitrol gevonden rechtenreparatie. De behouden prototypebron heeft 46 geslaagde tests.

De zeven browsergevallen gebruiken de productiebuild en afzonderlijke sessies. Ze bewijzen onder meer ontvangen WebRTC-frames met browser-testcamera's, scorebevoegdheid, vaste Sprint-lettergroottes en lange scorekaart, echte fysieke-baankoppeling, sessiegebonden schermlinks, cast preview/program, toernooiaanvraag/review, training en clubchat. De gezamenlijke lokale browseruitvoering is geslaagd: **7/7 in 1,2 minuut**. Ook [CI 43036327257](https://github.com/dartflow/platform/actions/runs/43036327257) voor exact de actieve v15-bron is geslaagd, inclusief alle zeven browsergevallen. Dit bewijst geen fysieke telefoon of externe relayverbinding.

## Werkelijke staginguitrol

De eerste [staginguitrol 43037068421](https://github.com/dartflow/platform/actions/runs/43037068421) slaagde in poging 2. Poging 1 weigerde vóór de doelhostbuild, doordat de operator-upgrader de vaste helper en extractor met modus 0700 had geplaatst. Beide afzonderlijke runner-/builderaccounts moeten deze programmacode kunnen lezen. De gereviewde bestanden hebben nu `root:root 0755`; inhoudsdigests, root-only secrets en sudo-grenzen bleven behouden. De toekomstige upgrader en regressiecontroles zijn gecorrigeerd. Zie [hostvoorbereiding en reparatie](../docs/evidence/v15-host-prepared-2026-11-11.json).

De [publieke browserproef](../docs/evidence/v15-public-staging-2026-11-11.json) controleerde dezelfde bron op desktop en 390/320 px: geladen beelden, geen horizontale overflow, geen browserfouten, geen testaccounts op login, afgeschermde anonieme API's en verborgen mailworker. Staging heeft noindex-metadata. Na herstel zijn de [marketingopnamen opnieuw vastgelegd](../docs/evidence/v15-staging-final-capture-2026-11-11.json).

De [rollbackworkflow 43038096799](https://github.com/dartflow/platform/actions/runs/43038096799) herstelde werkelijk de voorafgaande stagingrelease `42995422162-1` met haar oorspronkelijke configuratie. Loopback en publieke HTTPS waren daarna health/ready 200. Vervolgens herstelde [workflow 43038238892](https://github.com/dartflow/platform/actions/runs/43038238892) exact dezelfde v15-bron, nu als release `43038238892-1`. Kernschema 1 en uitbreiding v15=15 bleven behouden. Zie [rollbackbewijs](../docs/evidence/v15-staging-rollback-2026-11-11.json) en [de eerdere hostcontrole na appherstel](../docs/evidence/v15-final-host-2026-11-11.json). De actuele controle na de aanvullende TURN-proeven staat onderaan dit rapport.

## Database en herstel

De staginguitbreiding voegt functionaliteit toe en behoudt kernschema 1. Alle 44 private tabellen hebben RLS. Browserrollen hebben geen toegang tot het private schema; de runtime kan geen platformrollen toekennen of de eigenaarsallowlist lezen/uitvoeren.

De eigenaarbootstrap heeft bewust geen runtime/browserpolicy: alleen de afgeschermde trigger kan de vooraf aangewezen, geverifieerde Auth-identiteit eenmalig koppelen. Het Supabase-advies hiervoor is informatief en volgt uit die standaardweigering; zie [RLS zonder policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

De applicatiebackup vóór migratie is op de doelhost gemaakt en in een aparte tijdelijke lokale database hersteld. De controle vond de verwachte 18 oorspronkelijke tabellen, nul profielen/wedstrijden en kernschema 1. Dit bewijst applicatieherstel; een volledig Supabase/Auth-herstel wordt daarmee niet geclaimd. De voorafgaande app bleef na de migratie via HTTPS ready. Zie [migratie- en herstelbewijs](../docs/evidence/v15-staging-migration-2026-11-11.json).

## Eigenaarstappen en echte acceptatie

`info@dgwebservices.nl` is door Danny aangewezen als platformeigenaar en ontvanger van echte OTP- en proefmail. Danny heeft ontvangst van de OTP-mail bevestigd en is nu Google-webclients en Resend custom SMTP aan het inrichten. Deze configuratie is nog niet als afgerond bevestigd. De exacte afzonderlijke projectrefs, callbacks en stappen staan in [het integratierunbook](../docs/v15-integraties.md). Deel geheimen via het beschermde serverpad of de bevoegde write-only beheerformulieren.

OTP-codeverificatie en de aangemelde eigenaarssessie, echte Google-login, Resend-bezorging en ondertekende bezorgwebhooks staan nog open. Ook de aangemelde hosted kernflows, twee echte telefoons, een apart Sprint-scherm en fysieke offline-/mediapilot zijn nog niet geaccepteerd. De mailinstellingen beginnen in Log; een geslaagde lokale transportmock telt niet als provideracceptatie.

Op 11 november om 16:07 Nederlandse tijd (Europe/Amsterdam, CET) is precies één toegestane OTP-aanvraag voor `info@dgwebservices.nl` via de publieke staging-UI gedaan. Het code-invoerscherm verscheen met de uniforme HTTP 200-reactie. De historische databasecontrole direct na die aanvraag vond één echte, nog onbevestigde Auth-identiteit en nul profielen/eigenaarsrollen; deze momentopname blijft ongewijzigd bewaard. Op 11 november om 16:30:55 Nederlandse tijd is de gebruikersbevestiging van ontvangst vastgelegd. OTP-codeverificatie, een geverifieerde sessie en activering van de eigenaarsrol zijn nog niet bevestigd. De ontvangstbevestiging stelt niet vast dat custom SMTP al was ingericht; de gebruiker is die configuratie nu aan het uitvoeren. Er zijn geen codes verzameld en geen nieuwe OTP-aanvragen gedaan. Zie [het aanvraag- en ontvangstbewijs](../docs/evidence/v15-staging-otp-request-2026-11-11.json); machinetijdstempels blijven in UTC.

De native relay draait met afzonderlijke credentials en poorten voor beide omgevingen. De eerste externe proeven bewezen voor staging én productie werkelijke UDP- en TCP-gegevensoverdracht heen en terug. Private IPv4-peers en het eigen host-IP leverden toen 403 op, credentials van de andere omgeving 401 en IPv6-allocaties via UDP én TCP 440. De proefallocaties zijn opgeruimd. Dit [publieke baselinebewijs](../docs/evidence/v15-turn-public-2026-11-11.json) beschrijft de configuratie vóór de aanvullende afscherming voor twee TURN-clients op dezelfde host.

De gebruiker heeft bevestigd dat de externe firewallregels zijn gecontroleerd of toegevoegd; de eerdere routeblokkade is opgelost. Ook de te brede IPv6-peerdeny is gerepareerd, omdat die in de geïnstalleerde coturn IPv4-peers blokkeerde. De services gebruiken `AF_INET AF_UNIX` en behouden de kernelweigering van IPv6 en alle private IPv4-grenzen. Beide apps bleven gezond. Zie [het reparatiebewijs](../docs/evidence/v15-turn-peer-fix-2026-11-11.json). Het [oorspronkelijke TURN-bewijs](../docs/evidence/v15-turn-native-2026-11-11.json) en de [routediagnose](../docs/evidence/v15-turn-route-2026-11-11.json) blijven historische meetstanden.

De aanvullende afscherming voor twee TURN-clients op dezelfde relayhost is geïnstalleerd. Coturn accepteert het eigen publieke IP als peer; de kernel laat dit verkeer vanuit de exacte service-cgroup alleen door wanneer zowel UDP-bron- als doelpoort in hetzelfde omgevingsbereik liggen: staging `49160–49179`, productie `49180–49199`. Andere diensten op het eigen host-IP en het relaybereik van de andere omgeving blijven geblokkeerd. De root-only helper ververst en verifieert de regels atomair vóór iedere TURN-processtart; een fout blokkeert het starten. Een echte stagingherstart met een nieuw cgroup-ID heeft de hernieuwde binding bewezen. Private IPv4- en kernel-IPv6-grenzen en de TURN-secrets bleven behouden. Zie [installatie- en herstartbewijs](../docs/evidence/v15-turn-guard-install-2026-11-11.json).

De [publieke gegevensproef met deze afscherming](../docs/evidence/v15-turn-guarded-public-2026-11-11.json) slaagde op 11 november om 16:58:57 Nederlandse tijd voor beide omgevingen. Werkelijke gegevens gingen heen en terug naar de worker én tussen twee relays op dezelfde host, via UDP- en TCP-controleverbindingen; de peerrelay blijft UDP (`no-tcp-relay`). Iedere eigen-hostrelayproef registreerde precies twee toegestane kerneldatagrammen. Per omgeving zijn zes verboden eigen-IP-doelen beproefd, waaronder de relaypoort van de andere omgeving; ieder datagram verhoogde de kernel-DROP-teller met precies één. Private peers bleven 403 opleveren, credentials van de andere omgeving 401 en IPv6-allocaties via UDP én TCP 440.

Normale `Refresh(0)`-verzoeken zijn bevestigd en alle controlesockets zijn vóór terugkeer gesloten. Quota-vrijgave verloopt asynchroon en is hiermee niet als onmiddellijk bewezen. Een 437 na een mislukte IPv6-allocatie toont alleen aan dat er geen allocatie bestaat. Daarna zijn, na vaststelling van nul actieve eigen relaypoorten, onder het bestaande gedeelde beheerslot alleen de twee eigen TURN-units herstart om resterende testcontrolesessies en uitgestelde quotastaat te verwijderen. Beide guards zijn aan de nieuwe cgroups gebonden; vóór die herstart waren per omgeving vier toegestane en zes geblokkeerde datagrammen vastgelegd. Zie [de afzonderlijke proefopruiming](../docs/evidence/v15-turn-probe-cleanup-2026-11-11.json). De browser-/mediapilot met fysieke apparaten op twee onafhankelijke netwerken staat nog open.

Voor de resterende acceptatie zijn deze eigenaarshandelingen nodig:

1. Rond de inrichting van afzonderlijke Google OAuth-webclients en Resend custom SMTP in beide Supabase-projecten af volgens het integratierunbook. Lever de projectgebonden Management-tokens aan via de beschreven root-only overdrachtspaden.
2. Verifieer het verzenddomein en voer per omgeving de eigen Resend-appsleutel en het webhooksecret in via de write-only beheerformulieren. Voltooi eerst op staging de OTP-codeverificatie en controle van de aangemelde eigenaarssessie, en doorloop een echte Google-login, proefmail en ondertekende bezorgwebhook met `info@dgwebservices.nl`.
3. Voer op staging de fysieke media-/baantest uit met twee echte telefoons op onafhankelijke netwerken en een apart 9:16-Sprint-scherm. Controleer camera-/microfoonweigering, werkelijk ontvangen media, reconnect, cleanup, schrijverwissel, een lange leg en een gecontroleerde netwerkonderbreking. Leg toestellen, netwerken, bron-SHA en waarnemingen vast.

Na functionele stagingacceptatie kan dezelfde geaccepteerde appbron met de eigen productieconfiguratie worden gepromoveerd: eerst productiebackup en beide expansiemigraties, daarna de expliciete productieworkflow, loopback/publieke verificatie en eigen auth-/mailproeven. De voorbereide productiehostconfiguratie activeert niets vanzelf.

## Omgevingen en beheer

Zie [de omgevingsmatrix](../docs/v15-omgevingen.md), [deployment](../docs/deployment.md) en [SSH-beheer](../docs/ssh-management.md). De bestaande native route heeft vier publieke GitHub Variables per environment en geen zelf aan te maken GitHub-secrets. Database-, integratie-, mailworker- en TURN-geheimen blijven op de doelhost.

De [laatste hostcontrole na TURN-opruiming](../docs/evidence/v15-post-turn-host-2026-11-11.json) bevestigt op 11 november om 16:59:51 Nederlandse tijd voor beide DartFlow-omgevingen publieke en loopback-health/ready 200 met de bron-, release- en configuratie-identiteiten uit de tabel. Caddy en beide TURN-units zijn actief; de guards zijn aan de actuele cgroups gebonden en de helper is `root:root 0700` met de verwachte inhoudsdigest. De stagingmailtimer is actief en de laatste uitvoering eindigde met exitstatus 0; de productietimer is uitgeschakeld.

Milo op poort 4173 blijft gezond met bron `f1550dd028ef668f09ed6e45a7c6b9d88c4dc5ee`, release `43026808427-1`, configuratie `staging-2026-11-11-v2`, service `milobingo-staging.service` en dezelfde PID 70911. Deze uitrol heeft geen Milo-bestanden of -services gewijzigd.
