# DG Webservices projectintake en startopdracht

Vul dit formulier in voor ieder nieuw project of iedere nieuwe doel-VPS. Zie de [volledige uitrolprocedure](dg-webservices-uitrolprocedure.md) voor uitvoering en acceptatie.

Dit document verzamelt invoer en besluiten. Het is geen automatische provisioner; installatie, rechten en werking worden tijdens de uitvoering gecontroleerd en bewezen. Gebruik alleen verwijzingen naar geheimen, nooit hun waarden.

## 1 Project en opdracht

| Veld | Invullen |
|---|---|
| Projectnaam / korte projectcode | `<naam>` / `<code>` |
| Opdrachtgever / technisch eigenaar | `<naam of team>` / `<naam of team>` |
| GitHub-repository / integratiebranch | `<owner/repository>` / `<branch, gewoonlijk main>` |
| Gewenste functionaliteit / acceptatiecriteria | `<scope of documentverwijzing>` |
| Bestaand projectprofiel / runbook | `<pad of link>` |
| Gewenste opleverdatum / onderhoudsvenster | `<datum>` / `<venster, Europe/Amsterdam>` |

Kies infrastructuur: `[ ] bestaande VPS uitbreiden` `[ ] nieuwe VPS inrichten`.

Kies releasescope: `[ ] alleen voorbereiding` `[ ] staging` `[ ] staging én productie`.

Productiedeployment expliciet toegestaan: `[ ] ja` `[ ] nog niet`. Bewijs/verwijzing naar bestaande toestemming en eventuele voorwaarden: `<bericht, besluit of opdracht>`.

Eerder verleende bevoegdheden blijven gelden binnen hun scope. Nog benodigde externe besluiten over account, abonnement, kostenbudget of toegang: `<besluit + verantwoordelijke>`.

## 2 Development en doel VPS

| Veld | Invullen |
|---|---|
| Dev-VPS / checkoutpad / werkbranch | `<host>` / `<absoluut pad>` / `<branch>` |
| Doelhost / providerresource / regio | `<host>` / `<resourceverwijzing>` / `<regio>` |
| OS / architectuur / servicebeheer | `<distributie en versie>` / `<architectuur>` / `<beheerder en versie>` |
| Tailscale-hostnaam / IP | `<naam>` / `<IP>` |
| Publiek IPv4 / publiek IPv6 | `<IPv4>` / `<IPv6 of niet gebruikt>` |
| Providerproject / capaciteit / kostenbudget | `<verwijzing>` / `<CPU, RAM, disk>` / `<budget en eigenaar>` |
| Bestaande sites en te behouden services | `<inventarisverwijzing>` |
| DNS-beheerder / providerconsole / hersteltoegang | `<eigenaar>` / `<verwijzingen>` |

Bij een nieuwe VPS: leg de gekozen baseline, firewallregels, updates, logging, monitoring, back-updoel en Tailscale-toelating vast: `<profiel of document>`.

## 3 Omgevingen en DNS

| Veld | Staging | Productie |
|---|---|---|
| Canonieke HTTPS-origin | `<origin>` | `<origin>` |
| Extra hostnamen / redirects | `<hostnamen of geen>` | `<hostnamen of geen>` |
| Site-ID / service | `<ID>` / `<service>` | `<ID>` / `<service>` |
| DNS A / AAAA / proxyinstelling | `<waarden of verwijzing>` | `<waarden of verwijzing>` |
| Loopbackadres en te reserveren poort | `<adres:poort>` | `<adres:poort>` |
| Eigen runner- / build- / appaccount | `<namen>` | `<namen>` |
| Runnernaam en exacte labels | `<naam en labels>` | `<naam en labels>` |
| Releasepad / gedeeld datapad | `<paden>` | `<paden>` |
| Configuratie-ID / bundelpad | `<ID en pad>` | `<ID en pad>` |

Controleer vrije poorten en bestaande hostcontracten vóór installatie. Een AAAA-record wordt alleen gebruikt wanneer diezelfde omgeving aantoonbaar via IPv6 werkt. Leg DNS- en TLS-controle afzonderlijk vast.

## 4 Supabase Auth en mail

| Veld | Invullen |
|---|---|
| Beheerorganisatie / accountnaam / eigenaar | `<organisatie>` / `<account>` / `<eigenaar>` |
| Verbonden beheeraccount met toegang tot beide projecten | `<naam en geverifieerde projecttoegang>` |
| Stagingproject: naam / ref / regio / plan | `<naam>` / `<ref>` / `<regio>` / `<plan>` |
| Productieproject: naam / ref / regio / plan | `<naam>` / `<ref>` / `<regio>` / `<plan>` |
| Bestaande gegevens / migratiegeschiedenis | `<inventaris en migratiepad>` |
| Runtime-DBrol / beheerrol / toegangsmodel | `<rollen en grants/RLS-contract>` |
| Schema, Storage en Edge Functions binnen scope | `<vereiste onderdelen of geen>` |
| Auth-methoden en toegestane testaccounts | `<OTP, Google, overige; accountverwijzingen>` |
| SMTP-/mailprovider en afzenderdomein | `<provider en domein of buiten scope>` |
| Google-providerproject / credentialverwijzing | `<verwijzingen of buiten scope>` |
| Site URL, appcallbacks en providercallbacks per omgeving | `<configuratieverwijzing>` |

