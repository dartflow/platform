# Dartflow authenticatie data en realtime

Dit hoofdstuk geeft Codex het uitvoercontract voor het echte Dartflow op de DG Webservices-server. Begin met een afzonderlijke stagingomgeving voor één clubavond. Laat de speler op beide telefoons hetzelfde account gebruiken voor Vandaag, de club, de partij en de historie. De OTP-stroom en Google-login gebruiken één gebruikersidentiteit.

## Vastgelegd en voorgesteld

| Onderwerp | Status | Keuze |
| --- | --- | --- |
| Inloggen | Opdracht | E-mail-OTP of Google-login voor Dartflow zodra de serverversie draait. Google-login betekent hier Google OAuth. |
| App-runtime | DG-standaard | Native Next.js en Node onder systemd met Caddy als webingang. Staging en productie bouwen dezelfde geaccepteerde bron-SHA met hun eigen configuratie. |
| Backend | Voorgesteld | Afzonderlijk Supabase-project per omgeving voor Auth, Postgres en Realtime. Resend verzorgt OTP-mail via Custom SMTP van Supabase Auth. |
| Accounts in de pilot | Voorgesteld | Vooraf toegelaten testaccounts. Zet vrije registratie pas aan nadat de gewenste instroom en roltoekenning zijn vastgesteld. |
| Beheer | DG-grens en ontwerpkeuze | De DG-infrastructuurbeheeromgeving vereist private toegang en AAL2 volgens de blauwdruk. Voor Dartflow zelf krijgen gewone spelers OTP of Google. Gebruik als voorgesteld beleid AAL2-step-up voor platformbeheer en gevoelige acties zoals eigendomsoverdracht en uitslagoverschrijving. |

De aangeleverde DG-blauwdruk noemt een afzonderlijk Supabase-project voor het **serverdashboard**. Dartflow krijgt in dit ontwerp eigen projecten en eigen accountrollen. De echte provider-ID’s, DNS-namen, OAuth-clients, afzender en testontvangers komen uit het DG-hostprofiel en de kluisreferenties.

## Gebruikersstroom

### E-mailcode

1. Bied op `/inloggen` het e-mailveld, de knop **Stuur een code** en **Verder met Google** aan. Sla een toegestane interne vervolgbestemming bij voorkeur op als een korte servergebonden intentie. Bij een baan-QR kan die intentie de gekozen baan en wedstrijd bevatten.
2. Valideer het adres op de server en vraag een code aan met `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })` voor de besloten pilot. Configureer in Supabase een e-mailtemplate met `{{ .Token }}` voor de code. Gebruik een generieke ontvangsttekst die de aanwezigheid van een account afschermt.
3. Toon op mobiel een gelabeld invoerveld met `inputmode="numeric"` en `autocomplete="one-time-code"`. Behandel de code als tekst zodat voorloopnullen behouden blijven. Houd **Opnieuw sturen** en **Wijzig e-mailadres** bereikbaar met geopend toetsenbord. Voorstel voor de pilot is tien minuten geldigheid en minimaal zestig seconden tussen aanvragen voor hetzelfde adres. Houd de ingestelde grenzen gelijk aan de interface en handhaaf ze aan de serverkant en bij de provider.
4. Verifieer op de server met `supabase.auth.verifyOtp({ email, token, type: 'email' })`. Schrijf de sessiecookies op de serverresponse. Geef bruikbare foutmeldingen voor ongeldige, verlopen en al gebruikte codes. Bij een nieuwe aanvraag of een 429 toont de interface de resterende wachttijd voor zover bekend.
5. Laad het profiel op `auth.users.id`. Controleer de opgeslagen club- en wedstrijdrechten. Ga naar de gevalideerde bestemming of **Vandaag**. Wanneer de baan ondertussen een andere partij heeft, toon de actuele stand en vraag opnieuw toestemming voor de huidige partij.

