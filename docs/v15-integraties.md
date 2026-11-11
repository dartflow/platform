# DartFlow v15 — integraties activeren en beheren

Deze werkinstructie is voor Danny als platformeigenaar en voor de bevoegde DG-worker. Voer de stappen eerst op staging uit en herhaal ze met afzonderlijke credentials op productie. Een gezonde applicatie of een opgeslagen sleutel bewijst nog geen werkende login of mailbezorging.

**Actuele stand op 11 november 2026:** Danny heeft Google Auth en Resend SMTP in Supabase toegevoegd en `info@dgwebservices.nl` aangewezen als eigenaar en toegestane echte testontvanger. Onafhankelijke controles bevestigen dat Google en e-mail in beide projecten zijn ingeschakeld, met afzonderlijke Google-webclient-ID's en de juiste redirect via het eigen Supabase-project. De redirectproef stopt vóór accountkeuze en toestemming; een echte Google-login, callback, eigenaarssessie en eigenaarrol zijn nog niet bewezen. Zie [provider-readiness](evidence/v15-provider-readiness-2026-11-11.json) en [Google-redirectbewijs](evidence/v15-google-redirects-2026-11-11.json).

Custom SMTP is door Danny als ingericht gemeld; deze controle kan de SMTP-configuratie of bezorging niet onafhankelijk vaststellen. De eerdere OTP-ontvangst is door Danny bevestigd, maar codeverificatie en sessiebehoud staan nog open. De stagingmetadata bevat nog geen DartFlow Resend-appsleutel of webhookcredential en geen integratie-instellingen; applicatiemail staat in **Log**. In beide omgevingen ontbreekt het projectgebonden Management-token. Dat token is nodig voor Google-configuratiebeheer vanuit DartFlow, **niet voor een echte Google-login met de al ingerichte Supabase-provider**.

## Minimale resterende eigenaarstappen

