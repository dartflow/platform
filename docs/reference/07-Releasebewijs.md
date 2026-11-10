# Prototypeversie en releasebewijs

| Onderdeel | Waarde |
|---|---|
| Prototype | Dartflow versie 11 |
| Broncommit | `578f58eceabae88e5fce5676c6740d66a6eae689` |
| Gepubliceerd | 10 november 2026 om 11:18 CET |
| Runtime voor lokale verificatie | Node 24.22.1 |
| Werkend prototype | [Open Vandaag](https://puinruimers-darts-demo.dgwebserv.chatgpt.site/#home) |
| Werkende 9:16-demoflow | [Open Baanmodus](https://puinruimers-darts-demo.dgwebserv.chatgpt.site/#baan) |

## Reproduceer de lokale controle

Open `prototype/` en voer `npm test` en `npm run build` uit. Gebruik `npm run dev` voor de demo. De build is de prototypebuild en maakt een Worker. Gebruik de DG-bouwstappen uit 04 voor de eigen stagingapp.

| Controle | Uitkomst |
|---|---|
| Tests op de meegeleverde bron | 26 geslaagd |
| Build en Worker-syntax | Geslaagd |
| Mobiele Chrome-controle | 13 routeweergaven in de viewportmatrix. Zie 06 voor interacties en afmetingen. |
| Live versie | Gepubliceerd en gecontroleerd op de aanwezigheid van de mobiele stylesheet. |
| Echte staging-auth, fysieke toestellen en serveracceptatie | Open. Gebruik het rapport onder voorbeelden/. |

De geslaagde prototypechecks gelden voor deze broncommit. Test de DG-release, providerconfiguratie en de eerste clubavond opnieuw op de staging-SHA.