Voorbeeld voor het Supabase Auth-template **Magic Link** dat door `signInWithOtp` wordt gebruikt.

```html
<h1>Je Dartflow-inlogcode</h1>
<p>Vul deze eenmalige code in op het Dartflow-inlogscherm.</p>
<p><strong>{{ .Token }}</strong></p>
<p>Heb je zelf geen code aangevraagd? Dan kun je deze mail negeren.</p>
```

Voeg een afzenderdomein toe in Resend en verifieer de vereiste DNS-records. Configureer per Supabase-project Custom SMTP met de eigen afzender en begrensde SMTP-credential. Voorstel voor de configuratie is `smtp.resend.com`, poort `587` met STARTTLS en gebruikersnaam `resend`. Gebruik een eigen Resend-sleutel met passende verzendrechten als SMTP-wachtwoord. Bewaar die in de Auth-configuratie met een referentie in de kluis. Infra-acceptatie heeft geen uitgaande effecten. De afzonderlijke stagingtest gebruikt uitsluitend afgesproken testaccounts en ontvangers.

Test de throttling ook met meerdere spelers achter één clubnetwerk. Gebruik omgevingsbrede begrenzing op aanvragen en verificaties naast de providerlimieten. Voor een publieke inschrijving hoort misbruikbeheersing ook in de Auth-providerconfiguratie. Een publishable key kan rechtstreeks worden gebruikt tegen het Supabase Auth-endpoint.

### Google OAuth

1. Maak per omgeving een OAuth-client van het type **Web application** in Google Cloud. Leg de Google-consentconfiguratie vast en beperk de stagingclient tot toegelaten testgebruikers. Registreer als **Authorized redirect URI** de callback die in de Google-providerconfiguratie van dat Supabase-project staat. Gewoonlijk is die `https://<supabase-project-ref>.supabase.co/auth/v1/callback`. Gebruik de waarde van het gekozen project, ook bij een aangepast Auth-domein.
2. Configureer in Supabase de Google-client-ID en het clientsecret. Stel in Supabase de **Site URL** in op de canonieke omgeving. Voeg de precieze appcallback `https://<dartflow-omgeving>/auth/callback` toe aan de redirect-allowlist. Google verwijst eerst naar Supabase. Supabase verwijst daarna naar Dartflow. Registreer beide bestemmingen op de juiste plek.
3. Start op de server met `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`. Gebruik voor `redirectTo` de vaste appcallback op `DARTFLOW_APP_ORIGIN`. Bewaar de interne vervolgroute in een aan de sessie gebonden intentie met korte geldigheid. De browser volgt daarna de door de SDK teruggegeven autorisatie-URL.
4. Wissel de teruggekomen `code` in de Next.js Route Handler `/auth/callback` met `exchangeCodeForSession(code)` uit. Gebruik het SDK-beheer van PKCE en sessiecookies. Verifieer daarna de identiteit en laad het Dartflow-profiel. Laat de appcallback alleen de gevalideerde interne vervolgbestemming gebruiken. Sta uitsluitend interne paden binnen de canonieke origin toe, met een expliciete lijst van routes. Neem Google-tokens alleen in beheer als een aparte geautoriseerde productfunctie die ooit nodig heeft.
5. Geef bij een geannuleerde consentflow, verlopen callback of verkeerde omgeving een herstelknop terug naar inloggen. Verifieer het gelijke account-ID in staging wanneer dezelfde geverifieerde e-mail via beide methoden wordt gebruikt. Supabase ondersteunt automatische koppeling bij hetzelfde e-mailadres onder zijn beveiligingsvoorwaarden. Een afwijkend adres vraagt een geverifieerde herstel- of expliciete koppelstroom.

| Omgeving | Google Cloud redirect | Supabase Site URL | Supabase appcallback |
| --- | --- | --- | --- |
| Staging | `https://<staging-project-ref>.supabase.co/auth/v1/callback` | `https://<dartflow-staging-host>` | `https://<dartflow-staging-host>/auth/callback` |
| Productie | `https://<production-project-ref>.supabase.co/auth/v1/callback` | `https://<dartflow-production-host>` | `https://<dartflow-production-host>/auth/callback` |

