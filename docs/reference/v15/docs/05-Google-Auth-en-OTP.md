# Google Auth en inloggen met e-mailcode

## Doel en eigenaarschap

De v15-demospeler, lokale rolwissel en Baanmodus-demo-identiteiten worden in de VPS-app gekoppeld aan echte Supabase Auth-gebruikers. Een speler kan inloggen met een e-mailcode of Google. De platformeigenaar kan Google inrichten via **Beheer → Integraties → Google Auth**. Danny configureert Resend als custom SMTP afzonderlijk in elk Supabase-project. DartFlow verstuurt operationele mails via de Resend API zoals uitgewerkt in [Resend en mailbeheer](04-Resend-en-mailbeheer.md).

| Onderdeel | Instellen | Gebruik |
| --- | --- | --- |
| Google OAuth client-ID en secret | Google Auth Platform maakt beide aan. DartFlow-beheer schrijft ze via een serverroute naar Supabase Auth. | Supabase Auth rondt Google OAuth af. |
| Supabase Management-token | Eenmalig per omgeving door de eigenaar in de server-secretstore plaatsen. | Uitsluitend de server gebruikt het voor Google-providerconfiguratie. |
| Supabase URL en publishable key | Projectconfiguratie per omgeving. | Normale Auth-sessies en toegang onder RLS. |
| Resend SMTP-sleutel | Danny voert deze in bij Supabase Authentication → SMTP Settings. | Supabase Auth bezorgt OTP- en overige auth-mails. |
| Resend API-sleutel voor app-mail | DartFlow-beheer, per omgeving. | De DartFlow-mailworker verstuurt operationele mails. |

In het prototype heeft `public/app.js` een rolwissel voor demo’s, `public/baan.js` een demo-profieltoken en `public/mail-engine.js` een afgeschermd `auth-otp`-voorbeeld. Gebruik de huisstijl en invoerpatronen als referentie. In staging en productie bepaalt Supabase Auth de identiteit en bepaalt de server de rollen. Het OTP-voorbeeld mag als statische preview blijven staan. Echte codes worden uitsluitend door Supabase Auth aangemaakt en bezorgd.

## Omgevingen en callbackwaarden

Onderstaande domeinen en refs zijn voorbeelden. Neem de echte waarden uit de bestaande DartFlow-deployconfiguratie en uit de Google-providerpagina van het juiste Supabase-project over. Toon in de beheeromgeving een vaste omgevingsnaam en kopieerknoppen voor de waarden van die omgeving.

| Waarde | Stagingvoorbeeld | Productievoorbeeld |
| --- | --- | --- |
| Supabase-projectref | `<staging-projectref>` | `<productie-projectref>` |
| OAuth-client | Afzonderlijke webclient voor DartFlow Staging | Afzonderlijke webclient voor DartFlow |
| Google Authorized JavaScript origin | `https://staging.dartflow.example` | `https://dartflow.example` |
| Google Authorized redirect URI | `https://<staging-projectref>.supabase.co/auth/v1/callback` | `https://<productie-projectref>.supabase.co/auth/v1/callback` |
| Supabase Auth Site URL | `https://staging.dartflow.example` | `https://dartflow.example` |
| Supabase toegestane DartFlow-redirect | `https://staging.dartflow.example/auth/callback` | `https://dartflow.example/auth/callback` |
| DartFlow OAuth `redirectTo` | Exact de staging-DartFlow-callback | Exact de productie-DartFlow-callback |
| Auth-mailafzender | `inloggen@auth.staging.dartflow.example` | `inloggen@auth.dartflow.example` |

Gebruik de door Supabase getoonde callback bij een custom Auth-domein. Google stuurt de browser eerst naar Supabase. Supabase stuurt de browser vervolgens naar de DartFlow-callback. Leg elke URL vast in de juiste beheerconsole. De Google-callback moet exact overeenkomen met de geregistreerde URI. Gebruik per Supabase-project een exacte allowlist voor de DartFlow-callback. Houd localhost en tijdelijke previews in een apart lokaal project. Leid hostnamen af uit serverconfiguratie en niet uit de requestheader of een vrij invulveld.

