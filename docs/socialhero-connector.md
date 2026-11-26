# SocialHero Connector · contract v1

Een platformbeheerder opent `/blog/beheer` (ook bereikbaar via `/app/blog`) en opent het paneel **SocialHero** onder de paginatitel. Kopieer de eenmalige code van de blogbestemming in SocialHero, plak deze in het veld en kies **Koppelen**. De code is tien minuten geldig en moet bij de getoonde website en omgeving horen. Alleen platformrollen `owner` en `admin` kunnen de verbinding en publicatiebevoegdheid beheren.

Na verificatie mag SocialHero de mogelijkheden en artikelstatus lezen en concepten en media opslaan. Publiceren begint uitgeschakeld. Zet **SocialHero mag artikelen publiceren** expliciet aan om publicatie toe te staan. De server controleert die actuele toestemming bij iedere publicatie; een eerder opgehaalde capabilities-respons verleent geen blijvend recht. **Ontkoppelen** trekt de toegang direct in en bewaart artikelen, revisies, media en bestaande resultaten van herhaalde verzoeken.

## Serverconfiguratie en installatie

| Instelling | Betekenis |
| --- | --- |
| `DARTFLOW_APP_ORIGIN` | Bestaande canonieke website-origin uit de publieke deploymentconfiguratie; staging is `https://staging.dartflow.nl`, productie `https://dartflow.nl`. |
| `DARTFLOW_SOCIALHERO_ORIGIN` | Verplichte vaste vertrouwde HTTPS-origin van de SocialHero-server voor deze omgeving. Geen afsluitende slash, gebruikersnaam, wachtwoord, pad, query of fragment. De code bepaalt deze URL nooit. |
| `DARTFLOW_SOCIALHERO_SITE_ID` | Optionele stabiele site-ID; standaard `dartflow`. Deze ID bepaalt ook de bestaande blogopslag; behoud `dartflow` op DartFlow en behoud de gekozen ID bij herdeployen en opnieuw koppelen. Gebruik voor een andere website een andere ID. |
| `DARTFLOW_ENV` | Expliciet `staging` of `production` voor koppelen. De claim, credential en artikelen blijven aan deze omgeving gebonden. |
| `DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY` | Bestaande per omgeving gescheiden sleutel: 32 willekeurige bytes in canonieke Base64. Versleutelt uitsluitend de tijdelijke credential voor herstel van provisioning. |

Voor DartFlow staging is de door de beheerder opgegeven SocialHero-origin `https://socialhero.dgwebservices.nl`. De stagingvoorbeelden gebruiken die waarde. Bevestig voor productie afzonderlijk welke SocialHero-omgeving daarvoor bedoeld is. Een API-key van OpenAI of een andere AI-provider is niet nodig.

1. Pas de migratie `supabase/migrations/20261126000000_socialhero_connector.sql` toe via het bestaande afzonderlijke databasebeheerpad. Lokaal gebruikt dit project `npm run db:migrate`; voer deze lokale opdracht uitsluitend met de loopbackconfiguratie uit. De migratie voegt connectoropslag toe en vervangt de unieke sleutels voor artikelmapping en idempotentieresultaten door sleutels met de bestemming erbij. Bestaande artikelen, resultaten en handmatige API-credentials blijven bewaard in de bestaande ongebonden bestemming.
2. Voeg de twee SocialHero-velden toe aan een **nieuwe immutable** runtimebundel. Gebruik `ops/runtime.env.example` en de omgevingsvoorbeelden. Houd staging- en productieorigin, encryptiesleutel en credentials gescheiden. De native deployhelper valideert beide nieuwe velden als serverconfiguratie en weigert ze in `public.json` of `NEXT_PUBLIC_*`.
3. Volg de bestaande native pipeline in `docs/deployment.md`: commit/push → geslaagde CI voor de volledige SHA → stagingdeploy met de nieuwe runtimebundel → acceptatie. De deploybroker migreert de database niet. Bij een reeds geïnstalleerde root-owned helper moet ook de gereviewde runtimeallowlist via het bestaande hostbeheer worden bijgewerkt voordat een bundel met deze velden kan worden gebruikt.
4. Maak in SocialHero een code aan voor de exacte site-ID, HTTPS-origin en omgeving. Koppel via het bestaande geauthenticeerde beheer. Controleer eerst een herkenbaar concept en een update op staging. Een openbare publicatietest vereist een aangewezen stagingartikel en expliciet aangezette publicatiebevoegdheid.

## Provisioning en herstel

De server maakt per nieuwe koppelactie een willekeurige `attemptId`. Hij bewaart alleen de hash van de code en gebruikt bij een verloren claimrespons dezelfde poging wanneer dezelfde code opnieuw wordt aangeboden. Na een geslaagde claim worden credentialhash, bestemmings-ID, verbindings-ID, rechten en voorlopige status transactioneel opgeslagen. Pas daarna wordt SocialHero gevraagd de verbinding te verifiëren.