## Next.js sessies en configuratie

Gebruik App Router met `@supabase/supabase-js` en `@supabase/ssr` op vastgelegde versies. Gebruik afzonderlijke browser- en serverclients. Pas cookie-afhandeling en sessieverversing toe volgens de documentatie van de gepinde versie. Bij een Next.js-versie met Proxy hoort de SSR-sessieverversing in `proxy.ts` voor de daarvoor bestemde routes. Geef de bijgewerkte requestcookies en alle nieuwe responsecookies door zodat redirects en volgende requests dezelfde sessie zien. Laat beveiligde Server Actions, Route Handlers en de Data Access Layer de identiteit verifiëren met `getClaims()`. Gebruik `getUser()` bij acties die een actuele bevestiging door de Auth-server vereisen. Lees club-, event- en schrijfrechten uit de actuele autoritatieve databaserijen. Ruwe gegevens van `getSession()`, clientmetadata en actieve menucontext hebben uitsluitend hun eigen weergavefunctie.

Serveer persoonlijke HTML, API-responses en callbackresponses met passende private cacheheaders. Gebruik HTTPS, omgevingsgebonden cookies met hostscope en passende SameSite-instellingen voor de redirectflow. Bewaar een aanvullende inlogintentie in een Secure en HttpOnly-cookie of als server-side handle. Verwerk uitloggen server-side via de SDK en wis appintenties. Log alleen uitkomst, gestandaardiseerde reden, aanvraag-ID en tijd. Houd OTP's, callbackcodes, sessiecookies, autorisatieheaders, Google-secrets en mailcredentials buiten applicatielogs en Caddy-accesslogs. Configureer redactie of uitsluiting van callbackquery's.

```dotenv
# App buildconfig per GitHub Environment
NEXT_PUBLIC_SUPABASE_URL=https://<environment-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<environment-publishable-key>

# Serverconfig per omgeving
DARTFLOW_APP_ORIGIN=https://<environment-canonical-host>

# Alleen opnemen bij een expliciet benoemde beheertaak
# SUPABASE_SECRET_KEY=<environment-server-secret>
```

| Configuratie | Beheerlocatie | Grens |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` en `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | GitHub Environment-variabelen voor de doelbuild | Deze waarden zijn publiek. RLS en de gebruikerssessie bepalen de toegang. |
| `DARTFLOW_APP_ORIGIN` | Beschermde appconfig per omgeving | Valideer bij opstarten dat het een toegestane HTTPS-origin zonder pad is. Bouw callbacks op deze waarde. |
| `SUPABASE_SECRET_KEY` | Alleen voor een afzonderlijke goedgekeurde beheertaak | Houd standaard afwezig voor de gewone app. Voor profielen, scoremutaties en resultaten gebruikt de app een gebruikersgebonden client. |
| Google-client-ID en -secret | Google Cloud en de Google-providerconfiguratie van het juiste Supabase-project | Gescheiden credentials en redirectlijsten per omgeving. |
| Resend SMTP-host, poort, gebruiker, afzender en credential | Auth Custom SMTP van het juiste Supabase-project | Een afgesproken testafzender en afgescheiden credentials voor staging. |

Supabase wijzigde de standaardblootstelling van tabellen via Data API en GraphQL in 2026. Leg daarom per migratie expliciete grants vast op de gekozen API-oppervlakken. Schakel RLS in voor tabellen in blootgestelde schema's. Houd interne tabellen, auditmetadata en functies waar mogelijk in een private schema. Controleer de changelog en de adviesuitvoer opnieuw bij de echte implementatie.

## Rollen en zichtbaarheid

