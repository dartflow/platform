# Acceptatierapport Dartflow staging

Rapportdatum: 10 november 2026 (Europe/Amsterdam). Dit is lokaal bewijs; serveracceptatie staat apart en blijft Open totdat de echte stagingomgeving is gecontroleerd.

| Vast te leggen | Waarde / bronbewijs |
|---|---|
| Lokale werkmap | `/home/codex/repos/dartflow` |
| Doelrepo en volledige broncommit | Open — doelrepo niet beschikbaar in geverifieerde GitHub-inventaris; lokale workspace heeft geen Git-remote |
| Gewenste HTTPS-origin | `https://staging.dartflow.nl` |
| Site-ID, host, appuser, runner, UID, labels, loopbackpoort | Open — goedgekeurde DG-inventory ontbreekt |
| Supabase-project / migratieversie / beperkte app-role | Open — geïsoleerde stagingvoorziening nog niet aangesloten |
| CI en deployrun | Open — workflows lokaal voorbereid, niet naar GitHub geschreven of gestart |
| Actieve stagingrelease / externe runtime-SHA | Open — geen deploy uitgevoerd |
| Rollback / backup / geïsoleerde restore | Open — host, wrappercontract en herstelbeleid ontbreken |

| Controle | Status | Bewijs en tijdstip |
|---|---|---|
| Lokale locked install, typecontrole, lint, tests en build | Open | In te vullen met de werkelijk gedraaide controles op de lokale app |
| Lokaal standalone-releasepakket zonder runtime-env | Open | `node ops/package-release.mjs`; archive/checksum/manifest in `artifacts/` |
| Lokale twee-account pilotflow en herstartbestendigheid | Open | Lokale tests; vervangt geen geverifieerde stagingidentiteit |
| Lokale viewportcontrole en QR-deeplink | Open | In te vullen met browserbewijs |
| GitHub CI op volledige kandidaat-SHA | Open | Werkelijke repository en run nodig |
| Juiste runner, UID, host, workspace en beperkte rechten | Open | Alleen na inventarisatie op bedoelde host |
| Actieve SHA gelijk via loopback en extern HTTPS | Open | Alleen na native uitrol |
| Database/readiness met beperkte stagingrol | Open | Backend en migraties nog aan te sluiten |
| OTP ontvangen door toegestane ontvanger; juiste/foute/verlopen code | Open | Geen provider- of mailtest uitgevoerd |
| Google OAuth, callback, sessie en QR-hervatting | Open | Geen providerconfiguratie gewijzigd |
| Vervalste rol, directe API en tweede club geweigerd in echte staging | Open | Aanvullend op lokale negatieve tests |
| Twee telefoons: check-in, bordoproep, QR, score, overname, retry | Open | Fysieke toestellen vereist |
| Definitieve uitslag precies één keer en gedeelde 9:16-revisie | Open | Echte stagingpilot vereist |
| iOS Safari / Android Chrome met geopend toetsenbord | Open | Niet te vervangen door alleen een desktopemulatie |
| Parallelle/onderbroken deploy, compatibele rollback en geïsoleerde restore | Open | Werkelijke DG-deploygrens vereist |

Gebruik Pass, Fail, Open of gemotiveerd N.v.t. Vul nooit Pass in op basis van alleen aangeleverde prototypeclaims of een gegenereerde template. Noteer testtijd, omgeving, exacte bronrevisie en bewijslink; verwijder tokens, OTP-codes, cookies, persoonsgegevens en sessieheaders uit exports.
