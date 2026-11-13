# SocialHero-analytics

De website toont bij een eerste bezoek een analyticsbanner met **Analytics accepteren** en **Analytics weigeren**. Beide keuzes hebben dezelfde nadruk. Na een keuze opent **Privacyvoorkeuren** de instellingen opnieuw; kiezen voor weigeren trekt eerdere toestemming direct in.

Zonder geldige toestemming wordt het externe SocialHero-script niet opgehaald. De callback zet eerst `window.socialheroConsent` en verstuurt daarna `CustomEvent('socialhero:consent', {detail: true})` of dezelfde gebeurtenis met `false`. Daardoor werkt toestemming ook als het script later pas arriveert. Intrekken tijdens het laden houdt de uiteindelijke pixel uitgeschakeld.

De keuze staat per browser en per origin maximaal 180 dagen in `localStorage`, onder `dartflow.analytics-consent.v1`. Er wordt geen account-ID of analytics-ID in de voorkeur opgenomen. Onbekende, beschadigde, verlopen of onleesbare voorkeuren geven geen toestemming. Bij een opslagfout meldt de banner dat de keuze niet kon worden onthouden; een mislukte intrekking blijft in het huidige tabblad een weigering, ook bij focus of reconnect.

De browserinstellingen Do Not Track en Global Privacy Control houden analytics uitgeschakeld. Andere geopende tabbladen volgen wijzigingen via de bestaande browseropslaggebeurtenis; terugkeren naar de pagina leest de voorkeur opnieuw.

Op actieve wedstrijd-/trainingweergaven en vaste Oche Live-/Scorebord-routes zijn analytics en de banner verborgen zodat de scorebediening en het scherm vrij blijven. Privacyvoorkeuren zijn op de overige website- en spelerspagina's bereikbaar. De lokale ontwikkel-/CI-omgeving laadt de externe pixel niet.

De script-URL en publieke sitecode komen uit de gebruikersopdracht. Er zijn geen nieuwe secrets, GitHub-variabelen, databasewijzigingen of provideraccounts nodig.

Gerichte regressies staan in `tests/analytics-consent.test.ts`: standaard weigeren, opslag/expiry/fouten, de callbackvolgorde, intrekken bij geblokkeerde opslag, browserprivacy en de schermroutes.