### Google Auth Platform

1. Maak een afzonderlijk Google Cloud-project voor staging en productie als daar nog geen passende projecten voor bestaan. Gebruik in **Clients** per omgeving een OAuth-client van het type **Web application**.
2. Vul in **Branding** de echte appnaam, contactinformatie, homepage en privacy-URL in. Voeg vereiste domeinen toe en doorloop verificatie waar Google die vraagt. Vraag alleen `openid`, `email` en `profile` voor het inloggen. Google Drive, Gmail en langdurige Google-toegang zijn overbodig voor deze flow.
3. Stel **Audience** in volgens de beoogde doelgroep. Voor publieke productie gebruik je **External → In production**. Voor staging test je met de beoogde testaccounts. Google kent voor inloggen met uitsluitend basisscopes een uitzondering op de algemene Testing-beperkingen. Beperk toegang tot de staging-app zelf via de afgesproken testtoegang en rollen.
4. Neem **Authorized JavaScript origins** en **Authorized redirect URIs** uit de tabel over met de echte waarden. De JavaScript-origin bevat alleen protocol, host en eventueel poort. Bewaar het door Google getoonde client secret via de beveiligde beheerinvoer.
5. Test de volledige route met een account uit de beoogde doelgroep en bevestig zowel de juiste Google-branding als de uiteindelijke DartFlow-host. Bij `redirect_uri_mismatch` vergelijk je de werkelijk verzonden callback met de URI in de juiste Google-client. Bij `org_internal` controleer je de doelgroep van het juiste Google-project.