1. Open [de staginglogin](https://staging.dartflow.nl/inloggen?next=/app/platform/integraties), vraag voor `info@dgwebservices.nl` een actuele e-mailcode aan en voer die zelf in dezelfde browser in. Deel geen code in chat. Controleer na verversen de aangemelde eigenaar en toegang tot [Platformbeheer → Integraties](https://staging.dartflow.nl/app/platform/integraties).
2. Kies daar **Test Google-login** en doorloop zelf accountkeuze en toestemming met dezelfde geverifieerde eigenaarsidentiteit. Controleer de terugkeer naar staging en het tijdstip van de echte inlogtest. De reeds in Supabase ingevoerde Google-credentials hoeven hiervoor niet opnieuw te worden ingevoerd.
3. Voeg op [de stagingintegratiepagina](https://staging.dartflow.nl/app/platform/integraties) de afzonderlijke **app-API-sleutel** en het **webhook signing secret** van Resend via de write-only formulieren toe. Registreer de stagingwebhook uit de matrix, kies een toegestane afzender en `info@dgwebservices.nl` als testontvanger. Bewaar eerst in Log, kies daarna Test en controleer één echte proefmail plus een geldig ondertekende bezorgwebhook. De SMTP-koppeling levert deze appcredentials niet aan.
4. Maak per project het scoped Management-token voor configuratiebeheer vanuit DartFlow beschikbaar via de bestaande root-only overdracht onder §3. Dit kan naast de loginproeven worden afgerond. Herhaal de echte acceptatie op productie met de eigen credentials nadat v15 volgens de releaseprocedure is geactiveerd.

De worker kan de geverifieerde identiteit, eigenaarrol, veilige integratiestatus en auditgegevens controleren. Een gebruikerslogin, ontvangen proefmail en provider-webhook worden elk afzonderlijk als bewijs vastgelegd; het inrichten van Supabase sluit die acceptatiepunten niet vanzelf.

## 1. Kies steeds het juiste project

| Instelling | Staging | Productie |
| --- | --- | --- |
| Website / Auth Site URL | `https://staging.dartflow.nl` | `https://dartflow.nl` |
| Supabase-project | `dartflow-staging` | `dartflow-production` |
| Projectref | `dsnqnvbckkqpzadblshu` | `wlrnowuownakqqgjxnbb` |
| Supabase URL | `https://dsnqnvbckkqpzadblshu.supabase.co` | `https://wlrnowuownakqqgjxnbb.supabase.co` |
| Google Authorized JavaScript origin | `https://staging.dartflow.nl` | `https://dartflow.nl` |
| Google Authorized redirect URI | `https://dsnqnvbckkqpzadblshu.supabase.co/auth/v1/callback` | `https://wlrnowuownakqqgjxnbb.supabase.co/auth/v1/callback` |
| Supabase toegestane appredirect | `https://staging.dartflow.nl/auth/callback` | `https://dartflow.nl/auth/callback` |
| Platformbeheer | `https://staging.dartflow.nl/app/platform/integraties` | `https://dartflow.nl/app/platform/integraties` |
| Resend-webhook | `https://staging.dartflow.nl/api/mail/resend/webhook` | `https://dartflow.nl/api/mail/resend/webhook` |

Een Supabase-beheeraccount of Codex-accountkoppeling geeft toegang om het project te beheren. Dat is een andere identiteit dan een DartFlow-spelersaccount en verleent geen DartFlow-platformrol.

Controleer de projectref vóór iedere providerwijziging. Google keert eerst terug naar **Supabase** en pas daarna naar de **DartFlow-callback**. Voeg de afzonderlijke URL's op de juiste plek toe; gebruik voor deze twee omgevingen de exacte callback en geen brede wildcard. De [Supabase Google-handleiding](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) beschrijft deze koppeling.

## 2. Eerst e-mailcode en het eigenaarsaccount

Danny beheert SMTP en de Auth-mails rechtstreeks in ieder Supabase-project. De Resend-kaart van DartFlow beheert uitsluitend applicatiemail.

Danny heeft deze Supabase-inrichting inmiddels gemeld als uitgevoerd. Onderstaande configuratiestappen blijven het naslag- en herstelpad; voer werkende SMTP-geheimen niet opnieuw in. Ga voor de resterende acceptatie naar de echte loginproef in stap 5 en 6.

1. Kies in Resend het verzenddomein voor de Auth-mail van deze omgeving. Voeg de door Resend opgegeven DNS-records toe en wacht op verificatie. Leg de gekozen afzender vast. Een herkenbare staging-afzender voorkomt verwarring.
2. Maak een eigen Resend-sleutel met verzendrechten voor deze SMTP-koppeling. Gebruik afzonderlijke sleutels voor staging-SMTP, productie-SMTP en de twee app-mailkoppelingen.
3. Open het juiste Supabase-project en configureer custom SMTP:

   | Veld | Waarde |
   | --- | --- |
   | Host | `smtp.resend.com` |
   | Poort | `465` voor impliciete TLS, of `587` voor STARTTLS volgens de gekozen configuratie |
   | Gebruikersnaam | `resend` |
   | Wachtwoord | De eigen SMTP-verzendsleutel van deze omgeving |
   | Afzender | Het gekozen adres op het geverifieerde verzenddomein |
   | Afzendernaam | `DartFlow Staging` of `DartFlow` |

4. Zet de codevariabele `{{ .Token }}` in het relevante e-mailcodetemplate. Controleer bij eerste registratie ook de bevestigingsmail: de eerste gebruiker mag niet vastlopen op een template dat alleen een magic link toont. Kies bewust de OTP-vervaltijd en controleer de overige Auth-mailflows bij wijziging hiervan.
5. Open [de staginglogin](https://staging.dartflow.nl/inloggen?next=/app/platform/integraties) en vraag voor `info@dgwebservices.nl` een echte code aan. Vul uitsluitend de ontvangen code zelf in dezelfde browser in; verzamel of deel de code niet via chat, logs of bewijsbestanden. Herhaal de test later afzonderlijk op productie.
6. Controleer dat de code éénmaal werkt, een verkeerde of verlopen code faalt en de sessie na verversen blijft bestaan. Bewaar als bewijs alleen tijdstip, omgeving en resultaat.

De eerste geverifieerde identiteit met het vooraf aangewezen eigenaarsadres kan de eenmalige serveruitnodiging voor de platformrol consumeren. De rol wordt aan de werkelijke Supabase-UUID gekoppeld. Een schermnaam, browserrol of profielveld verleent geen eigenaarschap. Als de uitnodiging al verbruikt is of een eerder profiel herstel vraagt, vereist dit een gecontroleerde databasebeheerhandeling op de geverifieerde Auth-UUID met auditregistratie en behoud van de eenmalige verbruikstatus. Er is bewust geen HTTP-endpoint om platformrollen toe te kennen. Herstel nooit door willekeurige browserclaims of een publiek formulier aan te passen.

DartFlow slaat SMTP-wachtwoorden en OTP-codes niet op in de applicatie-outbox. Een werkende Resend-appsleutel activeert SMTP niet automatisch. De instellingen volgen [Resend SMTP](https://resend.com/docs/send-with-smtp); de scheiding en mailtemplate horen bij [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) en [e-mail-OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless).

## 3. Google Cloud en de beheerverbinding

### Reeds ingerichte Google-webclients en toekomstige wijzigingen

Maak bij een nieuwe omgeving een afzonderlijke webclient, bij voorkeur in het daarvoor aangewezen Google Cloud-project. Vul appnaam, contactgegevens, doelgroep en eventuele vereiste domeinverificatie in. Voor aanmelden zijn `openid`, `email` en `profile` voldoende; toegang tot Gmail of Drive is hiervoor niet nodig.

Voeg per webclient de JavaScript-origin en **Supabase redirect URI** uit de omgevingsmatrix toe. Neem de Client ID en het nieuw getoonde Client Secret op in de bevoegde kluis. Gebruik beide stagingwaarden uitsluitend op staging en beide productiewaarden uitsluitend op productie.

De actuele redirectcontrole heeft afzonderlijke Client ID's en de correcte Supabase-callbacks voor beide omgevingen bevestigd. De bestaande credentials staan al bij Supabase en hoeven niet nogmaals in DartFlow te worden ingevoerd. Gebruik de bovenstaande inrichting alleen voor een nieuwe omgeving of een bewuste wijziging; voor de huidige configuratie volgt nu de echte inlogtest.

### De worker plaatst het projectgebonden Management-token

DartFlow heeft voor het bewerken en onafhankelijk uitlezen van Google-providerinstellingen vanuit de app een aparte **server-only** Supabase Management-credential nodig. Deze ontbreekt momenteel in beide omgevingen. Een Google-login met een rechtstreeks in Supabase ingerichte provider blijft zonder dit token mogelijk. De publishable key, databasecredential en Google Client Secret hebben elk een andere functie en zijn hiervoor geen vervanging.

Danny maakt per omgeving een scoped PAT voor uitsluitend de betreffende projectref. De benodigde rechten zijn:

- `auth_config_read` voor configuratiecontrole;
- `auth_config_write` en `project_admin_write` voor de Google-wijziging.

In het [Supabase-tokenformulier](https://supabase.com/dashboard/account/tokens) heten deze keuzes **Auth Config: Read-write** en **Project Settings: Read-write**. Beperk ieder token tot de eigen projectref uit de matrix. De [actuele permissionstabel](https://supabase.com/docs/guides/platform/personal-access-tokens) vereist beide schrijfkeuzes voor het bijwerken van Auth-configuratie; Auth Config bevat ook het benodigde leesrecht.

Leg eigenaar en vervaldatum vast. De worker plaatst het token als `SUPABASE_MANAGEMENT_TOKEN` in de beschermde runtimeconfiguratie van uitsluitend die omgeving. Geef het via de overeengekomen beveiligde server-secretvoorziening door, zonder plakken in chat, Git of browseropslag. Een verbonden Supabase-account voor de worker is niet automatisch een Management-token voor de draaiende applicatie.

Een concreet overdrachtspad is een afzonderlijk root-only bestand op `dg-nxttrack-01`. Een bevoegde beheerder kan voor staging uitvoeren:

```bash
sudo test -e /etc/dg-sites/dartflow-staging/supabase-management-token.pending || sudo install -m 0600 -o root -g root /dev/null /etc/dg-sites/dartflow-staging/supabase-management-token.pending
sudoedit /etc/dg-sites/dartflow-staging/supabase-management-token.pending
```

Vul via de editor uitsluitend het stagingtoken op één regel in. Zet het secret niet als shellargument of in shellgeschiedenis. Gebruik op productie het eigen pad `/etc/dg-sites/dartflow-production/supabase-management-token.pending` en het eigen productietoken. Meld aan de worker alleen dat het bestand klaarstaat. De worker controleert het bestand en maakt een nieuwe immutable configuratieversie; dit losse bestand activeert niets vanzelf. Verwijder het overdrachtsbestand na opname in de beschermde bundel. Voor de app-API-key en webhookcredential gebruik je de write-only formulieren zodra de v15-beheeromgeving bereikbaar is.


De server kiest zelf project en vaste API-host. Hij mag uitsluitend deze Google-velden aanbieden: `external_google_enabled`, `external_google_client_id` en `external_google_secret`. SMTP, redirects en andere providers worden door dit formulier niet gewijzigd. De actuele rechten staan in de [Management PATCH-documentatie](https://supabase.com/docs/reference/api/v1-update-auth-service-config); projectbeperking en tokenverloop in [Supabase scoped PATs](https://supabase.com/docs/guides/platform/personal-access-tokens).

### Danny test Google en beheert bedoelde wijzigingen

1. Log met de e-mailcode in als eigenaar en open [Platformbeheer → Integraties → Google Auth op staging](https://staging.dartflow.nl/app/platform/integraties).
2. Controleer de getoonde omgeving, projectref en callbacks. **Beheerverbinding ontbreekt** betekent dat de worker het Management-token nog moet plaatsen; dit verhindert de bestaande Google-login of de knop **Test Google-login** niet.
3. Alleen bij een bewuste providerwijziging vanuit DartFlow: voer de nieuwe Client ID en het bijbehorende Client Secret in. Het secretveld is write-only en blijft na de actie leeg. Een andere Client ID vereist het bijbehorende nieuwe secret. Een leeg secret bij ongewijzigde Client ID behoudt de bestaande providercredential. Laat de al rechtstreeks in Supabase ingerichte gegevens voor de huidige loginproef staan.
4. Sla uitsluitend een bedoelde configuratiewijziging op. **Opgeslagen bij Supabase** bevestigt alleen die handeling. Zonder wijziging ga je direct naar de inlogtest.
5. Kies **Test Google-login** en doorloop met het afgesproken testaccount werkelijk Google → Supabase → de juiste DartFlow-host. Gebruik voor het eigenaarsbewijs een Google-account met hetzelfde geverifieerde adres `info@dgwebservices.nl`; dit adres moet daarvoor als Google-identiteit bruikbaar zijn. Een afzonderlijk Gmail-profiel krijgt niet automatisch de platformrol. Controleer dat de aanmelding bij dezelfde geverifieerde eigenaar-UUID hoort, plus sessiebehoud, profiel en toegewezen rechten.
6. Test dat e-mailcode nog werkt. Google uitschakelen vereist een nieuwe, door Supabase geverifieerde OTP-aanmelding van maximaal vijftien minuten oud, naast een ingeschakelde e-mailprovider. Log daarvoor opnieuw in met de ontvangen e-mailcode; een sessieverversing of alleen een oude Google-login voldoet niet.

De server bewaart een kort geldige, ondertekende testpoging voor de actieve configuratieversie. Na de PKCE-uitwisseling controleert hij voor een eigenaar de actuele OAuth-aanmeldmethode en het teruggekomen Google-token bij het vaste Google OpenID-userinfo-endpoint. Het Google-subject moet bij de geverifieerde Supabase-identiteit horen. Een verouderde poging, OTP-login, gewijzigd configuratienummer of alleen een oude Google-identiteit levert geen geslaagde Google-test op. Providerpayload en token worden niet als testbewijs opgeslagen. Deze aanvullende bewijscontrole mag een verder geldige gebruikerslogin niet blokkeren. [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) beschrijft het userinfo-endpoint.

Een fout of time-out na een providerwijziging kan een onzekere externe uitkomst geven. Controleer opnieuw en voer daarna de echte inlogtest uit. Een applicatierollback herstelt Google-credentials bij Supabase niet vanzelf. Eerdere inlogteststatus wordt bij configuratiewijziging ongeldig; een algemene verbonden-badge telt niet als canary-bewijs.

## 4. Resend voor applicatiemail

### Verzenddomein en afzender

Danny verifieert het gekozen verzenddomein in Resend en controleert SPF, DKIM en het afgesproken DMARC-beleid. `info@dgwebservices.nl` is de toegestane testontvanger. Het is pas een werkende afzender als het betrokken verzenddomein daadwerkelijk bij Resend geverifieerd is én de runtime dit afzenderadres toestaat. De [Resend-domeinhandleiding](https://resend.com/docs/dashboard/domains/introduction) beschrijft verificatie en afzonderlijke subdomeinen.

Maak daarna per omgeving een eigen app-sleutel met uitsluitend verzendrechten, waar ondersteund beperkt tot het geverifieerde verzenddomein. Gebruik hiervoor geen SMTP-sleutel opnieuw.

De gemelde Resend SMTP-inrichting bij Supabase dekt uitsluitend Auth-mail. De onafhankelijke stagingcontrole vond nog geen app-API-sleutel of webhookcredential in DartFlow. Onderstaande app-mailstappen blijven daarom nodig, inclusief de echte bezorg- en webhookproef.

### Sleutels en instellingen invoeren

1. Open [Platformbeheer → Integraties → Resend op staging](https://staging.dartflow.nl/app/platform/integraties).
2. Voer de app-API-sleutel in bij **API-sleutel toevoegen of vervangen**. Kies een toegestaan afzenderadres, afzendernaam en Reply-To. Vink `info@dgwebservices.nl` aan als testontvanger.
3. Bewaar eerst in **Log**. Dit kan mailgebeurtenissen en snapshots registreren zonder externe bezorging.
4. Kies voor een expliciete transporttest **Test**. Controleer template, omgeving en ontvanger vóór **Testmail versturen**. De test gebruikt fictieve gegevens en een herkenbaar testonderwerp.
5. Controleer het verzendlog en de eigen mailbox. Alleen echte provideracceptatie geeft de sleutel de status **Getest**; het opslaan van een sleutel geeft **Opgeslagen**.
6. Herhaal met eigen credentials op productie. Productie blijft in Log totdat de eigenaar de echte verzendmodus bewust activeert. De runtime bepaalt de maximale modus en exacte toegestane testadressen.

Een clubbeheerder kan binnen de eigen club templates, automatiseringen, wachtrijpauze en toegestane clubinstellingen beheren. De globale verzendaccountcredentials blijven van de platformeigenaar. Gewone gebruikers kunnen optionele meldingscategorieën kiezen; functionele besluiten volgen het productbeleid.

De app bewaart API-sleutel en webhooksecret als afzonderlijke versleutelde credentials. De omgevingsgebonden `DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY` blijft in de beschermde serverconfiguratie. De beheer-API geeft metadata terug en geen opgeslagen sleutel, ciphertext of providerrespons.

### Webhook registreren

Registreer in Resend de exacte webhook-URL uit de omgevingsmatrix. Selecteer de relevante e-mailstatusgebeurtenissen, waaronder sent, delivered, delivery delayed, failed, bounced en complained. Voer het signing secret van die webhook write-only in de Resend-kaart van dezelfde DartFlow-omgeving in.

Voer vervolgens een toegelaten echte test uit. De webhookstatus is pas geverifieerd na een daadwerkelijk ontvangen, geldig ondertekende webhook. De server controleert de oorspronkelijke body met de officiële verifier en bewaart een provider-event duurzaam en idempotent. Een vervalste terugmelding wijzigt geen jobstatus. De [Resend-verificatiehandleiding](https://resend.com/docs/webhooks/verify-webhooks-requests) licht het handtekeningcontract toe.

## 5. Sjablonen, triggers en wachtrij gebruiken

Open **Organiseren → Mailbeheer** (`/app/mail`) en controleer de actieve scope. Er zijn 32 catalogussjablonen. `auth-otp` is alleen een referentie; Supabase Auth voert die flow uit.

Een concept is gescheiden van de actieve publicatie. Opslaan bewaart het concept, publiceren maakt een nieuwe versie en reset herstelt de platformdefault. Bij een gelijktijdige wijziging vraagt de API om opnieuw laden. Een al aangemaakte mailjob bewaart zijn oorspronkelijke onderwerp, HTML, tekst, afzender en templateversie.

De server commit de geaccepteerde domeinwijziging en mailjob samen. De periodieke worker claimt beperkte batches. Iedere retry behoudt dezelfde job, snapshot en transportsleutel. Resend bewaart zijn idempotentiesleutel 24 uur; de applicatie stopt automatisch herhalen vóór het einde van dat venster. Een onzekere verzending vraagt controle voordat bewust een nieuwe verzending wordt aangemaakt. Zie [Resend-idempotentie](https://resend.com/docs/dashboard/emails/idempotency-keys).

Herinneringen vereisen een werkelijk vastgelegd tijdstip: een bevestigd wedstrijdmoment of een expliciete toernooistart/check-in. Alleen een toernooidatum is geen verzonnen starttijd. De planner respecteert het ingestelde herinneringsmoment, actuele status en voorkeuren; verlopen of gewijzigde afspraken worden vlak vóór transport opnieuw gecontroleerd. Bordmail staat standaard uit en vervangt de oproep op telefoon en zaalscherm niet.

## 6. Runtimeoverdracht aan de worker

Dit zijn serverwaarden; de native releaseketen maakt hiervoor een eigen configuratiebundel. Zet de geheime waarden niet in GitHub Variables of `NEXT_PUBLIC_`-velden.

| Naam | Doel en eigenaar |
| --- | --- |
| `DARTFLOW_ENV` | Vaste keuze `staging` of `production`; worker |
| `DARTFLOW_APP_ORIGIN` | Eigen canonieke origin uit de matrix; worker |
| `DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY` | Afzonderlijke base64-gecodeerde 32-byte sleutel per omgeving; worker genereert en beschermt |
| `DARTFLOW_MAIL_WORKER_TOKEN` | Eigen sterk worker-token per omgeving; worker genereert en beschermt |
| `DARTFLOW_MAIL_MAX_MODE` | Bovengrens `test` op staging en `live` op productie; verandert de initiële Log-instelling niet |
| `DARTFLOW_MAIL_ALLOWED_FROM` | Exact toegestane afzenderadressen; afgestemd met Danny en het geverifieerde domein |
| `DARTFLOW_MAIL_TEST_RECIPIENTS` | Exacte runtimegrens; aangewezen adres `info@dgwebservices.nl` |
| `SUPABASE_MANAGEMENT_TOKEN` | Eigen projectgebonden PAT voor Google-configuratiebeheer vanuit de app; Danny verleent, worker plaatst server-side. Niet vereist voor Google-login |
| `DARTFLOW_ADMIN_REQUIRE_MFA` | Alleen afdwingen wanneer de gekozen eigenaar-MFA ook is ingericht en getest |

De Google Client Secret staat bij Supabase Auth. De SMTP-sleutel staat bij Supabase Auth SMTP. De Resend-appsleutel en het webhooksecret staan versleuteld in de private applicatiedatabase. Deze vier geheimsoorten hebben eigen rotatie en een eigen test.

## 7. Rotatie, herstel en oplevering

Roteer eerst op staging. Bewaar de vorige werkende configuratie volgens het toegestane kluisbeleid, vervang gericht de betrokken credential, test de volledige route en trek daarna de vorige providerkey in. Wijziging van de encryptiesleutel vereist een gecontroleerd plan voor opnieuw versleutelen of opnieuw invoeren; een databaseback-up alleen kan bestaande envelopes zonder die sleutel niet openen.

Na een databaseherstel blijft transport in Log of gepauzeerd totdat outbox en providerhistorie zijn gereconcilieerd. Een applicatierollback draait externe providerwijzigingen en al bezorgde mail niet terug.

Leg per omgeving vast:

- echte OTP-aanvraag, ontvangen code, eenmalige verificatie en sessiebehoud, zonder code op te slaan;
- actuele eigenaarrol op de geverifieerde UUID;
- geslaagde Google-redirect, callback en gebruikerssessie na de laatste configuratiewijziging;
- Resend-provideracceptatie en ontvangen testmail naar het toegestane adres;
- een geverifieerde bezorgwebhook en een stabiele outboxjob bij retry;
- de gekozen verzendmodus, verantwoordelijke en verval-/rotatiedatum van credentials.

Zolang de providergegevens of echte tests ontbreken, blijft het betreffende punt **Open**. Lokale mocks, een ingevuld formulier, een geslaagde API-configuratiecontrole en server-readiness gelden elk als hun eigen beperkte bewijs.
