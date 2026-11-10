# Routes en bestaande links

| Stagingroute | Functie | Prototype-ingang |
|---|---|---|
| `/` | Vandaag, actuele eigen partijen en agenda | `/#home` |
| `/spelen` | Banen en eigen wedstrijden; overige spelvormen gemarkeerd | `/#play`, `/#baan` |
| `/evenementen` | Inschrijving, wachtlijst, check-in | `/#events` |
| `/wedstrijdleiding` | Deelnemers, planning, oproep, schermkoppeling | `/#operations`, `/#venue`, `/#dashboard` |
| `/clubbeheer` | Eigen clubcontext en servertoegekende rollen; overig beheer nog niet beschikbaar | `/#manage`, `/#clubs` |
| `/historie` | Bevestigde eigen uitslagen en clubavondstand | `/#mymatches` |
| `/wedstrijd/{uuid}` | Eén onveranderlijke wedstrijdidentiteit | `/#match/{uuid}` |
| `/baan/{uuid}` | Actuele baancontext, daarna expliciete deelname aan huidige partij | `/#baan-phone/{uuid}` |
| `/scherm/{capability}` | Zelfstandige 9:16-leesweergave, intrekbaar en 12 uur geldig | Nieuwe schermkoppeling vanuit regie |
| `/inloggen` | E-mailcode of Google; lokaal expliciete testaccountkiezer | Geen vertrouwde demo-identiteit overgenomen |
| `/auth/callback` | Supabase PKCE-callback | Alleen exact toegestane canonieke origin |
| `/link-onbekend` | Verklaarde fout voor niet-gemigreerde prototypelinks | Numerieke match-ID’s, demo-banen en oude schermtokens |

Hub-aliassen verplaatsen alleen navigatie. Er is geen mapping van prototypewedstrijd `1`, `demo-*` of de gedeelde `duindorp-baan-1` naar een nieuwe stagingwedstrijd. Zo kan een oude link nooit een andere partij aanwijzen. Onbekende UUID’s geven een foutweergave zonder fallback naar de actuele partij. Wedstrijd-QR’s gebruiken het vaste matchpad. Een baan-QR is nadrukkelijk een actuele baancontext en geeft op zichzelf geen deelname- of schrijfrecht.

API-responses, persoonlijke HTML en callbacks zijn `private, no-store`. Publieke schermresponses bevatten alleen een beperkte projectie; interne account-ID’s, schrijfrechten en ledenlijsten worden niet gedeeld. Een ingetrokken of verlopen scherm geeft 404 en kan niet schrijven.
