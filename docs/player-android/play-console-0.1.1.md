# Play Console-invulblad — DartFlow 0.1.1

**Controledatum: 18 november 2026 · Console: Nederlands · Store: nl-NL · Doel: productiepublicatie.**

**Status: Open punten vóór indienen.** Staging en productie draaien exact **20db906**; backend-, native en aanvullende SQL-controles slagen. Google meldt voor `nl.dartflow.app` de **interne track `completed` met versionCode 2** en **geen productierelease**. De daadwerkelijke Google-bundel heeft dezelfde SHA-256 als onze ondertekende release. De eerste upload, het WIF-herstel en echte GitHub OIDC-/Android Publisher-toegang zijn gecontroleerd; `PLAYER_PLAY_ENABLED=true`. De laatste verificatie heeft niets opnieuw geüpload of aan een track gewijzigd. Er is niets naar productie in Google Play uitgebracht of ter productiebeoordeling ingediend. Open dashboard-/gegevensvragen en ownercredentialweergave blijven te controleren. Dit document bevat geen credentials, pincodes, tokens of echte spelersgegevens.

Het [uitrol- en controlebewijs](../evidence/player-play-ready-2026-11-18.json) bindt de appbron, ondertekende bestanden, beide releases, SQL-migraties en werkelijk uitgevoerde toegangs-/verwijderproeven.