Een voorlopige credential kan alleen `GET /api/socialhero/v1/capabilities` gebruiken. Andere blogacties krijgen `PAIRING_IN_PROGRESS` met `Retry-After`. Na een bevestigde verificatie wordt de credential actief en wordt de tijdelijke versleutelde kopie verwijderd. **Verbinding controleren** hervat een afgebroken verificatie. Bij een verloren claimrespons kan dezelfde code opnieuw worden geplakt. Een verlopen installatie vervalt; de bestaande worker ruimt de tijdelijke credential ook zonder beheerbezoek op. Maak dan een nieuwe code. Definitieve afwijzing vraagt opnieuw koppelen. Browserresponsen bevatten uitsluitend de gecontroleerde status, geen code of bearer.

Bij opnieuw koppelen bepaalt SocialHero dezelfde `destinationId` voor hetzelfde project, dezelfde site en omgeving. Artikelmapping en idempotentieresultaten gebruiken die stabiele bestemming en blijven behouden. De vorige actieve credential wordt pas na een geslaagde vervanging ingetrokken; een ingetrokken oude credential kan de nieuwe verbinding niet ontkoppelen. Handmatig ontkoppelen trekt lokale toegang meteen in, ook als de provider niet bereikbaar is.

## Publicatie-API en blogadapter

De vaste routes staan onder `/api/socialhero/v1`: `GET /capabilities`, `POST /media`, `PUT /posts/{externalId}`, `GET /posts/{externalId}`, `POST /posts/{externalId}/publish` en `DELETE /connection`. Alle routes vereisen de bearer. Machine-antwoorden en beheerantwoorden gebruiken `Cache-Control: no-store`; fouten bevatten `{ code, message, requestId }`. Bestaande handmatig aangemaakte DartFlow-blogtokens blijven via de bestaande blog-API werken.

Schrijfacties vereisen een `Idempotency-Key`. Dezelfde operatie, bestemming, sleutel en inhoud geven hetzelfde opgeslagen resultaat. Andere inhoud met dezelfde sleutel levert `IDEMPOTENCY_CONFLICT`. Een nieuwe credential voor dezelfde bestemming gebruikt dezelfde resultaten. Een andere bestemming kan geen bestaande artikelen of media lezen of wijzigen.

Bij `PUT` is `baseRevision: null` verplicht voor aanmaak en de actuele revisie voor wijziging. Een lokale redactiebewerking verandert de revisie en beschermt het concept met `REVISION_CONFLICT`. Een gepubliceerd artikel blijft zijn live revisie tonen totdat een volgende revisie expliciet is gepubliceerd. Publicatie gebruikt de bestaande blogservice, cache-invalidationqueue, sitemap en slugredirects. Gewone tekstwijzigingen behouden de slug; een expliciete gepubliceerde slugwijziging gebruikt de bestaande permanente redirect.

De adapter converteert Markdown via de bestaande editorconversie en sanering. DartFlow ondersteunt `blog` en `article`, talen `nl-NL`, `en-GB` en `en-US`, bestaande auteurs en categorieën en SEO, tags, hero, alt-tekst en focuspunt. Ontbrekende auteur en categorie gebruiken `redactie` en `nieuws`. Voor publicatie zijn titel, inhoud, samenvatting, hero met alt-tekst en SEO-titel en -beschrijving verplicht. Upload eerst de hero via de media-route en gebruik de teruggegeven `assetId`. De server decodeert het bestand, controleert MIME, formaat, bytegrootte en afmetingen en bewaart ongepubliceerde afbeeldingen privé. Capabilities meldt de actuele MIME-types en maximale grootte.

## Hergebruik bij een volgende Next.js-site

`lib/socialhero-core.ts` is de zelfstandige kern zonder router-, database- of editorafhankelijkheden. Deze bevat contractvalidatie, gecontroleerde providerfouten, vastgepinde claim-/verify-paden, gebonden versleuteling en de HTTP-client zonder redirects. Deze module kan rechtstreeks naar een andere workspace worden meegenomen; deze repo heeft geen bestaand privaat pakket voor een gedeelde publicatieconnector.

`lib/socialhero-connection.ts` koppelt die kern aan het lokale rechtenmodel, transacties, serverconfiguratie en credentialopslag. Neem de state machine en provisioningvolgorde over, maar vul voor een volgende site de lokale beheerdercontrole, transactionele opslag en credentiallookup in. Gebruik een eigen private tabel of de server-API van het bestaande CMS. Maak credentials nooit leesbaar voor de browser of publieke database-rollen.

`lib/socialhero-api.ts` vertaalt de versie-1-interface naar DartFlows bestaande `blog-store` en `blog-media`. Vervang bij de volgende site deze dunne adapter door de servicefuncties die de lokale editor al gebruikt. Onderstaand voorbeeld toont de vertaalslag voor opslaan binnen DartFlow; het is geen tweede schrijfpad:

```ts
import {validateSocialHeroPost} from './socialhero-core';
import {writeBlogDraft,type BlogCredential} from './blog-store';

async function saveRemoteDraft(
  credential: BlogCredential,
  externalId: string,
  body: unknown,
  idempotencyKey: string,
) {
  const {baseRevision,data} = validateSocialHeroPost(body);
  return writeBlogDraft({credential}, {
    externalId,
    expectedRevision: baseRevision === null ? undefined : baseRevision,
    data,
    requestId: idempotencyKey,
  });
}
```

