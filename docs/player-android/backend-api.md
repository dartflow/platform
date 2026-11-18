# DartFlow Speler · native backendcontract

De Kotlin-app gebruikt `/api/player/v1` op de gekozen DartFlow-omgeving. Dit is een begrensde adapter om de bestaande spelers-API: dezelfde domeinfuncties, transacties, bevoegdheden, profiel-ID's, revisies en idempotente commandoreceipts blijven leidend. Er is geen tweede wedstrijdopslag en geen HTTP-doorstuurproxy. De web-API blijft cookie-authenticatie en haar bestaande Origin-controle gebruiken.

> **Uitrolstatus · 18 november 2026:** staging draait maincommit `092c8c1e1cca403fbc29ab0679f7efcfc7bb915a` na de geslaagde [stagingworkflow 44221218169](https://github.com/dartflow/platform/actions/runs/44221218169); 23/23 rookproeven zijn geslaagd. Productiepromotie: geslaagd via [workflow 44221637689](https://github.com/dartflow/platform/actions/runs/44221637689), release `44221637689-1`, dezelfde bron-SHA en 23/23 geslaagde rookproeven. De workflow- en endpointcontroles worden vastgelegd in [het uitrolbewijs](../evidence/native-player-deployed-2026-11-18.json). Echte OTP-/Google-aanmelding en fysieke toestelproeven zijn nog niet uitgevoerd.

## Omgevingen en configuratie

| Omgeving | Canonieke server | applicationId en callbackscheme |
| --- | --- | --- |
| Development | `http://localhost:3000` via `adb reverse tcp:3000 tcp:3000` | `nl.dartflow.app.dev` |
| Staging | `https://staging.dartflow.nl` | `nl.dartflow.app.staging` |
| Productie | `https://dartflow.nl` | `nl.dartflow.app` |

Er zijn geen nieuwe migraties of hosted secrets voor deze adapter. De server gebruikt zijn bestaande `DARTFLOW_DATA_MODE`, `DARTFLOW_APP_ORIGIN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, databaseconfiguratie en spelerspincodeconfiguratie. `GET /api/player/v1/capabilities` geeft alleen de publieke Supabase-URL en publishable key (of de bestaande legacy anon-key), omgeving, callback-URL, app-scheme, OTP-lengtegrenzen en pollinterval. Een verkeerd als publishable geconfigureerde `service_role`- of `sb_secret_`-sleutel wordt geweigerd. Databasegegevens en servergeheimen staan nooit in dit antwoord.

Development geeft `auth.url=null`, `auth.publishableKey=null` en vier lokale testaccounts. `POST /api/player/v1/auth/local` met `{"userId":"<fixture-ID>"}` levert een lokaal ondertekend `accessToken` met `expiresAt` acht uur later. De lokale server bewaart hiervoor automatisch één private sleutel in `.local/native-player-session.key` buiten Git. Dit werkt alleen bij expliciete lokale modus, loopback-origin, loopback-host en uitsluitend loopback forwarding-adressen. Dezelfde token werkt nooit op staging of productie. Dit vervangt geen echte OTP- of Google-test.

De native adapter wordt met de normale webrelease uitgerold; de actuele status per omgeving staat hierboven. De oorspronkelijke implementatiecontrole gebruikte uitsluitend lokale ontwikkeldata. Provider- en toestelacceptatie blijven afzonderlijke controles.

## Authenticatie en terugkeer

E-mailaanmelding gebruikt de bestaande Supabase Auth REST-routes `/auth/v1/otp` en `/auth/v1/verify`; Google gebruikt `/auth/v1/authorize` met PKCE S256. De app ontvangt de publieke configuratie uit capabilities, bewaart verifier en een cryptografisch willekeurige state lokaal, en opent de provider in de systeembrowser. De callback gebruikt de bestaande HTTPS-route:

```text
https://dartflow.nl/auth/callback?native_client=nl.dartflow.app&state=<state>
https://staging.dartflow.nl/auth/callback?native_client=nl.dartflow.app.staging&state=<state>
```

Gebruik `auth.callbackUrl` uit capabilities en voeg alleen de state toe met een URL-builder. De state bestaat uit 32–128 base64url-tekens. De server controleert de bij de omgeving behorende vaste client-ID, laat browsercookies en web-PKCE-verifiers ongemoeid en geeft uitsluitend `code` en `state` terug naar `<scheme>://auth/callback`. Bij een providerfout gaat alleen de generieke fout `oauth` terug. Een alternatieve expliciete `/auth/native/callback` is beschikbaar, maar capabilities gebruikt de bestaande `/auth/callback`. Er komen geen access- of refreshtokens in de callback-URL.

De app accepteert een callback alleen bij haar eigen verwachte scheme, host en pad, met exact de nog actieve state. Daarna wisselt zij de eenmalige code met de bewaarde verifier in via `/auth/v1/token?grant_type=pkce`. Bewaar de voorgenomen baan of wedstrijd tijdens deze roundtrip; open die na sessieherstel en eventuele profielafronding. Refresh gebruikt `/auth/v1/token?grant_type=refresh_token`. Afmelden wist de lokale sessie altijd en probeert de eigen Supabase-sessie af te melden. Bij een netwerk- of providerfout is de serverintrekking niet bevestigd.

Controleer vóór de eerste echte providerproef in elk Supabase-project **Authentication → URL Configuration → Redirect URLs** dat de exacte callback inclusief `native_client` en toegestane `state`-query wordt geaccepteerd. Een bestaande toelating van alleen de exacte URL zonder query dekt mogelijk niet deze volledige return-URL. Beperk de regel tot de eigen HTTPS-host, `/auth/callback`, de juiste `native_client` en de state-query; verruim de hosttoelating niet. De bestaande Google OAuth-client blijft zijn Supabase-providercallback gebruiken. Deel geen OAuth-secret met de Android-app.

De HTTPS-relay kan op zichzelf geen identiteit verlenen. De app valideert state en PKCE; de API valideert daarna per aanvraag de token bij Supabase `getUser(token)` én de ondertekende claims met `getClaims(token)`. De gebruiker-ID's moeten overeenkomen. Anonieme, verlopen en ongeldige sessies worden geweigerd. Gebruikersmetadata verleent geen rechten. De bestaande `ensureAuthProfile` maakt het eigen profiel zo nodig idempotent aan, met onvoltooide onboarding en onbevestigde namen totdat de bestaande profielstap slaagt.

## Aanvragen

Na authenticatie bevat iedere aanvraag uitsluitend:

```text
Authorization: Bearer <Supabase-access-token>
Content-Type: application/json         # bij JSON-mutaties
```

Stuur geen `Origin`, browsercookies of willekeurige accountheader mee. De native adapter vereist een expliciete bearer en valt nooit terug op een cookie of account-ID uit de invoer. Browser-Origin-aanvragen op deze adapter worden geweigerd. De context is intern, asynchroon per aanvraag geïsoleerd en gekoppeld aan het exacte Request-object. Alleen de bestaande mutatiehandler binnen die geauthenticeerde context gebruikt de bearer in plaats van web-CSRF. Dit geeft geen vrijstelling op de gewone `/api/*`-routes.

Antwoorden zijn `private, no-store`; een native antwoord bevat geen sessiecookie. `401` vraagt opnieuw aanmelden; `403` is onvoldoende recht, `409` vraagt actuele toestand/revisie, `410` betekent een vrijgegeven/verlopen sessie, `422` kan bijvoorbeeld een ontbrekende finishbevestiging aangeven, en `429` bevat `Retry-After`. Domeinfouten bevatten `code` en `error`; de bestaande Oche-beheeradapter gebruikt `code` en `message`. Onverwachte database- en providerfouten verlaten de server uitsluitend als generieke onbeschikbaarmelding.

De adapter begrenst aanvragen persistent vóór providerverificatie op IP (1.200/minuut) en na verificatie op account (360 leesaanvragen en 120 mutaties/minuut). De bestaande strengere pincode-, uitnodigings- en Oche-limieten blijven daarnaast gelden. Tokens, pincodevelden en volledige bodies worden niet gelogd.

## Beschikbare suffixen

Alle routes hieronder beginnen met `/api/player/v1/`. Queryparameters en JSON-DTO's zijn identiek aan de bestaande spelers-API. Een onbekende route of niet-toegestane HTTP-methode geeft `404`, ook als de gewone web-API die route wel heeft.

| Methode | Suffix | Bestaand contract |
| --- | --- | --- |
| GET | `capabilities` | Publieke native configuratie, geen aanmelding nodig |
| GET | `session` | `user`, `requiresDisplayName`, `requiresProfileCompletion`, `environment`; lokale testaccounts alleen lokaal |
| GET | `profile` | `{user}` met bestaande profielstatus en uitsluitend pincode-status |
| POST | `profile/complete` | `requestId`, `username`, `displayName`, `pin`, `pinConfirmation` |
| POST | `profile/player-pin` | `requestId`, `mode` (`initial`, `change`, `reset`), `pin`, `pinConfirmation`, waar nodig `currentPin` |
| GET | `overview`, `platform`, `locations`, `player-experience` | Bestaande spelersoverzichten |
| POST | `player-experience` | Bestaande favoriet-, spel- en trainingsdoelvoorkeuren |
| GET | `player-statistics` | Bestaande filters `startScore`, `offset`, `opponent`, `search`, `opponentOffset`, `practiceOffset` |
| GET | `boards/<uuid>` | Baancontext volgens bestaande scan-, reserverings- en toegangsregels |
| POST | `boards/<uuid>/screen-preferences` | Bestaande baangebonden schermvoorkeuren, uitsluitend bevoegde leiding |
| POST | `player-pin/lobby-add` | Bestaande lobbykoppeling met `requestId`, `lobbyId`, `expectedRevision`, `username`, `pin` |
| GET | `matches/<uuid>`, `matches/<uuid>/invitation` | Bestaande wedstrijdprojectie en toegestane uitnodiging |
| POST | `matches/<uuid>/actions` | `requestId`, `expectedRevision`, `action`, optioneel exact hetzelfde `matchId` |
| POST | `events/<uuid>/actions` | Bestaande eigen inschrijving en check-in; planacties blijven voorbehouden aan bevoegde leiding |
| POST | `platform/actions` | Bestaande platformcommandowrapper: `requestId` en `action` |
| POST | `board-activity/continue` | `sessionId`, `warningEpoch`, `requestId` |
| GET | `media/<uuid>` | Bestaande wedstrijdgebonden media-/TURN-configuratie, met bestaande rechten |
| GET / POST | `platform/matches/<uuid>/signals`, `platform/matches/<uuid>/chat` | Bestaande signalering/chat; GET signalen accepteert `after` |
| POST | `platform/matches/<uuid>/replay` | Bestaande begrensde commandoreplay met matchcontrole |
| GET | `platform/rooms/<uuid>/messages` | Alleen toegestane kamermeldingen |
| GET | `feed`, `feed/result/<uuid>`, `feed/replies/<uuid>`, `community/feed`, `community/chat/<kind>/<uuid>` | Bestaande zichtbaarheid, cursor- en feedregels |
| POST | `feed/actions` | Bestaande feedacties |
| GET | `seasons`, `seasons/<uuid>` | Bestaande seizoens- en fixtureprojecties |
| POST | `seasons`, `seasons/actions`, `seasons/player-pin` | Bestaande seizoensrechten en commandovalidatie |
| GET | `oche/v1/context`, `oche/v1/devices` | Accountgebonden beheer van eigen/bevoegde Oche-apparaten |
| POST | `oche/v1/claim`, `oche/v1/home-session`, `oche/v1/devices/<uuid>` | Bestaande eenmalige apparaatkoppeling en beheerrechten |

`platform` gebruikt de bestaande `PlatformOverview` uit `lib/platform-types.ts`: profiel, wedstrijden, historie, baancontext, spelers, clubs, kamers, trainingen, competities, toernooien, lobby's, vrienden en voorkeuren. `matches/<uuid>` gebruikt `MatchView` uit `lib/types.ts`: restscores, spelers, beurten, statistieken en `permissions`. De client baseert bediening op deze actuele rechten. De server valideert iedere actie opnieuw, inclusief de actor, de beurt, revisie en actuele baantoewijzing. Verander bij retries nooit `requestId` of payload van dezelfde operatie.

Native PIN-reset gebruikt uitsluitend de claims die bij de bearer zijn geverifieerd en dezelfde bestaande 15-minutenregel voor interactieve herauthenticatie. Een tokenrefresh of een eigen metadatawaarde maakt een oude login niet recent. Lokale fixtures mogen de bestaande loopback-herauthenticatie gebruiken.

Niet beschikbaar zijn workerjobs, integratiegeheimen, blogbeheer, algemene exports, cookie-aanmeldroutes en Oche-displaycredentialroutes zoals start/redeem/snapshot/refresh. Die laatste horen bij de afzonderlijke Oche Live-app; een spelerssessie wordt nooit een displaycredential.

## Lokale verificatie

`tests/native-player.test.ts` test acht scenario's, waaronder de echte Next-route met lokale database, weigeren van cookie-/actorheadertrucs, web-CSRF, ondertekende en verlopen fixturetokens, parallelle identiteitsscheiding, vaste omgevingscallbacks en alleen publieke configuratie. Een lokale Auth-testadapter controleert werkelijk RS256-ondertekende JWT's/JWKS, huidige Auth-gebruiker, identiteitsovereenkomst, anonimiteit, expiratie en een gewijzigde handtekening. Deze adapter blokkeert externe netwerkbestemmingen. De fixturetest schrijft uitsluitend op de loopbackdatabase en ruimt zijn eigen data op.

`tests/native-player-flows.test.ts` gebruikt daarnaast de echte Next-GET/POST-handlers, native façade, loopbackdatabase, score-engine en statistiekprojecties zonder domein- of API-stubs. De lokale accounts Michael de Groot en Raymond van Dijk voltooien lokale, remote en hybride lobby's, bevestigen deelname en voeren beurten in volgens hun actuele schrijfrechten. De test controleert de afgevlakte `MatchView` die de app leest, twee gelijktijdige identieke inzendingen, verouderde revisies, weigering van de verkeerde schrijver en één definitieve uitslag in beide profielen en hun onderlinge historie. Solo 501 in vijftien pijlen levert 100,20 AVG uitsluitend bij oefenen. Alleen de externe aanmeldroundtrip wordt vervangen door de bestaande lokale fixturelogin. Eigen UUID-resources en eigen limietverbruik worden opgeruimd; bestaande profielrijen moeten vóór en na identiek blijven.

Uitgevoerd: native authregressies 8/8; flowregressies 5/5 inclusief vier deeltests; samen met bestaande auth-, recente-auth- en Oche-API-tests 20/20. TypeScript typecheck en gerichte ESLint slagen. Echte Google PKCE en OTP met beide Supabase-projecten, de callbackallowlist en de systeembrowser-/App Links-terugkeer op een fysiek toestel blijven afzonderlijk open. De lokale regressies en rookproeven bewijzen deze provider- en apparaatwerking niet. Voor de oorspronkelijke fixturecontroles is geen hosted account, database of providerinstelling gewijzigd; de actuele applicatie-uitrol staat hierboven en in het uitrolbewijs.

Bronnen: [Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [Supabase redirect-URL's](https://supabase.com/docs/guides/auth/redirect-urls).