| Release-identiteit | Waarde |
| --- | --- |
| App | **DartFlow**, native spelersapp van **DG Webservices** |
| Pakket / variant | **`nl.dartflow.app` / `productionRelease`** |
| Versie | **0.1.1 / versionCode 2**; code **2 bestaat al op de interne Google Play-track**. Voor een andere toekomstige build een hogere code gebruiken. |
| Android | minSDK 26, targetSDK 36, compileSDK 36; telefoon en tablet |
| Productie / staging | `https://dartflow.nl` / `https://staging.dartflow.nl` |
| Support, privacy, kindveiligheid | **info@dartflow.nl** |
| Niet dit pakket | `nl.dartflow.ochelive`, `.staging` en `.dev` hebben afzonderlijke identiteiten |
| Applicatie-/AAB-bron | **`20db906c3c646caba2d9a6e09f0429b20e865564`** |
| Actief op staging | Exact **20db906c3c646caba2d9a6e09f0429b20e865564**, release **44321131573-1**; [geslaagde uitrol](https://github.com/dartflow/platform/actions/runs/44321131573) |
| Actief op productie | Exact **20db906c3c646caba2d9a6e09f0429b20e865564**, release **44323381759-1**; [geslaagde uitrol](https://github.com/dartflow/platform/actions/runs/44323381759) |
| Ondertekende release | [android-player-0.1.1-2](https://github.com/dartflow/platform/releases/tag/android-player-0.1.1-2) → **app-production-release.aab**, **26.312.672 bytes** |
| AAB SHA-256 | **`dc7e549f49ec4eeeeb8b18316a533058af83b053dc4837c342b6a8c010193c84`**; alleen dit vastgelegde bestand gebruiken |
| Aanvullende SQL-bron | **1340506**; migratie `20261118141517_scrub_deleted_identity_by_profile_id.sql`, `account_deletion=3`, toegepast op beide omgevingen. Deze SQL-bron is afzonderlijk van de bevroren applicatie-/AAB-SHA. |
| Play App Signing SHA-256 | **`DE:54:EB:62:ED:D3:10:AA:F9:39:0F:47:6D:AF:73:E2:94:13:75:CE:EE:BE:DC:0B:89:D8:8D:E2:D4:EC:3E:F1`**; dit is niet het uploadcertificaat |

## Wat in deze versie is veranderd

- De Google Play services-/ML Kit-QR-scanner is geheel vervangen door **Camera2 en lokale ZXing-herkenning**. Geen beelden naar een scannerprovider, geen scannerdownload en geen scannertelemetrie.
- De productie-runtime-dependencyboom bevat **geen GMS, ML Kit, Firebase, datatransport, Ads, Billing of Crashlytics**. De ongebruikte `POST_NOTIFICATIONS`-permissie is verwijderd.
- Communityregels, voorwaarden en een **13+-bevestiging** worden vóór plaatsen van UGC op client én server afgedwongen.
- Meld- en blokkeeracties zijn bereikbaar in de native feed, reacties, chat, vrienden/spelerszoeker en wedstrijdopties.
- Accountverwijdering is vanuit het profiel bereikbaar en heeft een onafhankelijke openbare webpagina.
- **Toegang voor appbeoordeling** biedt gewone server-gecontroleerde wachtwoordauthenticatie voor expliciet ingerichte synthetische reviewaccounts. Het is geen algemene wachtwoordregistratie of lokale ontwikkellogin.

Bronnen: `android/player/app/build.gradle.kts`, `MainActivity.kt`, `PlayerQrScanner.kt`, `PlayerQrDecoder.kt`, `PlayerSafety.kt`, `PlayerScreens.kt`, `PlayerViewModel.kt`, `lib/player-safety.ts`, `lib/account-removal.ts` en `lib/play-review.ts`.

## A. Account en app aanmaken

| Scherm / veld of vraag | Exact invullen of aanklikken | Status | App-bewijs / officiële bron | Vervolgactie |
| --- | --- | --- | --- | --- |
| Alle apps → App maken → Appnaam | **DartFlow** | Bevestigd | Naam door eigenaar bevestigd | Een bestaande spelersvermelding niet dupliceren. |
| Standaardtaal | **Nederlands — nl-NL** | Bevestigd | Eigenaarskeuze | — |
| App of game | **App**; Game niet selecteren | Voorstel | Hulpmiddel voor fysiek darts, score-invoer en spelersprofiel | Controleren bij aanmaak. |
| Gratis of betaald | **Gratis** | Bevestigd | Eigenaarskeuze; geen aankoopflow in deze release | Toekomstige betaalde functies later afzonderlijk behandelen. |
| Pakketnaam indien gevraagd | **`nl.dartflow.app`** | Bevestigd | Gradle en gemergd manifest | Geen Oche-, staging- of ontwikkelpakket gebruiken. |
| Contactadres | **info@dartflow.nl** | Bevestigd | Eigenaarskeuze | Bewaakte mailbox gebruiken. |
| Naam uitgever | **DG Webservices** | Bevestigd | Eigenaarskeuze | Match met geverifieerde accountgegevens. |
| Persoonlijk/Organisatie, aanmaakdatum, verificatie | **Open — rechtstreeks in het bestaande Console-account controleren.** | Te verifiëren | Niet af te leiden uit de handelsnaam | Geen identiteitsdocumenten in Git of chat plaatsen. |
| Handelaarsstatus / openbare bedrijfsgegevens | **Open — niet uit ‘gratis’ of ‘DG Webservices’ afleiden.** | Te verifiëren | [Handelaarsverklaring](https://support.google.com/googleplay/android-developer/answer/17594752?hl=nl) | Eigenaar verklaart de werkelijke status; verplichte gegevens rechtstreeks bij Google. |
| Voorwaarden-URL indien gevraagd | **https://dartflow.nl/voorwaarden** | Bevestigd | Openbare HTTPS-pagina gecontroleerd in de geslaagde spelerspreflight | Deze URL in Console overnemen. |
| Pakket-/ontwikkelaarsverificatie | Controleer registratie van **nl.dartflow.app** en eventuele open verificatietaak | Te verifiëren | [Android-pakketregistratie](https://support.google.com/googleplay/android-developer/answer/16984799?hl=en) | Signingcertificaat en account moeten bij elkaar horen. |
| Verklaringen bij aanmaak | Eigenaar leest de werkelijk getoonde beleids-, export- en signingverklaringen en bevestigt ze wanneer correct | Te verifiëren | [App maken](https://support.google.com/googleplay/android-developer/answer/9859152?hl=nl) | Afsluiten met **App maken**. |

Bestaande accounts moeten de toepasselijke handelaarsverklaring uiterlijk **1 februari 2027** afhandelen; nieuwe accounts verklaren dit bij inrichting. Controleer de aangekondigde EER/VK-overgang en openbare gegevens voor **1 maart 2027** in de gelinkte Help. Er is geen nieuw GitHub-abonnement nodig voor deze app of de bestaande bouwflow.

## B. Store-instellingen en afbeeldingen

Route: **Aantal gebruikers vergroten → Aanwezigheid in de Play Store → Store-instellingen / Primaire Store-vermelding**. De exacte menugroepering kan per Console verschillen.

| Scherm / veld of vraag | Exact invullen of aanklikken | Status | App-bewijs / officiële bron | Vervolgactie |
| --- | --- | --- | --- | --- |
| Categorie | **Sport** | Voorstel | Darts, scores en wedstrijdstatistieken | Beschikbare categorie controleren. |
| Tags | Alleen passende werkelijk aangeboden tags selecteren; geen tagnaam verzinnen | Te verifiëren | [Categorieën/tags](https://support.google.com/googleplay/android-developer/answer/9859673?hl=nl) | Optioneel leeg laten als geen passende tag beschikbaar is. |
| Contact | E-mail **info@dartflow.nl**; website **https://dartflow.nl** | Bevestigd | Eigenaarskeuze en productiehost | Telefoon alleen invullen als gewenst of vereist. |
| Appnaam | **DartFlow** — 8/30 tekens | Voorstel | Productnaam | — |
| Korte beschrijving | **Dartsscores, trainingen en wedstrijden met je eigen DartFlow-profiel.** — 69/80 tekens | Voorstel | Native spelersfuncties | De uitgebreide bestaande Store-tekst kan behouden blijven als die bij de release past. |
| Privacybeleid | **https://dartflow.nl/privacy** | Bevestigd | Bijgewerkt voor de native spelersapp; publieke productie-GET slaagt in spelerspreflight | In Console overnemen. |
| Store-icoon | 512×512, 32-bits PNG, maximaal 1.024 KB | Te verifiëren | [Assetvereisten](https://support.google.com/googleplay/android-developer/answer/9866151?hl=nl) | Bestaand `public/assets/pwa/player-512.png` is technisch 512×512 RGBA/28.293 bytes, maar heeft al afgeronde hoeken; voor Store een passende vierkante bronexport gebruiken. |
| Functieafbeelding | 1024×500, JPEG of 24-bits PNG zonder alfa | Te verifiëren | Dezelfde officiële assetrichtlijn | Aangeleverde afbeelding op formaat en werkelijke appfuncties controleren. |
| Telefoonscreenshots | Minimaal twee echte native beelden; voorstel 1080×1920; geen echte accountgegevens/PIN | Te verifiëren | JPEG of 24-bits PNG; reguliere dimensies 320–3840, langste zijde maximaal tweemaal kortste | Voorstel: speelkeuze, scoreconsole, baanlobby, statistieken, veiligheids-/profielbediening. |
| Tablets | Echte passende tabletbeelden; geen opgeblazen telefoonscreenshot | Te verifiëren | Telefoon-/tabletapp; geen fysieke tabletvalidatie uitgevoerd | Bijvoorbeeld 1920×1080 en 1080×1920 voor ondersteunde oriëntaties. |
| TV / Wear / Auto / XR | **N.v.t.** voor dit spelerspakket | N.v.t. | Geen betreffende appvariant of launcher | Oche Live heeft een eigen vermelding. |
| Vertalingen | Alleen **nl-NL** zolang geen andere taal is gekozen | Bevestigd | Eigenaarskeuze | Engelse reviewer-instructies zijn geen Store-vertaling. |

Afsluiten met **Opslaan** en de Store-preview controleren. Store-afbeeldingen zijn niet hetzelfde als screenshots van ontbrekende Console-formulieren.

## C. App-content: privacy, advertenties en reviewerstoegang

| Scherm / veld of vraag | Exact invullen of aanklikken | Status | App-bewijs / officiële bron | Vervolgactie |
| --- | --- | --- | --- | --- |
| Privacybeleid | **https://dartflow.nl/privacy** | Bevestigd | Openbare native-/platformprivacy; publieke productie-GET gecontroleerd | Vindbaar op native aanmeldscherm en profiel; fysieke bediening apart testen. |
| Accountverwijderings-URL | **https://dartflow.nl/account-verwijderen** | Bevestigd | Onafhankelijke openbare webroute met formulier en e-mailalternatief; publieke GET gecontroleerd | Native/API-verwijderketen is met extra stagingaccount uitgevoerd; dat bewijst geen afzonderlijke fysieke/browserformulierproef. |
| Advertenties | **Nee** | Bevestigd | Bevestigd voor huidige code. Geen advertentieplaatsing of Ads-SDK in het pakket | Eventuele later toegevoegde betaalde sponsorplaatsingen opnieuw beoordelen. |
| App-toegang / Inloggegevens | Kies **alle of sommige functies zijn beperkt toegankelijk**; exacte formuliertekst te bevestigen | Bevestigd | Spelersfuncties vereisen account; rechten bepalen overige toegang | Niet ‘alles zonder beperking toegankelijk’ kiezen. |
| Reviewcredentials verkrijgen | Inloggen als bevoegde platformeigenaar op **https://dartflow.nl/app/platform/integraties** → **Toegang voor appbeoordeling** → **Toon beoordelaargegevens** | Te verifiëren | Primary en companion werken op beide backends 20db906; tonen van credentials in een echte ownersessie is nog niet bediend. Server vereist recente eigen verificatie, maximaal 15 minuten | Eigenaar opent en controleert dit paneel. Niet fotograferen of in Git/chat plakken. |
| Reviewlogin en backendtoegang | Herbruikbare primary- en companionaccount gebruiken | Bevestigd | Beide omgevingen: login, profiel, private baan, safety-GET en verwijderstatus-GET slagen; verkeerd wachtwoord geeft generieke 401 en verboden browser-Origin 403 | Geen native apparaat-/Google-loginproef of geteste owner-weergave uit deze API-smoke afleiden. |
| Reviewgegevens plaatsen | Alleen rechtstreeks in de beveiligde Play Console-velden voor app-toegang | Bevestigd | [Reviewtoegang](https://support.google.com/googleplay/android-developer/answer/15748846?hl=en) | Primary e-mail/wachtwoord en companion e-mail/wachtwoord apart invullen. |
| Extra reviewgegevens | De synthetische gebruikersnamen en spelerspincodes alleen in de private aanvullende toegangsvelden van Console | Te verifiëren | Privé ingericht in versleuteld `review_details`; gewone lokale deelnemerskoppeling | Eén-telefoonflow op uiteindelijke release testen. Geen waarden in dit document; PIN is geen accountwachtwoord. |
| Permanente reviewbaan | De vaste productie-baan-URL uit het beveiligde ownerpaneel overnemen | Te verifiëren | Eigen reviewclub, twee leden en vaste baan per omgeving; private backendtoegang op beide 20db906-omgevingen gecontroleerd. URL in versleuteld `review_details` | Ownerpaneel en één-telefoonbediening nog zelf controleren. Alleen de productie-URL aan Google geven; geen aflopende code gebruiken. |
| Geografische/hardwarebeperking | Reviewaccount en eventuele testbaan mogen geen fysieke aanwezigheid of eigenaarshandeling vereisen | Te verifiëren | Doel van de synthetische voorziening | De ingediende build van buiten de club testen. |
| App-content → Vereist aandacht | Werkelijk getoonde taken aflopen | Te verifiëren | Geen ingelogde export van deze app beschikbaar | Formuliertekst te bevestigen bij ontbrekende vertakkingen. |

### Credentials veilig overnemen

1. Gebruik de eigen platformeigenaarssessie. Verifieer opnieuw als **Toon beoordelaargegevens** daarom vraagt.
2. Lees de twee synthetische accountsets uitsluitend in het beveiligde paneel. De server bewaart de wachtwoorden en extra details versleuteld; de UI verbergt getoonde gegevens na één minuut of bij verlaten van het tabblad.
3. Plaats de waarden uitsluitend bij **App-content → Inloggegevens/App-toegang → Nieuwe instructies**, in de daarvoor bedoelde private velden. Geen credentials in releaseopmerkingen, Store-tekst, screenshots of de repository.
4. Geef de tweede login apart mee voor testen met twee apparaten. De companion-gebruikersnaam en PIN dienen daarnaast voor de lokale één-telefoonflow.
5. Verifieer beide logins en de eventuele vaste reviewbaan vóór indienen. ‘Ingericht’ op het ownerpaneel bewijst op zichzelf nog geen geslaagde twee-toestellenproef.

### Engelse reviewer-instructies — aanmelden en kernfuncties

Onderstaande tekst kan naar het private instructieveld. De waarden worden afzonderlijk ingevuld; geen placeholders als echte credentials indienen.

```text
Title: DartFlow player access

This is the native DartFlow player app, package nl.dartflow.app.
The separate Oche Live display app is not part of this package.

1. On the sign-in screen, select "Toegang voor appbeoordeling"
   (access for app review).
2. Enter the primary review email and password provided separately
   in the private Play Console access fields.
3. Select "Inloggen voor appbeoordeling".

The review account uses synthetic data. No one-time email code,
Google account, payment or assistance from the app owner is required
for this access method.

Open "Spelen" (Play), choose "Solo trainen" and select
"Start training". Enter a score on the native keypad and confirm it.
Open "Meer" (More) for Community, match history, statistics
and profile settings.

For a second test device, sign in through the same review-access
screen using the companion review email and password supplied
separately in the private Console fields. On the primary device,
open "Spelen", select "Beide thuis" or "Hybride" and open a lobby.
On the second device, enter its invitation code in
"Wedstrijdcode of uitnodigingslink" and select "Aansluiten".
Use "Meedoen" if shown, mark both participants ready using
"Ik sta klaar aan het bord", and start the match.
Camera and microphone are optional and can be denied; scoring
remains available without a video call.
```

### Engelse reviewer-instructies — baan en één telefoon

Dit blok alleen met een werkelijk werkende vaste baanvoorziening gebruiken. De permanente baan-URL wordt apart in Console ingevuld.

```text
Title: Board lobby and two profiles on one phone

Use the permanent review-board URL supplied separately in the private
Console instructions. This board belongs to an isolated review club
and does not require physical presence at a real venue.

1. Open that exact URL on a phone with DartFlow installed, or paste
   it through the normal board/invitation entry flow.
2. Sign in using the primary review account if requested.
3. Open or create a local match lobby.
4. Select "Speler toevoegen" (Add player).
5. Enter the companion username and six-digit player PIN supplied
   separately in the private Console fields.
6. Start the match. The signed-in account remains the primary player;
   this phone acts as the scorer for both linked player profiles.

The player PIN authorizes participation in this local match only.
It does not sign in to the companion account or grant account access.
```

### Engelse reviewer-instructies — veiligheid en verwijderen

```text
Title: Community safety and account deletion

Community content:
Open "Meer" > "Community". Before posting, confirm the two separate
checkboxes stating that you are at least 13 and accept the community
rules and terms. Select "Accepteren en verder".

Reporting and blocking:
On another synthetic player's post, reply or chat message, select
"Bericht melden" / "Reactie melden", choose a category, enter a brief
explanation and select "Melding versturen". Use "Speler melden" to
report that player, or "Speler blokkeren" and confirm to block them.
Blocked players can be unblocked in "Vrienden" (Friends).
The same player safety controls are available in match options;
from the full-screen score console, open "Darts & correctie".

Account deletion:
Open "Meer" > "Profiel & instellingen" >
"Account en gegevens verwijderen" > "Account verwijderen aanvragen".
Read the explanation. The final request requires typing the exact
word VERWIJDEREN and pressing "Verwijderverzoek bevestigen".
Cancel if you only want to inspect the flow without deleting
the shared synthetic review account.

Deletion requires a recent sign-in. If prompted, sign out and sign in
again using the supplied reusable review credentials, then return
to profile settings. Once accepted, account access is blocked and
the app clears its session. Account-associated data is erased or
anonymised by the server worker as described in the privacy policy.

The independent web deletion page is:
https://dartflow.nl/account-verwijderen

Privacy and safety contact: info@dartflow.nl
```

Afsluiten met **Opslaan** bij de app-toegang. Beoordeling pas aanvragen nadat de werkelijke toegang is getest; de instructies maken een niet-geprovisioneerde voorziening niet werkend.

## D. Doelgroep en contentclassificatie

| Scherm / veld of vraag | Exact invullen of aanklikken | Status | App-bewijs / officiële bron | Vervolgactie |
| --- | --- | --- | --- | --- |
| Getargete leeftijden | **13–15**, **16–17** en **18 jaar en ouder** aanvinken | Bevestigd | Eigenaarskeuze: vanaf 13; voorwaarden en communitybevestiging | Onder-13-groepen uit laten. |
| Alleen volwassenen / beperken tot 18+ | **Nee**, voor zover deze vraag wordt getoond | Bevestigd | Ook 13–17 is doelgroep | Geen volwassenendoelgroep declareren om UGC-verplichtingen te vermijden. |
| Kinddoelgroep onder 13 | **Nee** | Bevestigd | Productkeuze en regels | Landen met afwijkende leeftijdsregels afzonderlijk toetsen. |
| Families/Teacher Approved | Geen deelname claimen | N.v.t. | N.v.t. voor voorgestelde scope. [Doelgroep](https://support.google.com/googleplay/android-developer/answer/9867159?hl=nl) | De selectie vanaf 13 vervangt geen lokale minderjarigenbescherming. |
| IARC-contact | **info@dartflow.nl** | Bevestigd | Contactadres | — |
| IARC-categorie en exacte vervolgvraagteksten | **Formuliertekst te bevestigen** in deze app-Console | Te verifiëren | Nog geen private vragenlijst/export gezien | Geen rating of niet-getoonde vraag verzinnen. |
| Gebruikersinteractie / chat / UGC | **Ja** | Bevestigd | Community, reacties, kamers, wedstrijdchat en optionele video | Alle getoonde vervolgvragen eerlijk invullen. |
| Eigen ingebouwde geweld-, horror-, seks-, middelen- of gokcontent | **Nee** voor de huidige eigen appinhoud | Bevestigd | Geen betreffende vaste inhoud/functies | Dit antwoord niet als ‘geen UGC’ gebruiken. |
| Mogelijkheid persoonlijke informatie te delen | **Ja**, als gevraagd naar profielen/chat | Bevestigd | Namen, gebruikersnamen en vrije tekst | Moderatie en privacykeuzes zijn afzonderlijke voorzieningen. |
| Locatiedeling in IARC | **Open — exacte vraag en fysieke baancheck-in beoordelen** | Te verifiëren | Geen GPS; een check-in kan aanwezigheid bij een identificeerbare baan tonen | Niet automatisch Nee invullen. |
| Vrije ingebouwde browser | **Nee** | Bevestigd | Geen WebView/vrije browser | Externe privacy-/authlinks zijn wel aanwezig. |
| Regionale rating | Overnemen uit de afgeronde IARC-samenvatting | Te verifiëren | [Contentclassificatie](https://support.google.com/googleplay/android-developer/answer/9859655?hl=nl) | Geen PEGI-rating voorspellen. |

Afsluiten met de doelgroep-samenvatting → **Opslaan**; IARC → **Overzicht → Indienen**. ‘Geen leeftijdsgevoelige dingen’ betekent niet dat chat en gebruikersinteractie op Nee kunnen staan.

## E. Veiligheid van gegevens

### E1. Hoofdvragen en accountmethoden

De oude scannerverklaring vervalt voor deze nieuwe build. Zolang een oudere versie van **hetzelfde pakket** nog wordt gedistribueerd, moet de verklaring ook die versie dekken. De losse Oche- en stagingpakketten niet zonder reden samenvoegen. [Officiële Gegevensveiligheid-uitleg](https://support.google.com/googleplay/android-developer/answer/10787469?hl=nl)

| Scherm / veld of vraag | Exact invullen of aanklikken | Status | App-bewijs / officiële bron | Vervolgactie |
| --- | --- | --- | --- | --- |
| Verzamelt of deelt je app vereiste typen gebruikersgegevens? | **Ja** | Bevestigd | Accounts, scores, relaties, berichten en moderatiegegevens | Niet ‘geen verzameling’ kiezen omdat analytics ontbreekt. |
| Alles versleuteld tijdens overdracht? | **Open — pas Ja na controle van de uiteindelijke API-, Auth-, signaal- en relayconfiguratie** | Te verifiëren | Relay geverifieerd; totale releasestroom nog te verifiëren. TLS 1.3, vertrouwde host/keten en geauthenticeerde relay-roundtrip slagen voor staging én productie; nieuwe bron weigert onveilige hosted TURN-URL’s | Live runtime moet de bedoelde `turns:`-URL verstrekken. De infrastructuurproef is geen bewijs van een volledige native mediaproef. |
| Methode: Gebruikersnaam en andere verificatie | **Aanvinken** | Bevestigd | E-mail + OTP kan een account aanmaken | E-mailadres geldt hier als accountidentificatie. |
| Methode: OAuth | **Aanvinken** | Bevestigd | Google kan een account vormen | — |
| Methode: Gebruikersnaam en wachtwoord | De app heeft nu **Ja, beperkte wachtwoordaanmelding** voor vooraf ingerichte reviewaccounts. Als de vraag uitsluitend **accountaanmaak door de gebruiker** betreft: geen algemene wachtwoordregistratie claimen; exacte Console-vraag bevestigen. | Te verifiëren | Te verifiëren voor formulierafslag. `/auth/review` gebruikt gewone Supabase-passwordauth voor exact ingerichte IDs; gewone spelers registreren via OTP/Google | Bij een vraag naar ondersteunde **aanmeldmethoden** deze optie wel aanvinken. Leg de reviewbeperking bij de private instructies uit. |
| Gebruikersnaam, wachtwoord en andere verificatie | **Niet aanvinken** voor deze release | Bevestigd | Geen gecombineerde wachtwoord+OTP/MFA-spelersflow | Owner-MFA voor beheer is geen publieke spelersregistratiemethode. |
| Overig | **Niet aanvinken**, tenzij de werkelijke vraag een extra passende afslag toont | Bevestigd | Bevestigd voor bekende flows. Spelers-PIN is een partijgebonden deelnemerskoppeling | Beschrijving: N.v.t. zolang Overig uit staat. |
| Geen accountaanmaak | **Niet aanvinken** | Bevestigd | Eerste OTP/Google-login kan een account maken | — |
| Account-URL verwijderen | **https://dartflow.nl/account-verwijderen** | Bevestigd | Openbare webroute plus native actie; extra synthetisch stagingaccount: onmiddellijke blokkade, applicatiewissing, Auth-hard-delete en afwijzing oud token geslaagd | Productie-smoke leest alleen verwijderstatus; daar is geen echt account verwijderd. |
| Gedeeltelijke verwijdering met behoud account | Optioneel **leeg laten** zolang geen aparte bewezen dienst daarvoor wordt verklaard | Voorstel | Accountverwijdering is wel beschikbaar | Geen ‘automatisch alles binnen 90 dagen’ kiezen. |
| Onafhankelijke beveiligingsbeoordeling / UPI | Geen badge claimen; UPI **N.v.t.** | Bevestigd | Geen beoordeling of UPI-functie aangetoond | — |

### E2. Types — actuele release-inventaris

‘Open’ is een echte controleactie, geen verborgen Nee. De tabel bevat alle gevraagde typen. De precieze Nederlandse labels kunnen in Console licht verschillen.

| Categorie / type | Aanvinken | Verzameld | Gedeeld | Kortstondig verwerkt | Vereist of optioneel | Doelen verzameld | Doelen gedeeld | App-bewijs / status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Locatie / Geschatte locatie | Open | Open | Open | Open | Open | Alleen bij aangetoonde locatieafleiding | Open | Geen GPS/GeoIP-functie aangetroffen; infrastructuurafleiding nog controleren. |
| Locatie / Exacte locatie | Open | Open | Open | Bij opgeslagen check-in: Nee | Indien van toepassing: optioneel | App-functionaliteit | Open | Check-in verbindt een account aan een fysieke baan en tijd; beoordeel identificeerbare venue, niet alleen GPS-permissie. |
| Persoonlijke informatie / Naam | Ja | Ja | Open — zie E3 | Nee | Vereist | App-functionaliteit; Accountbeheer | Open | Gebruikersnaam en scorebordnaam; persistent profiel. |
| Persoonlijke informatie / E-mailadres | Ja | Ja | Open — zie E3 | Nee | Vereist | Accountbeheer; App-functionaliteit; Berichten van de ontwikkelaar voor servicemails | Open | OTP/Google, account en mailverwerking. |
| Persoonlijke informatie / Gebruikers-ID’s | Ja | Ja | Open — zie E3 | Nee | Vereist | App-functionaliteit; Accountbeheer; Fraudepreventie, beveiliging en naleving | Open | Stabiel profiel-ID; wedstrijden, rechten, relaties en signalering. |
| Persoonlijke informatie / Adres | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen persoonlijk adresveld. Fysieke baangegevens niet als woonadres declareren. |
| Persoonlijke informatie / Telefoonnummer | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen telefoonregistratie of invoer. |
| Persoonlijke informatie / Ras en etniciteit | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen specifieke verwerking; vrije tekst onder berichten/UGC. |
| Persoonlijke informatie / Politieke of religieuze overtuigingen | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen specifieke verwerking. |
| Persoonlijke informatie / Seksuele geaardheid | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen specifieke verwerking. |
| Persoonlijke informatie / Andere informatie | Ja — voorgestelde categorie | Ja | Open — zie E3 | Nee | Vereist voor nieuwe profiel-PIN; 13+-communitybevestiging optioneel per functie | App-functionaliteit; Accountbeheer; Fraudepreventie, beveiliging en naleving | Open | PIN-verifier/versie en 13+-acceptatie; geen geboortedatum. De PIN-indeling is een onderbouwd voorstel, geen expliciete Google-PIN-rubriek. |
| Financieel / Betalingsinformatie van gebruiker | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen betalingen in huidige app. |
| Financieel / Transactieoverzicht | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen aankoop-/abonnementshistorie. |
| Financieel / Kredietscore | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen functie. |
| Financieel / Andere financiële informatie | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen functie. |
| Gezondheid / Medische informatie | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen medische gegevens. |
| Gezondheid / Fitnessinformatie | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Dartsscores zijn speldata, geen conditiemeting. |
| Berichten / E-mails | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen inbox lezen; eigen OTP-/servicemail niet verwarren met verzamelde gebruikersmail. |
| Berichten / Sms of mms | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen sms-toegang. |
| Berichten / Andere in-app berichten | Ja | Ja | Open — zie E3 | Nee | Optioneel | App-functionaliteit; Fraudepreventie, beveiliging en naleving voor moderatie | Open | Kamers, community-/wedstrijdchat en meldafhandeling. |
| Foto’s en video’s / Foto’s | Open | Open | Open | Open | Open | Indien van toepassing: Accountbeheer/App-functionaliteit | Open | Geen scan- of galerijupload. Google Auth kan avatarreferenties bevatten; werkelijke metadata-/beeldverwerking controleren. |
| Foto’s en video’s / Video’s | Open | Open | Open | Open | Optioneel | App-functionaliteit, als declaratie vereist blijkt | Open | Optionele WebRTC-video; E2EE-uitzondering en relaygedrag nog onderbouwen. |
| Audiobestanden / Spraak- of geluidsopnamen | Open | Open | Open | Open | Optioneel | App-functionaliteit, als declaratie vereist blijkt | Open | Optionele realtime microfoonaudio; geen app-opnamefunctie. |
| Audiobestanden / Muziekbestanden | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen muziekverzameling. |
| Audiobestanden / Andere audiobestanden | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen audiofile-upload. |
| Bestanden en documenten | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen gebruikersbestanden importeren/uploaden. |
| Agenda / Agenda-afspraken | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen persoonlijke agenda lezen; evenementdeelname onder Andere acties. |
| Contacten | Ja | Ja | Open — zie E3 | Nee | Optioneel | App-functionaliteit; Fraudepreventie, beveiliging en naleving voor blokkades | Open | Vrienden en sociale relaties, ook zonder READ_CONTACTS. |
| App-activiteit / App-interacties | Nee voor generieke native gebruiksmeting | Nee voor die stroom | Nee voor die stroom | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen pagina-/kliktelemetrie of scannermetrics; gameplay/likes hieronder. Serverlogs afzonderlijk controleren. |
| App-activiteit / In-app zoekgeschiedenis | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Zichtbare filters zijn lokaal; geen opgeslagen native zoekhistorie aangetoond. |
| App-activiteit / Geïnstalleerde apps | Nee | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen inventarisatie. |
| App-activiteit / Andere content van websitegebruikers | Ja | Ja | Open — zie E3 | Nee | Optioneel | App-functionaliteit; Fraudepreventie, beveiliging en naleving voor meldingen | Open | Communityposts, reacties en ingestuurde meldtoelichting. |
| App-activiteit / Andere acties | Ja | Ja | Open — zie E3 | Nee | Speldata vereist bij spelen; overige acties optioneel | App-functionaliteit | Open | Scores, trainingen, uitslagen, inschrijving, check-in en likes. |
| Browsen op internet / Browsegeschiedenis | Nee voor deze native stroom | Nee | Nee | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen ingebouwde browsergeschiedenis; externe browser is geen native webtrackingpixel. |
| App-gegevens / Crashlogboeken | Nee voor native crashupload | Nee voor die stroom | Nee voor die stroom | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen crash-SDK/eigen clientuploader. Android Vitals en operationele serverlogs afzonderlijk beoordelen. |
| App-gegevens / Diagnostische gegevens | Nee voor oude SDK-stroom; serverdiagnostiek controleren | Open voor eventuele andere stroom | Open | Open | Open | Alleen na vastgestelde verwerking | Open | ML Kit/datatransport weg; afwezigheid daarvan bewijst niet alle hostinglogpraktijken. |
| App-gegevens / Andere app-prestatiegegevens | Nee voor native prestatiemeting | Nee voor die stroom | Nee voor die stroom | N.v.t. | N.v.t. | N.v.t. | N.v.t. | Geen native prestatietelemetrie gevonden. |
| Apparaat- of andere ID’s | Geen native scanner-/tracking-/push-ID; overige ID-gebruik controleren | Open voor eventuele overige stroom | Open | Open | Open | Indien van toepassing: App-functionaliteit / beveiliging | Open | Geen AD_ID, FCM of scannerinstallatie-ID. Beheerde Oche-scherm-ID’s en netwerk-/rate-limit-ID’s apart beoordelen; niet uit ‘geen SDK’ automatisch totaal-Nee afleiden. |

### E3. Uitleg voor de nog open verwerkingsvragen

| Stroom | Aantoonbare verwerking | Beslissing voor formulier |
| --- | --- | --- |
| Naam/e-mail/account-ID/PIN | Naar eigen API/Auth/opslag; profiel en verifier blijven bewaard | Verzameld Ja, niet uitsluitend kortstondig. PIN blijft buiten publieke profielen, responses, QR en normale logs. |
| Contacten/chat/UGC/speldata | Eigen backend, bevoegde deelnemers/organisatoren en eventueel openbare displays | Optionele sociale functies onderscheiden van voor een partij noodzakelijke speldata. Sportgemiddelden zijn App-functionaliteit; niet automatisch het doel Analyse. |
| Supabase | Auth en database voor DartFlow | Alleen voor toepasselijke verwerking in opdracht de dienstverleneruitzondering gebruiken; [DPA](https://supabase.com/legal/customer-resources/data-processing-addendum). |
| Resend | Servicemails in opdracht | Beoordeel de specifieke stroom; [DPA](https://resend.com/legal/dpa) maakt onderscheid met eigen account-/gebruiksgegevens van de leverancier. |
| Andere spelers/schermpubliek | De door functie/rechten toegestane namen, inhoud en scores | Een bedoelde gebruikersactie kan een deeluitzondering dragen. Controleer standaard profielvindbaarheid en openbare displayprojectie voordat alles op Gedeeld Nee gaat. |
| Fysieke check-in | Account + baan + moment | Als de baan een concrete venue identificeert, Exacte locatie overwegen/verklaren, optioneel, App-functionaliteit, niet kortstondig bij opslag. Geen GPS-permissie is geen volledige ontkenning van locatieverwerking. |
| Google-avatar | Eigen profielcode neemt naam/e-mail/ID over; Auth-provider kan aanvullende metadata bewaren | Geen Foto’s Nee aannemen alleen omdat de native UI initialen toont. Verifieer met synthetische Google-login welke afbeelding-/metadata werkelijk wordt opgeslagen/gebruikt. |
| WebRTC-media | Realtime peerverbinding, eventueel relay; signalering wordt opgeslagen. TLS-relay is op beide omgevingen extern geverifieerd | TLS bewijst niet automatisch de end-to-end-uitzondering voor alle gegevens. Beeld/geluid, bewaarde account-/match-/ICE-metadata en de uiteindelijke runtime afzonderlijk beoordelen. |
| Serverbeveiliging | Rate limiting, aanvraag-/beheerregistraties en fouten | Geen algemene analytics- of diagnostiekclaim verzinnen. Leg werkelijke velden, doel, ontvangers en bewaartermijnen vast. |

Verklaar **Gedeeld Nee** alleen waar de feitelijke ontvanger en uitzondering zijn onderbouwd. Bij verschillende stromen binnen één type moet het formulier het geheel dekken. ‘Kortstondig’ niet gebruiken voor gegevens die in tabellen, queues, logs of back-ups blijven staan. Bewaartermijnen zijn doelafhankelijk; de publieke pagina belooft geen algemene automatische wisdatum en geen gegarandeerde volledige verwijdering binnen één maand.

### Verwijdering: werkelijke gebruikersstappen

1. Native: **Meer → Profiel & instellingen → Account en gegevens verwijderen → Account verwijderen aanvragen**.
2. Lees uitleg; typ exact **VERWIJDEREN**; kies **Verwijderverzoek bevestigen**.
3. De server verlangt recente eigen verificatie. Zo nodig opnieuw aanmelden en terugkeren naar het profiel.
4. Na acceptatie blokkeert accounttoegang onmiddellijk. De app wist lokale tokens, profiel, opdrachtwachtrij en terugkeerroute; de mediaverbinding sluit.
5. Een duurzame worker verwijdert Auth en persoonlijke applicatiegegevens of anonimiseert bewaarde wedstrijdverwijzingen. Een minimaal naamloos technisch record en noodzakelijke officiële uitslagen kunnen blijven; webpagina/privacy leggen uitzonderingen uit.
6. Zonder geïnstalleerde app: **https://dartflow.nl/account-verwijderen**. Zonder werkende login: mail **info@dartflow.nl**; eigendom wordt passend gecontroleerd, zonder wachtwoord of PIN per e-mail.

De volledige verwijderketen is vervolgens op staging met een **extra synthetisch account** uitgevoerd: onmiddellijke toegangsblokkade, wissen van applicatiegegevens, echte Auth-hard-delete en afwijzing van het oude token slagen. De gedeelde primary-/companionreviewaccounts zijn hiervoor niet verwijderd. Beide beperkte DynamicUser-privacyworkers draaien met ingeschakelde timers en resultaat `success`. De aanvullende SQL-migratie is op beide omgevingen toegepast en gecontroleerd op naamconflicten en ACL; 12 lokale regressieproeven en de volledige [CI van SQL-bron 1340506](https://github.com/dartflow/platform/actions/runs/44323420136) slagen. Dit is geen fysieke native verwijderproef en geen algemene belofte over verwijdertermijnen. [Google-accountverwijdering](https://support.google.com/googleplay/android-developer/answer/13327111?hl=nl)

Afsluiten: per gekozen gegevenstype de vervolgvragen → **Samenvatting / Store-preview** → controleren → **Opslaan**. Een onbekend antwoord als concept laten staan, niet naar Nee omzetten om door te kunnen.

## F. Aanvullende verklaringen en veiligheid

| Scherm / veld of vraag | Exact invullen of aanklikken | Status | App-bewijs / officiële bron | Vervolgactie |
| --- | --- | --- | --- | --- |
| Advertentie-ID | **Nee** | Bevestigd | Werkelijk gemergd manifest heeft geen AD_ID | Doelvervolgvragen: N.v.t. |
| Gezondheidsapps | **Geen gezondheidsfuncties** | Bevestigd | Geen medische/fitnessfunctie of Health Connect | Algemene verklaring invullen indien getoond. |
| Financiële functies | **Geen financiële functies** | Bevestigd | Geen betalings-, bank-, krediet-, handels- of cryptofunctie | Toekomstige betaalopties opnieuw toetsen. |
| Overheidsapp / overheidsinformatie | **Nee** | Bevestigd | Geen relatie/functie | — |
| Nieuws-/tijdschriftenapp | **Nee** voor het spelerspakket | Bevestigd | Sport/community, geen nieuwsapp | Een websiteblog niet automatisch als native nieuwscategorie behandelen. |
| Generatieve AI | **Nee** | Bevestigd | Dartbot/QR-herkenning zijn geen generatieve beeld-/tekstfunctie | SocialHero uit andere repository niet meetellen. |
| Gokken, lootboxes, betaalde loterij | **Nee** voor de huidige appfuncties | Bevestigd | Geen inzet/aankoop-/uitbetalingsflow | Reële betaalde prijzentoernooien apart controleren als die worden toegevoegd. |
| UGC / gebruikersinteractie | **Ja** | Bevestigd | Meld-, blokkeer-, regels- en moderatieflow | [UGC-beleid](https://support.google.com/googleplay/android-developer/answer/9876937?hl=nl) |
| Openbare community-/CSAE-standaarden indien gevraagd | **https://dartflow.nl/communityregels** | Bevestigd | Bevestigd in bron. Verbod op seksuele uitbuiting/misbruik minderjarigen; meldinstructies | Geen volledig afgeronde specifieke kindveiligheidsverklaring claimen zonder operationele afhandeling. |
| Kindveiligheidscontact indien gevraagd | **info@dartflow.nl** | Bevestigd | Publieke regels en mailboxkeuze | Eigenaar moet mailbox en noodzakelijke afhandeling daadwerkelijk organiseren. |
| Speciale sociale/dating-kindveiligheidstaak | Toepasselijkheid in Console controleren; app is Sport met sociale functies, geen dating of anonieme/random-chatkernfunctie | Te verifiëren | [Child Safety Standards](https://support.google.com/googleplay/android-developer/answer/14747720?hl=nl) | Getoonde taak niet overslaan; geen keurmerk afleiden uit alleen een tekstpagina. |
| Camera/microfoon | Gewone runtimepermissies voor optionele QR/video/audio | Bevestigd | CAMERA/RECORD_AUDIO; camera hardware niet verplicht | Geen galerie-, GPS- of achtergrondopname claimen. |
| Meldingen | Geen POST_NOTIFICATIONS/FCM/push in deze release | Bevestigd | Gemergd manifest en dependencyrapport | Geen pushverklaring nodig op basis van de oude ongebruikte permissie. |
| SMS/call log, locatiepermissies, contacten lezen, brede media, alle bestanden, Accessibility, VPN, pakketinstallatie, exacte alarmen, FGS/full-screen intents | **N.v.t. — betreffende rechten/components ontbreken** | Bevestigd | Werkelijk productie-manifest | Een schermvullende scoreconsole is geen Android full-screen intent. |

### Melden en blokkeren in het Nederlands

- **Meer → Community → bericht/reactie → Bericht melden / Reactie melden**. Kies categorie, licht toe, **Melding versturen**. Geen gevoelige credentials toevoegen.
- Bij dezelfde auteur: **Speler melden** voor het account, of **Speler blokkeren → Blokkeren**. Dit zijn afzonderlijke acties.
- In chat staan dezelfde acties bij een bericht. In de scoreconsole: **Darts & correctie** → veiligheidsacties voor de tegenstander. In de gewone wedstrijdkaart staan ze bij **Wedstrijdopties**.
- **Vrienden → Geblokkeerd → Blokkade opheffen → Deblokkeren** om ongedaan te maken.
- Bevoegde moderatoren beoordelen meldingen binnen hun scope; blokkeren wijzigt geen officiële uitslag of bracket. Niet beloven dat een melding onmiddellijk of binnen een vaste termijn is afgehandeld.
- Bij onbereikbare knop of bezwaar: **info@dartflow.nl**. Bij direct gevaar lokale hulpdiensten; in Nederland **112**. Geen materiaal met seksueel misbruik van kinderen als e-mailbijlage opvragen of doorsturen.

Afsluiten: iedere werkelijk getoonde aanvullende verklaring afzonderlijk **Opslaan/Indienen**.

## G. Build, tests en productietoegang

| Scherm / veld of vraag | Exact invullen of aanklikken | Status | App-bewijs / officiële bron | Vervolgactie |
| --- | --- | --- | --- | --- |
| Gewenste track | **Productie** | Bevestigd | Eigenaarskeuze | Een verplichte accounttestgate blijft van toepassing als Google die toont. |
| Landen/regio’s | **Open — expliciet kiezen** | Te verifiëren | Nederlands is een taal, geen landenkeuze | Niet automatisch wereldwijd selecteren. |
| Persoonlijk account na 13 november 2023 | Indien van toepassing: eerst 12 testers, 14 dagen onafgebroken aangemeld voor gesloten test, daarna productieaanvraag | Te verifiëren | [Testvereisten](https://support.google.com/googleplay/android-developer/answer/14151465?hl=nl) | Eerdere informele tests of Oche-tests vervangen dit niet. |
| Organisatie/ander account | Geen persoonlijke 12/14-gate aannemen zonder Console-taak | Te verifiëren | Werkelijk accounttype onbekend | Productietoegang in dashboard controleren. |
| AAB | **app-production-release.aab**, productionRelease **0.1.1 (2)**, bron **20db906**, **26.312.672 bytes**, SHA-256 bovenaan | Bevestigd | Bevroren [release android-player-0.1.1-2](https://github.com/dartflow/platform/releases/tag/android-player-0.1.1-2), ondertekend met eigen spelersuploadsleutel; werkelijke Google-bundelhash komt overeen | Voor deze versie het bestaande bestand gebruiken; voor een andere build een hogere versionCode. |
| App Links | **`nl.dartflow.app`** met het vastgelegde **DE:54…**-Play-certificaat | Bevestigd | Publieke spelerspreflight slaagt voor exacte 20db-backends, health/ready, Auth-contract, juridische pagina’s en productie-App-Links | Installatie uit Play en linkretour op een echt toestel blijven apart te testen. |
| Web-CI en browserproeven — 20db906 | **469 backendcontroles, 46 prototypeproeven, 72 browserproeven en 5 gerichte browserproeven geslaagd**; build geslaagd | Bevestigd | [CI 44318757805](https://github.com/dartflow/platform/actions/runs/44318757805), exacte bron-SHA 20db906c3c646caba2d9a6e09f0429b20e865564 | Gerichte proeven zijn apart herhaalde dekking; niet als 77 verschillende browserscenario’s presenteren. |
| Native release — 20db906 | **Volledige native CI geslaagd**, build en native UI | Bevestigd | [Native CI 44318798401](https://github.com/dartflow/platform/actions/runs/44318798401), exacte applicatie-/AAB-bron | Geen fysieke apparaatproef uit emulatorresultaten afleiden. |
| Staging-uitrol — 20db906 | **Geslaagd**, release **44321131573-1** | Bevestigd | [Deploy 44321131573](https://github.com/dartflow/platform/actions/runs/44321131573); publieke health/ready bevestigen de exacte bron | Definitieve release-ID bij vervolgcontrole behouden. |
| Productie-uitrol — 20db906 | **Geslaagd**, release **44323381759-1** | Bevestigd | [Deploy 44323381759](https://github.com/dartflow/platform/actions/runs/44323381759); publieke health/ready bevestigen de exacte bron | Google Play-publicatie is een afzonderlijke, nog niet uitgevoerde stap. |
| Toegangsproeven — staging én productie 20db906 | Primary-/companionlogin, beide profielen, private baan, safety-GET en verwijderstatus-GET slagen; verkeerd wachtwoord geeft generieke **401**, verboden browser-Origin **403** | Bevestigd | Werkelijke native-API-smokes op beide backends | Ownercredentialweergave en fysieke native bediening apart controleren. |
| Native callback | Terugkeerroute accepteert de bedoelde callback op beide omgevingen | Bevestigd | Probe met **ongeldig synthetisch token** slaagt; geen echte Google-login of sessie gemaakt | Echte Google-/OTP-aanmelding en terugkeer op een toestel blijven te testen. |
| JVM-tests — 20db906 | **34 per flavor, totaal 102 uitvoeringen geslaagd** | Bevestigd | [Native CI 44318798401](https://github.com/dartflow/platform/actions/runs/44318798401); 0 overgeslagen proeven | — |
| Lint | 3 debugflavors geslaagd; per flavor **0 fouten, 28 niet-blokkerende waarschuwingen** | Bevestigd | Native CI; dependency-, icoon- en stijlwaarschuwingen | Niet rapporteren als ‘nul waarschuwingen’. |
| APK / AndroidTest APK / AAB | Gebouwd; definitieve productie-AAB ondertekend en in release vastgelegd | Bevestigd | Exacte bron 20db906; hash en bytes bovenaan | Historische unsigned AAB niet gebruiken. |
| Native UI / Compose — 20db906 | **14 uitgevoerd, 0 mislukt, 0 overgeslagen** | Bevestigd | Geslaagde native telefoonjob in [CI 44318798401](https://github.com/dartflow/platform/actions/runs/44318798401) | Op deze VPS was geen emulator beschikbaar; deze uitvoeringen komen uit CI. Echte apparaten apart testen. |
| TURN TLS | Staging **3478**, productie **3479**: TLS 1.3, geauthenticeerde allocation/roundtrip, private-peerblokkade en afwijzing plaintext TCP geslaagd | Bevestigd | Bevestigd voor infrastructuur. `docs/evidence/player-play-turn-tls-{staging,production}-2026-11-18.json` | Applicatie-URL en fysieke video apart bevestigen; oude UDP-listener bestaat voor compatibiliteit. |
| Privacyworker en echte verwijdering | Beide timers actief; DynamicUser-workers resultaat **success**. Extra synthetisch stagingaccount volledig verwijderd, oud token geweigerd | Bevestigd | Werkelijke stagingverwerking met Auth-hard-delete; eerdere `docs/evidence/player-play-privacy-worker-role-{staging,production}-2026-11-18.json` beschrijft alleen de voorafgaande read-only rolproef | Geen productieaccount verwijderd en geen fysieke native verwijderbediening geclaimd. |
| SQL-privacyfix | Migratie **20261118141517**, feature **account_deletion=3**, op beide omgevingen toegepast; naamconflict-/ACL-probes en **12 lokale proeven geslaagd** | Bevestigd | Aanvullende bron **1340506**; behoud van andere gelijknamige spelers en gerichte eigen contactcleanup gecontroleerd | Deze migratie wijzigt niet de bevroren AAB-/applicatie-SHA 20db906. |
| Volledige CI aanvullende SQL-bron — 1340506 | **Geslaagd:** 471 npm-, 46 prototype-, 5 gerichte browser-, 72 volledige browser- en 166 Python-controles; typecheck, lint, build en packaging geslaagd | Bevestigd | [CI 44323420136](https://github.com/dartflow/platform/actions/runs/44323420136), exacte SQL-bron 1340506 | Aanvullend op de afzonderlijke app-/AAB-bron 20db906; bron-SHA’s niet verwisselen. |
| Google Cloud / Play API / WIF | Project **dartflow / 955883910359**, API, bootstrap, gerepareerde provider en appgebonden SA-rechten ingericht; **`PLAYER_PLAY_ENABLED=true`** | Bevestigd | Eigenaar bevestigt inrichting; [check-access 44326068767](https://github.com/dartflow/platform/actions/runs/44326068767) slaagt met echte OIDC-uitwisseling en Android Publisher-tracks lezen | Dit bewijst toegang tot de leesoperatie, geen uitgevoerde productiepublicatie. |
| Eerste AAB / waargenomen Play-tracks | Eerste bestand opgeslagen; Google rapporteert **`internal: completed, versionCodes=["2"]`**, **`production: []`** | Bevestigd | Werkelijke Android Publisher-respons in [check-access 44326068767](https://github.com/dartflow/platform/actions/runs/44326068767); eigenaar bevestigt `nl.dartflow.app`, 0.1.1, code 2 | Een voltooide interne track is geen productierelease of Google-productiegoedkeuring. |
| Google-bundelhash en idempotentie | **Geslaagd:** bestaande interne `completed`-release/code 2 gevonden; Google SHA-256 is exact **dc7e549f49ec4eeeeb8b18316a533058af83b053dc4837c342b6a8c010193c84** | Bevestigd | [Workflow 44326658372](https://github.com/dartflow/platform/actions/runs/44326658372): bundel via Android Publisher gelezen en hash vergeleken; gevraagde toestand bestond al | Geen bundle-upload, trackwijziging of commit uitgevoerd; eigen tijdelijke edit opgeruimd. Productietrack blijft leeg. |
| Echte apparaten | QR, App Links, OTP/Google, camera-/microfoonweigering en twee-toestellenvideo nog fysiek controleren | Te verifiëren | Eigenaar test toestellen later | Geen fictieve toesteltestresultaten opnemen. |

Het oude unsigned bouwbewijs is vervangen en is **geen uploadbestand**. Gebruik uitsluitend de ondertekende AAB met SHA-256 **dc7e549f49ec4eeeeb8b18316a533058af83b053dc4837c342b6a8c010193c84** uit de bevroren release. Zie [native wijzigings- en testbeschrijving](play-readiness-native.md). De [TLS-bewijzen](../evidence/player-play-turn-tls-production-2026-11-18.json) bewijzen relaytransport, geen fysieke app-/videotest.

Het bevroren receipt beschrijft de bouwtijd: `playUpload:false` betekent dat de bouwgenerator geen Play-upload deed. De latere eigenaarupload en Google-API-verificatie hierboven zijn afzonderlijke gebeurtenissen; het receipt is daarvoor niet gewijzigd.

## H. Release aanmaken en indienen

| Scherm / veld of vraag | Exact invullen of aanklikken | Status | App-bewijs / officiële bron | Vervolgactie |
| --- | --- | --- | --- | --- |
| Testen en releasen → Productie | **Nieuwe release maken**, als de track beschikbaar is | Voorstel | [Releaseprocedure](https://support.google.com/googleplay/android-developer/answer/9859348?hl=nl) | Openstaande dashboardtaken eerst afronden. |
| Play App Signing | Gebruik het vastgelegde spelerscertificaat **DE:54…** | Bevestigd | Volledige SHA-256 bovenaan en in `github-play.md` | Uploadkey is niet hetzelfde als app-signingkey; beide afzonderlijk controleren. |
| Bestaande bundle | Gebruik de bestaande **0.1.1 (2)** voor `nl.dartflow.app`; geen tweede bestand met dezelfde versionCode maken | Bevestigd | API bevestigt interne `completed`-release/code 2 én de exacte Google-bundelhash | Bij productie-release de bestaande geverifieerde bundel selecteren, nadat verplichte taken zijn afgerond. |
| Releasenaam | Voorstel **0.1.1 (2) — spelersapp** | Voorstel | Interne Console-naam | Bij afwijkende definitieve code aanpassen. |
| Releaseopmerkingen | Tekst hieronder, `nl-NL`, **269/500 Unicode-tekens** exclusief locale-tags | Voorstel | Beschrijft gewijzigde functies zonder ongeteste goedkeuringsclaim | — |
| Voorbeeld en bevestigen | Waarschuwingen, landen, rechten, SDK-waarschuwingen en package controleren | Te verifiëren | Werkelijke uploadanalyse | Fouten oplossen, waarschuwingen inhoudelijk beoordelen. |
| Publicatieoverzicht | Privacy, toegang, leeftijd/IARC, gegevensveiligheid en overige taken nalopen | Te verifiëren | Productietrack is leeg; actuele overgebleven Dashboard-taken zijn bij de eigenaar opgevraagd. [Publicatiebeheer](https://support.google.com/googleplay/android-developer/answer/9859654?hl=nl) | Geef uitsluitend de daadwerkelijk getoonde open taken door; geen productie-indiening of beschikbaarheid aannemen. |
| Beoordeling | Eigenaar kiest **Versturen voor beoordeling** na de controles | Te verifiëren | Geen Play-accountactie door dit document | Geen Google-goedkeuring of datum beloven. |
| Eerste productierelease | Niet uitgaan van een percentage-uitrol | Bevestigd | Bevestigd als algemene eerste-releaseflow. Eerste release wordt beschikbaar voor geschikte gebruikers in gekozen landen | Beheerd publiceren en precieze knoppen in de werkelijke Console controleren. |

```text
<nl-NL>
DartFlow voor spelers: scoren, trainen en samen spelen.
Nieuwe veiligheidsbediening om berichten en spelers te melden en te blokkeren.
Communityregels vóór het plaatsen van berichten.
Accountverwijdering vanuit je profiel.
QR-codes worden lokaal op je telefoon herkend.
</nl-NL>
```

### Laatste controlelijst

- Definitieve ondertekende AAB/SHA en juiste package bevestigd; geen ontwikkelfixtures in release.
- Productie-API, eigen App Links, beide reviewlogins en eventuele permanente reviewbaan werkelijk getest.
- Alleen via beveiligd ownerpaneel verkregen credentials en PINs in private Console-velden gezet.
- `info@dartflow.nl`, privacy, voorwaarden, communityregels en verwijderpagina live bereikbaar.
- Verwijderworker en Auth-hard-delete gecontroleerd; operationele moderatie-/kindveiligheidsmailbox bewaakt.
- Open locatie-, avatar-, media-, netwerk-/log- en deelvragen opgelost voordat Gegevensveiligheid definitief wordt ingediend.
- Leeftijdsgroepen 13–15, 16–17, 18+; UGC/chat/interactie eerlijk vermeld; classificatie uit IARC overgenomen.
- Landen en eventuele accounttestgate gecontroleerd. Gratis download; geen huidige betaalfuncties verklaard.
- Store-assets tonen de native spelersapp met synthetische data. Gecompileerde tests niet als fysieke tests presenteren.

Geen ‘Klaar om over te nemen’ voor de complete productie-indiening zolang verplichte open formulierantwoorden of toegangsproeven ontbreken. De bronimplementatie, webuitrol, Android-artifactlevering en Google Play-publicatie zijn afzonderlijk te verifiëren stappen.

### Eigenaar: steeds één volgende stap

**Cloud-inrichting, providerherstel, eerste AAB en echte API-leestoegang zijn afgerond. Nu alleen doorgeven welke productie-/appinsteltaken nog op het Play Console-dashboard openstaan.** Die vraag ligt bij de eigenaar; antwoord nog niet ontvangen. Na iedere stap eerst de uitkomst controleren voordat de volgende wordt gestart. De technische achtergrond staat in [GitHub → Google Play](github-play.md).

1. **Afgerond:** project **DartFlow**, ID **dartflow**, nummer **955883910359**, door eigenaar bevestigd.
2. **Afgerond volgens eigenaar:** Google Play Android Developer API ingeschakeld; Cloud Shell geopend.
3. **Afgerond volgens eigenaar:** bootstrap en gerichte reparatie voor het immutable GitHub-subject zijn uitgevoerd; de repair meldt ‘gecontroleerd hersteld’. De begrensde trust blijft behouden. Er is geen JSON-sleutel gedownload.
4. **Afgerond:** appgebonden SA-rechten volgens eigenaar; echte GitHub OIDC-/Android Publisher-leestoegang slaagt in check-access 44326068767. Oche Live en financiële/accountbeheerrechten niet toevoegen.
5. **Afgerond:** eerste AAB voor **nl.dartflow.app**, **0.1.1 (2)**, intern **completed/code 2**. Workflow **44326658372** bevestigt de exacte Google-bundelhash zonder nieuwe upload of trackwijziging. Productie is leeg.
6. **Nu eerst de open Dashboard-taken doorgeven.** Vul daarna alleen de werkelijk ontbrekende formulieren en Store-assets aan. Beide productie-reviewlogins zijn server-side getest; open zelf het beveiligde ownerpaneel voor de private app-toegangsvelden. Bevestig landen, accounttype/testgate en de open gegevensverklaringen.
7. Controleer **Publicatieoverzicht** en verstuur pas daarna voor beoordeling. Google-goedkeuring en publieke productiebeschikbaarheid zijn nog niet verkregen.

Automatische Play-toegang is ingeschakeld (`PLAYER_PLAY_ENABLED=true`) en de leesproef slaagt. De eerste productiepublicatie blijft volgens de bestaande releasehelper een Console-stap en is nog niet uitgevoerd of ingediend. Een interne `completed`-release verandert dat niet.
