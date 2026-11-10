# Dartflow staging: inventaris en open punten

Momentopname: 10 november 2026 (Europe/Amsterdam). Dit bestand bevat geen geheimwaarden.

| Onderdeel | Status | Bron / vervolgstap |
|---|---|---|
| Lokale doelmap | Vastgesteld | `/home/codex/repos/dartflow`; aanvankelijk leeg en zonder `.git` of remote |
| Gewenst stagingdomein | Vastgesteld | Gebruikersopdracht: `staging.dartflow.nl` |
| Prototypebasis | Aangeleverd | Overdracht v11; vermelde prototype-SHA `578f58eceabae88e5fce5676c6740d66a6eae689`, geen SHA van deze nieuwe Next-app |
| DG VPS-standaard / dashboardblauwdruk | Gelezen | Beide DOCX-bestanden versie 1, 4 november 2026 |
| Applicatierepository | Open | GitHub-connectorinventaris toont 17 toegankelijke repositories, geen Dartflow- of DG-infra-doelrepo; de publieke zoekresultaten bij `dartflow` zijn niet als doelrepo aangewezen |
| Standaardbranch / branchbeleid | Open | Zonder geverifieerde doelrepo niet vast te stellen; geen branchnaam aangenomen |
| Bestaande GitHub-environments / secrets / runners | Open | Doelrepo en beheerrechten moeten eerst eenduidig beschikbaar zijn; geen geheime waarden gelezen |
| DG-masterdocument Bouw en deploy versie 2 | Open | Niet opgenomen in ZIP; aan te leveren via DG-beheerbron |
| Infra-inventory / zeven bestaande hosts | Open | Geen aangewezen host, provider-ID, beheerverbinding of inventory aanwezig |
| Geïnstalleerde dg-site-deploy-bron en rechten | Open | Inspecteer in de aangewezen beheeromgeving; geen flags of sudo-regels aangenomen |
| DNS, A/AAAA, TLS, Tailscale, firewall | Open | Verifieer doelhost en onafhankelijke hostkey vóór beheerverbinding |
| Site-ID, appuser, runner, UID, labels, workspace, unit, poort | Open | Invullen uit goedgekeurde DG-inventory; templates zijn niet toepasbaar met placeholders |
| Supabase stagingproject en Auth-providers | Open | Alleen-lezen `list_projects` op beide beschikbare accounts, 10 november 2026: geen herkenbaar Dartflow-/stagingproject. Andere projecten niet geselecteerd of gewijzigd. Geïsoleerd project, beperkte app-role, geteste redirects en goedgekeurde testontvangers vereist |
| Capaciteit, locking, retentie, backups, RPO/RTO, restore | Open | Meten en bewijzen op de beoogde acceptatie-/staginghost |
| Live stagingrelease | Open | Geen externe mutaties, GitHub-writes, DNS-wijziging of deploy uitgevoerd |

De GitHub-inventarisatie is alleen-lezen uitgevoerd via `list_repositories` en `search_repositories`. Er is geen willekeurige publieke repository gekloond of als projectdoel gekozen. De geraadpleegde connector biedt geen bewijs van hostconfiguratie. De exacte lokale appversies en testresultaten staan in `package-lock.json` en het acceptatierapport.