[Google OAuth-webserverflow](https://developers.google.com/identity/protocols/oauth2/web-server) · [Google Audience en publicatiestatus](https://support.google.com/cloud/answer/15549945) · [Supabase Google-provider](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) · [Supabase redirect-allowlist](https://supabase.com/docs/guides/auth/redirect-urls)

## Beheerformulier en configuratiecontract

Open **Platformbeheer → Integraties → Google Auth**. De pagina toont **Staging** of **Productie** op basis van serverconfiguratie. De server haalt projectref en token uit de actieve omgeving. Serverhandelingen vereisen een actuele Supabase-identiteit en de bevoegdheid van platformeigenaar. Gebruik voor credentialwijzigingen het bestaande beleid voor recente herauthenticatie, inclusief `aal2` waar de beheeromgeving MFA afdwingt. Toets de rechten op iedere request, inclusief directe API-requests door clubbestuurders. Beveilig mutaties tegen CSRF, valideer velden en begrens verzoeken.

Gebruik `DARTFLOW_ENV` voor het vaste omgevingslabel, `DARTFLOW_APP_ORIGIN` voor de canonieke app-origin en `SUPABASE_MANAGEMENT_TOKEN` als uitsluitend server-side secret. Koppel deze variabelen bij het opstarten aan de expliciet geverifieerde Supabase-projectref. Gebruik dezelfde origin voor callback, sessiecookies en redirects. De OAuth-clientsecret komt alleen uit de write-only invoer voor een expliciete providerupdate.

| Veld of actie | Verwachting |
| --- | --- |
| Project en callbacks | Actieve projectref, DartFlow-origin en beide callback-URL’s, uitsluitend lezen. |
| Google-provider | Huidig resultaat van het Supabase-project, met tijdstip van laatste succesvolle statuscheck. |
| Client-ID | Invulbaar voor eerste inrichting en vervanging. Toon bestaande waarde gemaskeerd. Een gewijzigde ID vereist de bijbehorende nieuwe secret in dezelfde actie. |
| Client secret | Invoer van type password, altijd leeg bij openen. Een lege invoer bewaart de bestaande waarde. Een ingevoerd secret vervangt de bestaande waarde alleen bij expliciet opslaan. Maskering is geen invulwaarde. |
| Opslaan | Slaat Google-configuratie server-side op bij Supabase. Onderscheid **Opgeslagen bij Supabase** en **Inlogtest geslaagd**. |
| Inschakelen en uitschakelen | Wijzigt alleen `external_google_enabled` wanneer de bestaande credentials behouden blijven. Controleer vóór uitschakelen of een platformeigenaar nog via een werkende route kan inloggen. |
| Controleer verbinding | Leest de Google-providerstatus opnieuw. Dit valideert het Management-token en de zichtbare configuratie. |
| Test Google-login | Open de echte OAuth-flow in een aparte browsersessie met een testaccount. Een geslaagde PKCE-callback en verifieerbare sessie vormen het testresultaat. |
| Laatste wijziging | Omgeving, actie, actor-ID, tijdstip, status en foutcategorie. Het auditspoor bevat geen credential of auth-payload. |

Een **Verbonden**-badge op basis van een GET of PATCH is geen bewijs dat een speler kan inloggen. Gebruik bijvoorbeeld de statussen **Beheerverbinding ontbreekt**, **Provider uitgeschakeld**, **Geconfigureerd**, **Inlogtest vereist**, **Inlogtest geslaagd** en **Configuratiecontrole mislukt**. Registreer testbewijs per omgeving en configuratieversie. Een client-ID-wijziging of rotatie maakt een eerder testbewijs verouderd. Ga bij een onverwachte API-uitkomst uit van onbekende configuratiestatus. Lees de toestand opnieuw en laat de eigenaar gericht herstellen.

Voorbeeld van het DartFlow-servercontract, via Route Handlers of gelijkwaardige Server Actions. Het formulier werkt met een serveruitgegeven configuratieversie. Serialiseer wijzigingen per project en weiger een verlopen versie met een verzoek om de instellingen opnieuw te laden. Dit voorkomt dat twee beheerders elkaars invoer stilzwijgend overschrijven.

```ts
type GoogleSettingsView = {
  environment: 'staging' | 'production'
  projectRef: string
  providerCallback: string
  appCallback: string
  management: 'ready' | 'unavailable' | 'error'
  providerEnabled: boolean | null
  clientIdHint: string | null
  revision: number
  lastCheckedAt: string | null
  lastVerifiedLoginAt: string | null
}

type UpdateGoogleSettings = {
  expectedRevision: number
  enabled?: boolean
  clientId?: string
  clientSecret?: string
}
```

Gebruik voor een eerste inrichting bijvoorbeeld `GET /api/admin/integrations/google-auth` voor de veilige status en `PATCH /api/admin/integrations/google-auth` voor de wijziging. Validatie bepaalt of de actie alleen de status wijzigt of beide credentials vervangt. Een onzekere provideruitkomst bewaart een status voor handmatige controle. Het servercontract accepteert uitsluitend de getoonde velden, ook als iemand rechtstreeks een eigen JSON-request bouwt.

### Management API

Supabase-hosted ondersteunt het volgende projectendpoint:

```http
GET https://api.supabase.com/v1/projects/{ref}/config/auth
PATCH https://api.supabase.com/v1/projects/{ref}/config/auth
Authorization: Bearer <omgevingsgebonden-management-token>
Content-Type: application/json
```

De getoonde bearer is een Supabase Management-credential, los van Supabase-projectsleutels en de Google OAuth-credential. Een projectgebonden fine-grained PAT voor deze route heeft `auth_config_read` nodig voor GET en `auth_config_write` plus `project_admin_write` voor PATCH. Gebruik één token per omgeving en beperk de toegang tot de exacte projectref. Leg de vervaldatum en verantwoordelijke vast. Gebruik een reeds aanwezige, beheerde Supabase OAuth-integratie wanneer die in de bestaande omgeving is ingericht. De bijbehorende Management OAuth-scopes zijn `auth:read` en `auth:write`. Draai deze integratie uitsluitend server-side. Gebruik geen brede PAT als automatische fallback bij een ontbrekende scope.

Voorbeeld van een eerste inrichting of bewuste credentialrotatie:

```json
{
  "external_google_enabled": true,
  "external_google_client_id": "<GOOGLE_OAUTH_CLIENT_ID>",
  "external_google_secret": "<GOOGLE_OAUTH_CLIENT_SECRET>"
}
```

De velden zijn respectievelijk boolean, string en string. Laat niet-bewerkte velden weg. Een expliciete uitschakelactie stuurt alleen `{"external_google_enabled":false}`. Stuur geen e-mail-, SMTP-, redirect- of overige providerinstellingen met deze PATCH mee. Inschakelen zonder een secret kan alleen als al bruikbare credentials in Supabase zijn geconfigureerd. Een projectstatus of gemaskeerde waarde alleen bewijst dit niet. Houd e-mailverificatie en noncecontrole actief. Wijzig hun instellingen alleen bewust na review van de bestaande Google-configuratie.

**Serveruitvoering.** Een servermodule bouwt de HTTPS-URL uit een vaste Management-host en de geverifieerde projectref van de omgeving. De browser levert geen host, projectref of vrije Management-payload. Verstuur een strikt toegestane subset, met time-out en zonder redirects te volgen. Vang `401` (token ongeldig/verlopen), `403` (bevoegdheid of project), `429` (beperking), invoerfouten en time-outs af met veilige, gerichte meldingen. Een mislukte verzoekstatus wordt nooit als opgeslagen getoond. Lees na een succesvolle wijziging opnieuw de gewenste booleans en de gemaskeerde client-ID. Behandel het volledige Management-antwoord als geheim, omdat het responschema ook credentialvelden bevat. Retourneer naar de browser alleen eigen veilige velden.

**Bewaren en rotatie.** Stuur het ingevoerde Google-secret eenmalig via TLS en server-side door naar Supabase. Gebruik Supabase Auth als opslag voor deze providercredential. DartFlow bewaart alleen niet-geheime statusmetadata, auditgegevens en versienummer. Log geen bodies, headers, OAuth-codes, cookies, tokens of secrets. Redigeer ook trace-, crash- en reverse-proxylogs. Vervang en verifieer nieuwe credentials in staging voordat de productie-eigenaar de productieconfiguratie wijzigt. Bewaar vorige werkende waarden voor herstel alleen in de bevoegde kluis als rotatiebeleid dat toelaat. Een app-rollback wijzigt de externe Supabase-configuratie niet vanzelf.

**Bij bestaande configuratie of ontbrekend token.** Neem een al werkende provider over zonder de secret opnieuw te vragen. Zolang de Management-verbinding ontbreekt, toont het DartFlow-formulier een eerlijke foutmelding en instructies voor een projectgebonden token. De eigenaar kan Google rechtstreeks configureren via **Supabase → Authentication → Sign In / Providers → Google**. Zodra het token beschikbaar is, controleert DartFlow de status. Ontbrekende beheerrechten blokkeren de beheermutatie en laten de bestaande gebruikerslogin intact. Laat de releasecheck een veilige, read-only bevestiging gebruiken. Geef een live GET/PATCH pas een geslaagde status nadat die daadwerkelijk tegen het bedoelde project is gecontroleerd.

[Supabase Management PATCH](https://supabase.com/docs/reference/api/v1-update-auth-service-config) · [Supabase Management GET](https://supabase.com/docs/reference/api/v1-get-auth-service-config) · [Scoped PAT](https://supabase.com/changelog/scoped-personal-access-tokens-ga) · [Supabase OAuth-scopes](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes) · [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa)

## Login- en autorisatieflow

1. De gebruiker kiest **Doorgaan met Google**. De OAuth-startroute gebruikt de SSR-client met PKCE. Zij slaat de verifier op in de cookies van de huidige browser en gebruikt de vaste callback van de actieve omgeving.
2. Supabase handelt de Google-uitwisseling af. De DartFlow Route Handler `/auth/callback` wisselt de code eenmalig in via `exchangeCodeForSession(code)` en laat de SSR-cookieadapter de bijgewerkte cookies op de respons zetten. Houd de start, callback en route-overgang in dezelfde browsersessie. Verwijder de code uit de URL via een directe redirect.
3. Controleer sessie en identiteit server-side via `getClaims()` voor beschermde pagina’s en `getUser()` waar een actuele Auth-gebruikersrecord vereist is. Gevoelige beheeracties lezen ook de actuele platformrol en geverifieerde assurance level. Gebruik `getSession()` alleen wanneer de ruwe sessie nodig is. Gebruik de ingebedde gebruikersgegevens daarvan niet voor toegang.
4. Bepaal de DartFlow-rol uit serverbeheerde toekenningen. Koppel profielen en clublidmaatschap aan Supabase user UUID. Leg profielcreatie idempotent vast. RLS en serveracties controleren toegangsrechten per club, rol en object. Een Google-e-mailadres, domein, browserrol, JWT `user_metadata` of nog geldige verouderde rolclaim kan nooit vanzelf platformbeheer geven. Gebruik Supabase identity linking voor reeds geverifieerde e-mailidentiteiten. Test de koppeling van een bestaand OTP-account en Google-account. Voeg geen zelfgeschreven merge op e-mailadres toe.
5. Bewaar terugkeer naar een QR-baan, uitnodiging of wedstrijd als een korte servergecontroleerde route-intentie of een strikt toegestane interne route. Controleer de rechten opnieuw na login. Accepteer geen externe bestemming, protocol-relative URL, achterwaartse slash of gecodeerde omleiding. Zet invite-secrets en OAuth-tokens niet in analytics, referrers of authlogs. Het publieke Sprint-scherm leest een smalle openbare weergave. Invoer en overdracht vereisen de bevoegdheid voor precies die baan en partij.

Voorbeeld van de OAuth-start in een serveractie. `appOrigin` komt uit de gevalideerde omgevingsconfiguratie. `supabase` is de SSR-client met cookieadapter voor deze request. Het daadwerkelijk versturen van cookies en redirects volgt de versie van de SDK en het projectframework.

```ts
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: new URL('/auth/callback', appOrigin).href,
    skipBrowserRedirect: true,
  },
})
if (error || !data.url) return { status: 'google_start_failed' }
redirect(data.url)
```

Gebruik een expliciete sessie-refresh op beveiligde app-routes volgens de Supabase Next.js-integratie voor de geïnstalleerde versies. Voorkom caching van persoonsgegevens en responses die `Set-Cookie` zetten. Voor auth-callbacks, app, admin en sessiegebonden API’s geldt `Cache-Control: private, no-store`. Houd authcookies hostgebonden per omgeving en volg de actuele veilige cookieopties van de SSR-integratie. Gebruik in staging en productie HTTPS. Pin SDK-versies en commit de lockfile. Voeg geen tokens toe aan `localStorage` of eigen JWT-claims met gebruikersinvoer.

[Supabase SSR-client](https://supabase.com/docs/guides/auth/server-side/creating-a-client) · [Supabase SSR en caching](https://supabase.com/docs/guides/auth/server-side/advanced-guide) · [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow) · [Identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)

## OTP via Supabase custom SMTP

Danny configureert in **Supabase → Authentication → SMTP Settings** per omgeving een eigen verified Resend-domein en een aparte SMTP-sleutel. In DartFlow-beheer toont **Authenticatie → E-mailcode** de status en testinstructies. Een beheerder kan vanaf daar de echte OTP-flow openen. DartFlow slaat de SMTP-inloggegevens niet op en haalt ze niet op voor de UI.

| Instelling | Voorbeeld |
| --- | --- |
| SMTP-host | `smtp.resend.com` |
| Poort | `465` voor impliciete TLS, of `587` voor STARTTLS als gekozen SMTP-configuratie dit verwacht |
| Gebruikersnaam | `resend` |
| Wachtwoord | Afzonderlijke Resend sending key voor het geverifieerde auth-domein van deze omgeving |
| Afzendernaam | DartFlow of DartFlow Staging |
| Afzenderadres | Adres op het geverifieerde auth-domein van die omgeving |
| Rate limit | Stel in op gemeten loginvolume en Resend-capaciteit. Beperk aanvraag en verify ook in de app, met veilige herstelmeldingen. |

Supabase gebruikt hetzelfde e-mailsysteem voor magic links en OTP. Zet bij het **Magic Link**-sjabloon de OTP-variabele `{{ .Token }}` in plaats van de linkvariabele. Configureer de e-mail-OTP-vervaltijd bewust in Auth, bijvoorbeeld 10 minuten als dat past bij de afgesproken onboarding. Die instelling beïnvloedt ook de geldigheid van andere Auth-e-maillinks. Controleer hun flows mee vóór je de instelling wijzigt. Gebruik voor de test een inbox die niet tot het Supabase-projectteam behoort om custom SMTP te bevestigen. Controleer SPF en DKIM zoals Resend die voor het concrete domein opgeeft.

Voorbeeld van het sjabloon in Supabase. Onderwerp: **Je DartFlow-inlogcode**. Gebruik een herkenbare staging-afzender en voeg in staging `[STAGING]` aan het onderwerp toe.

```html
<h1>Inloggen bij DartFlow</h1>
<p>Vul deze eenmalige code in op het scherm waar je inlogt.</p>
<p><strong style="font-size:28px;letter-spacing:.15em">{{ .Token }}</strong></p>
<p>Heb je geen inlogcode aangevraagd? Dan kun je deze mail negeren.</p>
```

Voorbeeld van de scheiding tussen aanvragen en verifiëren:

```ts
await supabase.auth.signInWithOtp({
  email,
  options: { shouldCreateUser: false },
})

// Verifieer in een afzonderlijke actie via dezelfde SSR-cookieadapter.
const { data, error } = await supabase.auth.verifyOtp({
  email,
  token: submittedCode,
  type: 'email',
})
```

Geef op **Inloggen** een neutrale aanvraagbevestiging die bestaande en onbekende adressen niet onderscheidt. Als DartFlow zelfregistratie ondersteunt, gebruik een herkenbare registratieflow die bewust accountcreatie toestaat en verificatie vereist. Voeg throttling toe op IP en adres met passende opslag, en begrens herhaalde verificatiepogingen. Geef herstelopties voor vertraagde, ongeldige en verlopen codes zonder secrets in logs of profieldata. Houd alle OTP- en Auth-mails buiten de DartFlow-outbox. Registreer in DartFlow hoogstens niet-geheime status en foutcategorie. Bij lokale tests is Mailpit geschikt om de code te controleren zonder echte externe mail te versturen.

[Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) · [Supabase e-mail-OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless) · [Supabase Auth-sjablonen](https://supabase.com/docs/guides/auth/auth-email-templates) · [Resend SMTP](https://resend.com/docs/send-with-smtp)

## Eerste beheerder, incident en herstel

- Maak of verifieer het eerste eigenaarsaccount per omgeving in de bestaande, bevoegde provisioningroute. Koppel de platformrol gecontroleerd aan de echte Supabase UUID via een eenmalige, geaudite handeling. Verwijder het bootstrapmechanisme zodra de eerste eigenaar toegang heeft. Leg verantwoordelijkheid en hersteltoegang vast. Een demo-rol, publiek registratieformulier of onbeheerd e-mailadres kan geen eigenaar creëren.
- Configureer en test OTP en de tweede factor voor de platformeigenaar voordat Google de gebruikelijke inlogoptie wordt. Houd als herstelroute de bestaande bevoegde Supabase-dashboardtoegang beschikbaar. Bewaar recoverygegevens in de geautoriseerde kluis.
- Bij een verkeerde Google-redirect, verlopen client secret of uitval: verifieer projectref en configuratie, houd OTP beschikbaar en herstel de Google-provider gericht. Schakel Google alleen uit als die keuze de bestaande toegangssituatie daadwerkelijk verbetert. Rotatie van een Management-token verandert uitsluitend de beheerverbindingsmogelijkheid.
- Bij een incident met een credential: roteer het betrokken geheim in de juiste omgeving, controleer auth- en beheerlogs op gebruik, test login opnieuw en registreer het incident. Rotatie van Resend-appmail, Resend SMTP, Google secret en Supabase Management-token zijn afzonderlijke handelingen.

## Acceptatie en bewijs

| Test | Verwacht resultaat |
| --- | --- |
| Platformeigenaar opent Google-beheer | Toont het juiste doelproject, de echte callbacks en gemaskeerde status. Clubbeheerder of speler krijgt geen configuratiedata en een rechtstreekse mutatie wordt geweigerd. |
| Ongeldige sessie, ontbrekende verhoogde verificatie of CSRF | Beheermutatie bereikt de Management API niet. |
| Eerste inrichting of secretrotatie | De server PATCH’t alleen de bedoelde Google-velden. Body, credentials en antwoorden komen niet terug in HTML, logs, browserstorage of build. |
| Bestaande provider en lege secretinvoer | Huidige secret wordt behouden. Een andere client-ID met lege secret wordt afgewezen. |
| Verlopen token of onjuiste scope | Zichtbare beheerfout. Geen succesmelding, geen terugval naar een bredere key en geen wijziging aan de andere omgeving. |
| Tijd-out na update | Verifieer de uitkomst via readback en echte OAuth-test. Behoud onderscheid tussen opslaan en werken. |
| Google op staging | Een geautoriseerde tester doorloopt Google → Supabase → staging. De sessie blijft na verversen geldig en ontvangt uitsluitend de toegekende rollen. |
| Google op productie | Een afgesproken canary-account doorloopt de productieketen met de productieclient. Staging-redirect, -sessie en -credentials werken hier niet. |
| Ongeldige redirect, geannuleerde OAuth, replay | Een nette fout en nieuwe loginmogelijkheid. Er ontstaat geen sessie met ongeldige, gebruikte of verlopen code. |
| OTP via Resend SMTP | In afgesproken externe testinbox komt een echte code aan. Juiste code werkt eenmalig, verkeerde en verlopen code worden geweigerd, herhaalde aanvragen worden begrensd. App-mail bevat geen OTP. |
| OTP- en Google-identiteit | Controleer dat dezelfde geverifieerde gebruiker één profiel behoudt waar Supabase linking dat ondersteunt. Verschillende identiteiten krijgen geen elkaars rollen of data. |
| Gebruiker A en gebruiker B | Controleer cookie-refresh, responsheaders en isolatie via twee browsers. Geen sessielek via Caddy, CDN of prefetch. |
| Baan-QR en uitnodiging na login | Komt terug op de juiste baan of partij. Andere gebruikers kunnen geen score invoeren, de schrijver overnemen of private clubdata lezen zonder recht. |
| Hersteltest | Een bevoegde eigenaar houdt toegang via OTP en MFA terwijl Google uit of onbereikbaar is. Status wordt hersteld na reparatie en geslaagde canary. |

Deze uitwerking baseert zich op de officiële documentatie, gecontroleerd op 11 november 2026. De echte Supabase-projectrefs, Google-projecten, tokenrechten, callbackregistraties en SMTP-configuraties worden pas bevestigd tijdens de uitvoering in de bestaande staging- en productieomgeving.