Gebruik het UUID uit de geverifieerde Supabase-identiteit als sleutel voor `profiles`. Gebruik afzonderlijke relaties voor actieve clublidmaatschappen, eventrollen, deelnemers en de huidige schrijver. Het kiezen van een club in de navigatie verandert de context van de interface. Dezelfde context krijgt de server via een expliciete club- of event-ID en controleert die opnieuw bij iedere relevante lees- en schrijfactie.

| Identiteit | Server-side rechten |
| --- | --- |
| Speler | Eigen profiel en historie, toegelaten clubgegevens, eigen inschrijvingen en bevestigingen. Partijdeelname volgt uit het deelnemersrecord. |
| Clublid of aanvoerder | Toegang tot de eigen club en toegestane kamers. Aanvoerder geeft alleen aanvullende teamrechten die bewust aan die rol zijn gekoppeld. |
| Clubeigenaar of clubbeheerder | Leden, aanvragen en clubfuncties binnen de toegewezen club. Eigendomsoverdracht vraagt de eigenaarsrol en de afgesproken step-up. |
| Wedstrijdleider | Toewijzing, check-in, geschillen en regie voor toegewezen evenementen. Afhandeling van een geschil legt beslissing en actor vast. |
| Huidige schrijver | Scorebeurt schrijven voor de gekoppelde actieve partij. Schrijverswisseling gaat via een gevalideerde serveractie en verandert de partijrevisie. |
| Zaalscherm | Alleen het gepubliceerde score- en statussnapshot van de gekoppelde baan. De schermsessie heeft een afzonderlijke, intrekbare leesbevoegdheid. |
| Platformbeheerder | Expliciet toegekende en geauditeerde platformtaken. Beheeracties gebruiken de afgesproken AAL2-controle. |

Gebruik afgeschermde snapshots voor openbare resultaten en schermen. Beperk de projectie tot de bedoelde namen, baan, score, rondestatus en meldingen. Houd contactinformatie, clublijsten, uitnodigingstokens en interne notities uit de openbare projectie. Een QR wijst naar een baan of een begrensde deelname-intentie. Start of schrijf pas wanneer een geverifieerde gebruiker de servercontrole voor die partij doorstaat. Een eventuele schermkoppeling maakt alleen lezen mogelijk en kan door de wedstrijdleiding worden ingetrokken.

Controleer met RLS en mutatierechten dat directe aanroepen van de Data API dezelfde toegang respecteren. Een rol staat in een serverbeheerde relatie en wordt afgeleid uit de betrokken rij. Beperk schrijfoperaties tot getypeerde mutaties die hun eigen actor-, club-, event- en toestandstoets uitvoeren. Gebruik bij een RPC bij voorkeur `SECURITY INVOKER`. Wanneer een transactie beschermde tabellen moet wijzigen via een definerfunctie, houd die functie in een private schema, gebruik een beperkt uitvoeraccount en een vaste `search_path`, kwalificeer objectnamen en controleer `auth.uid()` en alle betrokken relaties in de functie. Beperk `EXECUTE` op de goedgekeurde ingang en test ook rechtstreeks via een normale gebruikerssessie.

## Eén bron voor partij score en uitslag

| Entiteit | Minimale verantwoordelijkheid |
| --- | --- |
| `profiles`, `clubs`, `club_memberships` | Identiteit en clubrelatie. Unieke actieve lidmaatschapsrelatie per gebruiker en club. |
| `events`, `event_staff`, `entries`, `check_ins` | Eigenaar, rol, deelname en aanwezigheid voor één evenement. |
| `boards`, `board_assignments` | Benoemde baan en actieve toewijzing. Een unieke actieve toewijzing per baan en per ingeplande partij. |
| `matches`, `match_players`, `visits` | Eén match-ID voor regie, telefoon, scorekaart en historie. Reproduceerbare scoreberekening en een oplopende revisie. |
| `match_confirmations`, `match_results` | Akkoord op een concrete uitslagrevisie. Eén definitieve uitslag per partij, met gecontroleerde correcties als aparte auditgebeurtenis. |
| `action_receipts`, `audit_events` | Ontvangstbewijs voor retries en controleerbaar spoor van mutaties. |

