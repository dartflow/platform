# SocialHero-analytics

De website toont bij een eerste bezoek een analyticsbanner met **Analytics accepteren** en **Analytics weigeren**. Beide keuzes hebben dezelfde nadruk. Na een keuze opent **Privacyvoorkeuren** de instellingen opnieuw; kiezen voor weigeren trekt eerdere toestemming direct in.

Zonder geldige toestemming wordt het externe SocialHero-script niet opgehaald. De callback zet eerst `window.socialheroConsent` en verstuurt daarna `CustomEvent('socialhero:consent', {detail: true})` of dezelfde gebeurtenis met `false`. Daardoor werkt toestemming ook als het script later pas arriveert. Intrekken tijdens het laden houdt de uiteindelijke pixel uitgeschakeld.

De opgeslagen keuze is per browser en per origin maximaal 180 dagen geldig. Deze staat in `localStorage`, onder `dartflow.analytics-consent.v1`. Er wordt geen account-ID of analytics-ID in de voorkeur opgenomen. Onbekende, beschadigde, verlopen of onleesbare voorkeuren geven geen toestemming. Bij een opslagfout meldt de banner dat de keuze niet kon worden onthouden; een mislukte intrekking blijft in het huidige tabblad een weigering, ook bij focus of reconnect.

De browserinstellingen Do Not Track en Global Privacy Control houden analytics uitgeschakeld. Andere geopende tabbladen volgen wijzigingen via de bestaande browseropslaggebeurtenis; terugkeren naar de pagina leest de voorkeur opnieuw.

Op actieve wedstrijd-/trainingweergaven en vaste Oche Live-/Scorebord-routes zijn analytics en de banner verborgen zodat de scorebediening en het scherm vrij blijven. Privacyvoorkeuren zijn op de overige website- en spelerspagina's bereikbaar. De lokale ontwikkel-/CI-omgeving laadt de externe pixel niet.

De script-URL en publieke sitecode komen uit de gebruikersopdracht. Er zijn geen nieuwe secrets, GitHub-variabelen, databasewijzigingen of provideraccounts nodig.

Gerichte regressies staan in `tests/analytics-consent.test.ts`: standaard weigeren, opslag/expiry/fouten, de callbackvolgorde, intrekken bij geblokkeerde opslag, browserprivacy en de schermroutes.

## Uitrol en verificatie · 13 november 2026

De geteste applicatiebron is `5d855fdfc9641f1a7869d6997d2151c356c1f6d8`. [CI 43401457925](https://github.com/dartflow/platform/actions/runs/43401457925) slaagt: typecheck, lint, build, 350 applicatie-/databasetests, 61 browserscenario's en de bestaande prototype- en infrastructuurcontroles.

| Omgeving | Native uitrol | Actieve release | Consentproef afgerond |
| --- | --- | --- | --- |
| [Staging](https://staging.dartflow.nl) | [43402748408](https://github.com/dartflow/platform/actions/runs/43402748408), geslaagd | `43402748408-1` | 10:39:39 CET |
| [Productie](https://dartflow.nl) | [43403183099](https://github.com/dartflow/platform/actions/runs/43403183099), geslaagd | `43403183099-1` | 10:42:47 CET |

Beide omgevingen gebruiken dezelfde bron en hun bestaande, afzonderlijke v19-build/runtimeconfiguratie. De eindcontrole bevestigt acht gezonde publieke/loopback health-/readinessroutes, actieve apps/runners/TURN/mailtimers, nul app-/mail-/verlopen-workerfouten, ongewijzigde Caddy-configuratie en een vrije gedeelde buildlock. De onafhankelijke Milo-app is behouden.

Per omgeving zijn zeven geïsoleerde Chromium-contexten gebruikt, met desktop 1440×900 en mobiel 390×844:

- Eerste bezoek en opgeslagen weigering: geen SocialHero-scriptverzoek en geen events.
- Expliciet accepteren en herladen: `true` vóór de script-GET, één async script per document, HTTP 200 JavaScript en de werkende SocialHero-API.
- Intrekken: direct `false`, geen volgende events en een blijvende weigering na herladen.
- Intrekken terwijl de echte scriptdownload nog wacht: het later arriverende script houdt metingen uitgeschakeld.
- Twee tabbladen: de intrekking werkt via een echte opslaggebeurtenis door naar de andere pagina.
- Geblokkeerde voorkeurenschrijfacties met een oude opgeslagen toestemming: intrekken blijft in dit tabblad actief, ook na focus-/zichtbaarheidsrefresh, en de opslagmelding verschijnt.
- Gesimuleerde Global Privacy Control: accepteren is uitgeschakeld en er zijn geen vendorverzoeken.
- Uitval van het externe script: de website en haar interactieve tabbladen blijven werken.

De script-GET's gaan naar de echte SocialHero-server. Alle negen analytics-events per omgeving zijn lokaal in de testbrowser onderschept; geen ervan is doorgestuurd. Er zijn geen accounts ingelogd, wedstrijden gewijzigd of echte bezoekerscijfers aangemaakt. Deze proeven bewijzen de consentkoppeling en clientcode; daadwerkelijke ontvangst in het SocialHero-dashboard en bediening op fysieke apparaten zijn niet getest.

Bewijzen op de development-VPS: `.local/socialhero-ci.log`, `.local/socialhero-{staging,production}-smoke.json`, de bijbehorende mobiele screenshots en `.local/socialhero-final-host-check.json`.