Gebruik twee afzonderlijke projecten: controleer de bestaande projecten of maak nieuwe aan wanneer ze ontbreken. Een nieuwe VPS vereist op zichzelf geen nieuwe Supabase-projecten. Een Supabase-beheeraccount, organisatie, project en applicatiegebruiker zijn verschillende identiteiten. Bevestig projecttoegang met een echte leesactie; een zichtbare connectornaam is daarvoor onvoldoende.

Leg betaalde plannen, regio en budget vooraf vast. Geef secrets alleen via het afgesproken beheerpad door. Toegestane ontvangers en toestemming voor echte testmail: `<afspraak of nog te besluiten>`.

## 5 SSH toegang voor de worker

| Veld | Invullen |
|---|---|
| Eigen beheeraccount / workerhost | `<account>` / `<worker>` |
| Toegestane bron: Tailscale-IP of beheerde identiteit | `<bron>` |
| Publieke sleutel / fingerprint | `<publieke-sleutelverwijzing>` / `<fingerprint>` |
| Privésleutel- en SSH-configlocatie op worker | `<paden buiten Git; geen inhoud>` |
| Vertrouwde hostkey / onafhankelijke verificatie | `<fingerprint en verificatiebron>` |
| Ingangsdatum / exacte afloop na één jaar | `<UTC-tijd>` / `<UTC-tijd en Europe/Amsterdam>` |
| Noodzakelijke sudo-bevoegdheid / geldende opdracht | `<scope en verwijzing>` |
| Intrekken, verlengen en consoleherstel | `<procedure en verantwoordelijke>` |

Gebruik een eigen sleutel, vergrendeld accountwachtwoord, strikte hostkeycontrole en de afgesproken bronbeperking. Controleer toegang met een nieuwe SSH-sessie en noodzakelijke sudo. Houd beheeridentiteit, CI-runner, buildaccount en appaccount gescheiden.

## 6 Configuratie toolchain en geheimen

| Veld | Invullen |
|---|---|
| Node / package manager / lockfile | `<gepinde versies en pad>` |
| Installatie-, test-, build- en startcommando's | `<projectcommando's>` |
| Native deploycontract / versie / installatiebewijs | `<ingang, policy en versie/hashes>` |
| GitHub-environments / publieke variabelen | `<namen en configuratieverwijzing>` |
| Eventueel vereiste GitHub-secrets | `<alleen namen en bestemming, of geen>` |
| Publieke buildconfig / runtimeconfigbundels | `<beschermde locaties en toegestane sleutels>` |
| DBbeheer-, provider-, SMTP- en Google-secrets | `<kluis- of platformverwijzingen>` |
| Buildcapaciteit, gedeelde lock en bewaarbeleid | `<grenzen, lockpad en retentie>` |

Neem versies, poorten en accountnamen uit het projectprofiel over en verifieer ze op de doelhost. Publieke buildwaarden verschillen per omgeving; wijziging van `NEXT_PUBLIC_*` vereist een nieuwe build. Leg vast hoe GitHub-variabelen en hostbundels gelijk blijven.

## 7 Acceptatie herstel en beheer

| Veld | Invullen |
|---|---|
| Verplichte CI-workflow / jobs / gebruikersflows | `<namen en scenario's>` |
| Functioneel acceptant / productie-eigenaar | `<namen of teams>` |
| Back-updoel / versleuteling / retentie | `<verwijzingen en beleid>` |
| RPO / RTO / laatste geldige geïsoleerde restoretest | `<doelen en bewijs>` |
| Migratiecompatibiliteit / approllback / dataherstel | `<drie afzonderlijke procedures>` |
| Monitoring / alerts / incidentcontact / onderhoud | `<verwijzingen en eigenaar>` |
| Bewijsmap / expliciete uitzonderingen | `<pad>` / `<afspraken of geen>` |

Acceptatie vereist bewijs van de exacte SHA, CI, eigen configuratie, loopback én publieke HTTPS-health/readiness, relevante echte gebruikersflows en het afgesproken herstelpad. Noteer ontbrekende of overgeslagen proeven expliciet.

## 8 Kopieerbare startopdracht

```text
Voer de ingevulde DG Webservices-projectintake uit volgens de bijbehorende uitrolprocedure.
Intake/projectprofiel: <pad of link>. Releasescope: <voorbereiding / staging / staging en productie>.
Bestaande bevoegdheden en productieautorisatie: <verwijzing en voorwaarden>.
Onderzoek eerst repository, hostcontracten, accounttoegang en bestaande services. Werk routineuze,
omkeerbare voorbereiding en controles zelfstandig af binnen deze scope en behoud overige services.
Gebruik gescheiden staging-/productieprojecten, identiteiten en configuratie. Laat één volledige,
groene bron-SHA eerst op staging accepteren en bouw diezelfde SHA voor geautoriseerde productie.
Vraag alleen om besluiten of toegang die werkelijk ontbreken; werk onafhankelijke onderdelen door.
Externe account-, abonnement-, budget- en toegangsbesluiten blijven bij de genoemde eigenaar.
Destructieve acties en herstel van gegevens vereisen een afzonderlijke, concrete machtiging.
Lever projectprofiel, exacte configuratienamen en locaties, CI-/releasebewijs, beperkingen en herstelpad op.
```