Voorbeeld van een scorecommando vanaf de mobiele schrijver. De server leidt de actor af uit de sessie en controleert de baan, partij, schrijversrol, revisie, beurt, score en eventuele dubbelbevestiging.

```json
{
  "requestId": "<unieke-uuid-per-mutation>",
  "matchId": "<server-match-uuid>",
  "expectedRevision": 7,
  "action": { "type": "score", "score": 60, "darts": 3, "doubleConfirmed": false }
}
```

1. Verifieer de actor en zijn toegang tot de match. Serialiseer gelijktijdige acties op de partijrij in één Postgres-transactie. Controleer onder die vergrendeling eerst het ontvangstbewijs met unieke sleutel `(match_id, actor_id, request_id)`. Hetzelfde verzoek geeft hetzelfde semantische resultaat zonder een tweede beurt. Een andere payload bij hetzelfde aanvraag-ID geeft een conflict. Bewaar hiervoor een canonieke payloadhash bij het ontvangstbewijs.
2. Controleer voor een nieuwe mutatie de actuele revisie en rechten op de actie. Laat de server de volgende toestand berekenen met de geteste scorelogica. Sla beurt, revisie en ontvangstbewijs in dezelfde transactie op. Geef bij een achterhaalde revisie `409` en een gemachtigde verwijzing naar de actuele stand terug.
3. Gebruik de twee speler-ID’s uit de wedstrijd voor bevestiging op dezelfde uitslagrevisie. Zodra beide geldige bevestigingen bestaan, schrijf de unieke definitieve uitslag en verwerk de poule, knock-out of competitiestand in dezelfde transactie of via een idempotente gebeurtenis met `match_id` als verwerkingssleutel. Definieer de regel voor dispensatie, correctie of geschil als een afzonderlijke geautoriseerde actie.
4. Verstuur een wijzigingssignaal pas na commit. Gebruik private Supabase Realtime-kanalen met toegang op basis van deelname of regierechten. Laat het signaal de revisie aankondigen. De telefoon haalt het gemachtigde snapshot opnieuw op bij een gat of reconnect. Het zaalscherm gebruikt een eigen leesendpoint met een beperkte projectie. Begin voor het scherm met begrensd pollen of een gelijkwaardig leespad dat dezelfde scope handhaaft.
5. Geef bij tijdelijk netwerkverlies de laatst bevestigde revisie weer met verbindingsstatus. Herhaal een onbevestigd verzoek met hetzelfde aanvraag-ID. Verwerk een conflict met de actuele stand voordat de schrijver een nieuwe beurt indient. Na schrijverovername weigert de server nieuwe scoremutaties van de vorige schrijver.

## Overgang vanuit het prototype

De huidige Sites-code is een referentie voor gedrag en ontwerp. `worker/baan-domain.js` bevat de partijlogica en `public/scoring.js` de herbruikbare scoreberekening. `worker/baan-api.js` bewaakt een bordrevisie, verwerkt ontvangstbewijzen en bewaart resultaten in de huidige D1-laag. De D1-tabellen staan in `drizzle/0000_baanmodus.sql`. `public/baan.js` ververst de gedeelde stand met polling. Profielen in die stroom zijn demoprofielen met een eigen bearer-token. Overige demo’s zoals de gewone kamers en clubregie steunen grotendeels op browseropslag.

Begin de echte stagingpilot met expliciet gemaakte testaccounts, clublidmaatschappen, een clubavond en één of twee banen. Leg seeddata en reset vast in versiebeheer. Neem voorbeeldscores alleen als synthetische fixtures over. Koppel eventuele later te migreren records aan een geverifieerd UUID op basis van een afzonderlijk mappingbestand en een controleerbare bron. Demotokens, pincodes en displaynamen zijn demo-invoer. Auth-, D1- en lokale opslagdata blijven per omgeving gescheiden. Bewaar de Sites-versie als referentie voor een tijdelijke route- of visuele vergelijking tijdens het porten.