De volgende adapter vult de auteurs/categorieën/talen, verplichte publicatievelden, slug- en canonicalregels, contentconversie, echte mediaopslag en validatie, private preview, revisieconflicten, publicatiehooks en cacheverversing in. Bewaar externe mapping en idempotentieresultaten transactioneel binnen site, omgeving en stabiele `destinationId`. Het rechtenplafond blijft een servercontrole binnen elke schrijftransactie. De route moet de lokale service-uitkomst naar de contractvorm met `postId`, `state`, revisies en nullable URL-/datumvelden vertalen.

Neem de bestaande App Router-wrapper in `app/api/[...path]/route.ts`, de integratie in `lib/blog-api.ts` en de beheer-UI als voorbeeld; sluit authenticatie en bescherming tegen verzoekvervalsing aan op die van de nieuwe website. Pas daar de lokale documentatie uit `node_modules/next/dist/docs/` toe voordat routes worden aangepast.

## Verificatie op 26 november 2026

`tests/socialhero-connector.test.ts` slaagde lokaal met 11 tests, zonder overgeslagen tests. De suite gebruikt de echte lokale database en beelddecoder, met een gemockte SocialHero-server voor claim en verificatie. De tests controleren voorlopige en actieve capabilities, verloren claimrespons, afgebroken verificatie, verlopen/verkeerd gebonden codes, herhaald opslaan zonder dubbel concept, revisieconflicten door de lokale editor, bestemmingsisolatie, hergebruik na opnieuw koppelen, ingetrokken credentials, lokale publicatiebevoegdheid en het zichtbaar houden van een bestaande live revisie. `tests/native-deployer-test.py` controleert de serverallowlist en weigering van onveilige configuratie. Deze uitkomsten bewijzen geen live provisioning in SocialHero.

Een read-only HTTP-controle op de bestaande stagingomgeving gaf `200` voor `/api/health` en `/api/ready`, met database `ok`, Auth `reachable`, SHA `0a7d5d628d7ab56c5ac17a3bfc022a1e8e289277`, release `45672807175-1` en config `staging-2026-11-18-play-safety-1`. `/blog/beheer` stuurde de niet-ingelogde aanvraag naar de login; `/api/socialhero/v1/capabilities` weigerde die aanvraag met de bestaande `401 UNAUTHENTICATED`-respons.

De applicatie met de nieuwe connector is nog niet live uitgerold of gekoppeld. De stagingmigratie is via de bestaande Supabase-beheerverbinding toegepast: featureversie 1, beide nieuwe tabellen met RLS en runtime-toegang, nul grants voor publieke rollen en alle zeven bestaande blogartikelen behouden. Daarvoor is de bestaande stagingbackup uitgevoerd met geverifieerde readback onder `/var/backups/dartflow/identity-staging-20261126T111925298Z`; dit is geen nieuwe herstelproef. De claimroute op `https://socialhero.dgwebservices.nl` is read-only benaderd met GET en gaf `405`, passend bij het POST-contract; dit bewijst geen geslaagde claim. Hostbeheer via SSH is gecontroleerd en beschikbaar. Voor live acceptatie ontbreken een verse eenmalige code voor deze stagingbestemming en een ingelogde beheerderssessie in de website, plus installatie van de bronversie en nieuwe runtimebundel. Er is geen live concept of testpublicatie aangemaakt.

Uitgevoerde lokale controles: `npx tsx --test --test-concurrency=1 tests/socialhero-connector.test.ts` (11 geslaagd), `npx tsc --noEmit` (geslaagd), `npx eslint tests/socialhero-connector.test.ts --max-warnings 0` (geslaagd) en `python3 -B tests/native-deployer-test.py` (74 geslaagd). Ook `npm run typecheck`, `npm run lint` en `npm run build` slagen. De zeven gerichte Playwright-tests in `blog.spec.ts`, `blog-conflicts.spec.ts` en `socialhero-connection.spec.ts` slagen tegen de lokale productiebuild.

De eerste integrale testuitvoering tegen de bestaande lokale ontwikkeldata had vier falende deeltests buiten de connector: drie in accountverwijdering en één in notificatiemail. Read-only diagnose vond twee oudere openstaande privacyjobs en 737 oudere mailjobs; de bestaande tests roepen een globale worker aan met batchgrootte 1 respectievelijk 10 en bereikten daardoor hun nieuwe fixture niet. De betreffende services en tests zijn niet gewijzigd voor deze connector. Een geïsoleerde herhaling van die twee bestanden slaagde met 42 tests. De volledige suite slaagt vervolgens op een nieuw aangemaakte lokale QA-database: **941 geslaagd, 0 mislukt, 0 overgeslagen**. De bestaande wachtrijen zijn niet gewist; alleen de tijdelijke QA-database is na de uitvoering verwijderd. De tijdelijke database gebruikte `jit=off` omdat de lokale uitgepakte PostgreSQL-installatie geen LLVM-runtime heeft. Ook `npm run test:prototype` slaagt.