## Acceptatietests

| Test | Verwachting en bewijs |
| --- | --- |
| OTP mobiel | Eén goedgekeurde stagingontvanger doorloopt aanvraag en geldige code. Test plakken, voorloopnul, verkeerd, verlopen, hergebruik, wachten op resend en 429. Bewijs met tijdstip en aanvraag-ID zonder code. |
| Google | Exacte callback werkt via Caddy op de staging-host. Test annuleren, verlopen sessie, verkeerd project en een niet-toegestane externe vervolglink. Bewijs met run, origin en foutcode. |
| Eén account | Dezelfde geverifieerde pilotgebruiker ziet met OTP en Google hetzelfde profiel-ID, lidmaatschap, partij en historie. |
| Rolverdeling | Een speler kan geen adminactie, andere clubdata of schermconfig openen. Test een vervalste rol in de payload, directe API-aanroep, verwijderde clubrol en waar ingesteld een admin op AAL1. |
| Sessies en omgeving | Uitloggen, verlopen sessie, tokenverversing en verlopen callback geven het bedoelde herstelpad. Stagingtokens, Google-callbacks en schermkoppelingen werken binnen hun eigen omgeving. Controleer geen publieke caching van gebruikersgegevens. |
| Twee apparaten en scherm | Loop met twee geverifieerde accounts van check-in en bordoproep naar partij, schrijverovername, finish en bevestiging. Telefoons en 9:16-scherm krijgen dezelfde revisie. |
| Gelijktijdigheid | Twee schrijfacties op dezelfde revisie leveren één commit op. Schrijverswissel blokkeert nieuwe beurten van de vorige schrijver. Bij retry verschijnt geen extra beurt. |
| Definitieve uitslag | Een bevestiging maakt een geplande uitslag nog niet definitief. Twee geldige bevestigingen op dezelfde revisie werken historie en toepasselijke stand precies één keer bij. Herhaal commit, reconnect en resultaatverwerking. |
| Geheimen en mail | Bevestig SMTP uitsluitend met toegelaten testontvangers. Inspecteer outputbundle, logs en responses op OTP, OAuth-code, Auth-token en providersecrets. Publiceer alleen geredigeerd bewijs. |

Stagingacceptatie is afgerond wanneer een GitHub-run op de bedoelde omgeving de exacte SHA, externe HTTPS-revision, database- en Auth-readiness en de gebruikersketen aantoonbaar bevestigt. Registreer per test Pass, Fail, Open of gemotiveerd N.v.t. Zie ook het infrastructuurhoofdstuk voor de beschermde deploy- en herstelvolgorde.

## Officiële implementatiedocumentatie

- [Supabase e-mailcode en verificatie](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) en [limieten](https://supabase.com/docs/guides/auth/rate-limits)
- [Resend SMTP](https://resend.com/docs/send-with-smtp)
- [Supabase Google-provider en PKCE](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [redirect-allowlist](https://supabase.com/docs/guides/auth/redirect-urls) en [Google OAuth voor webservers](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Supabase identiteitskoppeling](https://supabase.com/docs/guides/auth/auth-identity-linking) en [MFA](https://supabase.com/docs/guides/auth/auth-mfa)
- [Supabase SSR-clients en sessieverificatie](https://supabase.com/docs/guides/auth/server-side/creating-a-client) en [Next.js-authenticatie](https://nextjs.org/docs/app/guides/authentication)
- [Supabase API-keys](https://supabase.com/docs/guides/getting-started/api-keys) en [Supabase changelog](https://supabase.com/changelog)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) en [Realtime-autorisatie](https://supabase.com/docs/guides/realtime/authorization)
