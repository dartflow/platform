# Blogbeheer en SocialHero Connector

DartFlow gebruikt één blogservice voor de handmatige editor en SocialHero. De primaire beheerroute is `/app/platform/integraties` → **SocialHero beheren** → `/blog/beheer#studio-socialhero-mount`. Een platformbeheerder met rol `owner` of `admin` kan Blogbeheer ook rechtstreeks openen via `/blog/beheer` of `/app/blog`. De openbare pagina’s staan op `/blog` en `/blog/{slug}`. Het gedeelde externe contract staat in [`contracts/socialhero-blog-v1.md`](../contracts/socialhero-blog-v1.md).

## Eerste artikel handmatig maken

1. Kies **Nieuw artikel**. Vul titel, samenvatting, slug, type, taal, auteur, categorie en eventuele tags in. De titel vormt de enige H1; de editor gebruikt H2, H3 en H4 voor tussenkoppen. Nederlands, Brits Engels en Amerikaans Engels zijn beschikbaar.
2. Schrijf de inhoud in de bestaande Tiptap-editor. Deze ondersteunt tekstmarkeringen, veilige links, lijsten en taken, citaten, code, tabellen, uitgelichte tips, scheidingslijnen, uitlijning en inline afbeeldingen. Editor en Markdown-import gebruiken dezelfde gevalideerde inhoudsstructuur en openbare renderer.
3. Upload bij **Beeld** een hero, geef beschrijvende alt-tekst en kies verhouding en focuspunt. Ondersteund: `2:3`, `3:4`, `4:5`, `9:16`, `1:1` en `16:9`. Een apart deelbeeld is optioneel; anders maakt de server een deelbeeld van 1200 × 630 uit de hero en het focuspunt.
4. Vul bij **SEO** de zoektitel en metaomschrijving in. De preview en tekenrichtlijnen helpen de redactie; de server controleert de verplichte velden. Voor publicatie zijn titel, niet-lege inhoud, samenvatting, hero met alt-tekst en SEO-titel en -beschrijving vereist.
5. Kies **Opslaan** en controleer de afgeschermde preview. Een concept en zijn media zijn niet openbaar en verschijnen niet in het blogoverzicht, op de homepage of in de sitemap.
6. Kies **Publiceren**, vervolgens **Nu publiceren** of een toekomstig moment via **Inplannen**. Datums worden in Nederlandse tijd getoond. Een gewone tekstwijziging bewaart de slug; een expliciete gepubliceerde slugwijziging maakt via de bestaande routeopslag een permanente redirect van de oude URL.
7. Bewerkingen aan een live artikel worden nieuwe conceptrevisies. De bestaande openbare versie blijft staan tot een gekozen revisie wordt gepubliceerd. Revisiegeschiedenis kan een eerdere versie als nieuw concept terugzetten. Een gelijktijdige redactiewijziging levert een conflict op en bewaart de ingevoerde tekst.

Het beheer toont status, categorie en auteur en ondersteunt zoeken en filters voor status, categorie en auteur. Het openbare overzicht biedt zoeken, categorieën en paginering. Openbare artikelen leveren hun inhoud server-side, met canonical, Open Graph, X-kaart en Article/BlogPosting- en Breadcrumb-JSON-LD. Staging blijft uitgesloten van indexering; de productiesitemap bevat uitsluitend actuele openbare artikelen waarvoor indexering is toegestaan.

## Auteurs en categorieën

Open **Auteurs en categorieën beheren** boven de editor. Voeg een vermelding toe met een vaste ID en een zichtbare naam. De ID gebruikt maximaal 100 kleine letters, cijfers en streepjes en verandert niet bij hernoemen. De editor en capabilities gebruiken dezelfde actuele records.

**Bewerken** wijzigt de naam met revisiecontrole. **Archiveren** verwijdert de keuze uit nieuwe artikelen, maar bewaart de naam bij bestaande verwijzingen; **Herstellen** maakt deze weer beschikbaar. De standaardauteur `redactie` en standaardcategorie `nieuws` blijven beschikbaar. Een artikel met een inmiddels gearchiveerde keuze moet voor een nieuwe opslag/publicatie een actieve keuze krijgen.

Een taxonomiewijziging herlaadt de editor niet. Sla eerst een eventueel openstaand artikel op en herlaad daarna de pagina om de keuzelijsten te verversen. De server maakt geen tweede artikel of inhoudsrevisie om alleen een naam te wijzigen en zet de normale cache-invalidation voor betrokken live artikelen klaar.

De beheer-API is `GET /api/blog/taxonomy` en `POST /api/blog/taxonomy`, met de bestaande beheerderssessie en bescherming tegen verzoekvervalsing. POST gebruikt `{ action, kind, id, name?, expectedRevision, requestId }`: `action` is `save`, `archive` of `restore`, `kind` is `author` of `category`, en `expectedRevision` is `0` bij aanmaak of de actuele revisie bij wijziging. Een herhaalde sleutel met dezelfde inhoud geeft hetzelfde opgeslagen resultaat.

## SocialHero koppelen en toestemmingen kiezen

Het paneel **SocialHero** staat onder de paginatitel van Blogbeheer. De beheerder ziet website-origin, omgeving, koppelstatus, laatste controle en effectieve toegang. Maak in SocialHero bij de blogbestemming voor exact deze website en omgeving een eenmalige code en plak die hier. De code is tien minuten geldig.

Bij een nieuwe bestemming staan twee zichtbare keuzes aanvankelijk aan:

- **SocialHero mag concepten en afbeeldingen aanmaken en bijwerken.**
- **SocialHero mag artikelen zelfstandig live zetten volgens de campagneplanning en de ingestelde goedkeuringsmodus.**

De beheerder kan deze keuzes vóór het koppelen wijzigen en bevestigt beide booleans met **Koppelen**. Zelfstandig publiceren vereist ook concepttoegang; concepttoegang uitzetten schakelt in de interface ook publiceren uit. Er is geen actieve toegang zolang verificatie nog loopt.

De keuze wordt duurzaam per site, omgeving en stabiele SocialHero-bestemming opgeslagen. Eerder uitgezette rechten blijven uit bij opnieuw koppelen. Een nieuwe code of een aangevinkt standaardvakje kan die opt-out niet opheffen. Om rechten bewust weer in te schakelen, zet de gewenste keuzes aan en kies expliciet **Toestemmingen opslaan**. Minder rechten kiezen bij opnieuw koppelen beperkt de bestaande bestemming wel meteen. De server controleert de actuele toestemming bij iedere schrijfopdracht, ook bij retries en bestaande credentials.

**Verbinding controleren** hervat een onderbroken verificatie en werkt de controlefeedback bij. Is de claimrespons verloren, plak dan dezelfde code opnieuw; de server hergebruikt de bestaande poging. Een verlopen of definitief afgewezen installatie vraagt een nieuwe code. De vorige verbinding blijft tijdens een vervangende installatie actief tot de nieuwe verificatie slaagt. **Ontkoppelen** trekt lokale toegang direct in en bewaart artikelen, revisies, bestemmingsmapping en eerdere idempotentieresultaten.

## Een herkenbaar concept vanuit SocialHero testen

1. Gebruik DartFlow staging: site-ID `dartflow`, origin `https://staging.dartflow.nl` en omgeving `staging`. Controleer de getoonde toestemmingen en voltooi de koppeling met een verse code. De server gebruikt voor SocialHero de vaste origin `https://socialhero.dgwebservices.nl`.
2. Laat SocialHero capabilities ophalen nadat de credential `active` is. Gebruik uitsluitend de gemelde talen, types, actieve auteur-/categorie-ID’s en mediagrenzen. Voor een eenvoudige aanmaak zijn titel, type, taal, Markdown-inhoud en `baseRevision: null` vereist; `redactie` en `nieuws` zijn de bestaande defaults voor ontbrekende auteur en categorie.
3. Maak een herkenbaar concept, bijvoorbeeld **SocialHero stagingtest · 2026-11-26**, met een stabiele eigen `externalId` en een nieuwe `Idempotency-Key`. `PUT` maakt altijd een concept; publicatie is een aparte opdracht, ook wanneer publicatietoestemming aanstaat.
4. Zoek het concept in Blogbeheer en controleer inhoud en private preview. Herhaal exact hetzelfde verzoek met dezelfde sleutel: er hoort geen dubbel artikel te ontstaan. Werk dezelfde `externalId` bij met de teruggegeven actuele `revision` als `baseRevision` en een nieuwe sleutel.
5. Controleer een lokale redactiebewerking en daarna een externe update met een verouderde revisie: deze moet `REVISION_CONFLICT` geven. Gebruik na een onzekere schrijfactie eerst `GET /posts/{externalId}` om de actuele bronstatus te lezen.
6. Test publiceren alleen met een aangewezen stagingartikel, complete publicatievelden en daadwerkelijk opgeslagen toestemming voor concepten én publiceren. Een eerdere opt-out kan alleen via **Toestemmingen opslaan** bewust worden opgeheven. Upload eerst benodigde media en publiceer exact de goedgekeurde revisie met een eigen sleutel.

## Publicatie is pas bevestigd na openbare controle

SocialHero publiceert via `POST /api/socialhero/v1/posts/{externalId}/publish` met `{ revision }`. De bestaande blogtransactie en publicatiehooks voeren de gekozen revisie uit. Daarbij wordt een duurzame controle voor die specifieke revisie vastgelegd. De openbare server-renderer geeft een opake `dartflow:publication`-marker mee; de server controleert die met een begrensde, niet-geauthenticeerde GET op de eigen canonieke artikel-URL, zonder redirects.

Zolang de verwachte versie niet openbaar is bevestigd, retourneert de connector **202**, `state: "publishing"`, `publicUrl: null` en `Retry-After`. De leesroute blijft dezelfde wachtstatus tonen. Na bevestiging geeft de API `published` en de absolute canonieke URL terug. Een geslaagde opslag of cacheverversing wordt niet als voldoende bewijs behandeld.

De bestaande worker herhaalt tijdelijke zichtbaarheidcontroles duurzaam en read-only, ook zonder bezoek aan Blogbeheer. Hij publiceert de inhoud niet opnieuw. Een vervangen of gearchiveerde revisie kan niet alsnog als actueel bevestigd worden.

Een niet-bevestigde of tijdelijk mislukte publicatie is terug te vinden via het beheerfilter **Publicatie controleren**. De badge en de artikelzijbalk tonen begrijpelijke feedback, de laatste controletijd en dat automatisch opnieuw wordt geprobeerd. **Publicatiestatus vernieuwen** haalt de actuele status op en bewaart de ingevoerde tekst en revisie. De interface toont geen ruwe foutcode en noemt deze publicatie pas bevestigd nadat de controle is geslaagd.

## Serverconfiguratie en installatie

| Instelling | Betekenis |
| --- | --- |
| `DARTFLOW_APP_ORIGIN` | Bestaande canonieke website-origin uit de publieke deploymentconfiguratie: staging `https://staging.dartflow.nl`, productie `https://dartflow.nl`. |
| `DARTFLOW_SOCIALHERO_ORIGIN` | Verplichte vaste vertrouwde HTTPS-origin van SocialHero voor deze omgeving. Geen afsluitende slash, credentials, pad, query of fragment; een code bepaalt deze URL nooit. |
| `DARTFLOW_SOCIALHERO_SITE_ID` | Stabiele installatie-ID, standaard `dartflow`. Deze bepaalt ook de blogopslag: behoud `dartflow` op DartFlow en behoud de gekozen ID bij herdeployen en opnieuw koppelen. |
| `DARTFLOW_ENV` | Expliciet `staging` of `production` voor koppelen. Claims, credentials, beleid en artikelen blijven aan deze omgeving gebonden. |
| `DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY` | Bestaande eigen 32-byte sleutel per omgeving in canonieke Base64; voor de tijdelijke versleutelde provisioningcredential. |

Voor staging is de opgegeven provider `https://socialhero.dgwebservices.nl`. Bevestig voor productie afzonderlijk welke SocialHero-omgeving daarvoor bedoeld is. Er is geen OpenAI- of andere AI-provider-API-key nodig.

1. Pas via het bestaande afzonderlijke databasebeheerpad deze migraties in volgorde toe:

   - `supabase/migrations/20261126000000_socialhero_connector.sql`: provisioning, credentialbinding, bestemmingsmapping en idempotentiesleutels.
   - `supabase/migrations/20261126010000_socialhero_permissions.sql`: duurzaam bestemmingsbeleid en gebeurtenissen voor toestemmingskeuzes; bestaande opt-outs blijven behouden.
   - `supabase/migrations/20261126020000_blog_taxonomy.sql`: auteurs en categorieën, inclusief de bestaande standaardrecords.
   - `supabase/migrations/20261126030000_blog_publication_checks.sql`: duurzame openbare revisiecontroles.

2. Lokaal gebruikt dit project `npm run db:migrate` met uitsluitend de loopbackconfiguratie. De native deploybroker migreert de database niet. Bestaande artikelen, revisies, handmatige blogtokens en resultaten blijven behouden; de eerste migratie vervangt unieke sleutels door bestemmingsgebonden sleutels en bewaart bestaande records in de ongebonden bestemming.
3. Maak een **nieuwe immutable** runtimebundel met de SocialHero-origin en eventueel de site-ID, volgens `ops/runtime.env.example` en de omgevingsvoorbeelden. Houd staging en productie gescheiden. De broker accepteert deze velden uitsluitend in de serverallowlist en weigert ze in `public.json` of `NEXT_PUBLIC_*`. Een gewijzigde root-owned helper wordt via het bestaande gereviewde hostbeheer geïnstalleerd.
4. Volg `docs/deployment.md`: commit/push → geslaagde CI voor de volledige SHA → normale stagingdeploy met de juiste bundel → functionele acceptatie. De bestaande onderhoudsroute `/api/mail/process` verzorgt ook het opruimen van verlopen provisioning, blogpublicatieplanning, cache-invalidation en herhaling van openbare controles.
5. Koppel vervolgens via de websitebeheerder en voer de stagingconcept- en eventuele aangewezen publicatietest uit. Geef codes en bearers nooit door in browserresponsen, URL’s, serverlogs of analytics; beheer- en machine-antwoorden gebruiken `Cache-Control: no-store`.

## Modules en adapter voor een volgende website

| Bestand / groep | Verantwoordelijkheid |
| --- | --- |
| `lib/socialhero-contract.ts`, `contracts/socialhero-blog-v1.md` | Gedeelde request-/responsevormen en openbare versie-1-afspraken. |
| `lib/socialhero-core.ts` | Zelfstandige contractvalidatie, gecontroleerde providerfouten, vastgepinde claim-/verify-paden, begrensde HTTP-client zonder redirects en gebonden versleuteling. |
| `lib/socialhero-connection.ts` | Lokale beheerdercontrole, provisioning, herstel, credentialhash en duurzaam bestemmingsbeleid. |
| `lib/socialhero-api.ts`, `lib/blog-api.ts`, `app/api/[...path]/route.ts` | Machine-interface en aansluiting op de bestaande beheerroutes en onderhoudsworker. |
| `lib/blog-store.ts`, `lib/blog-media.ts`, `lib/blog-content.ts` | Gedeelde editor-/connectorservice, revisies, private media, contentconversie, publiceren en normale hooks. |
| `lib/blog-taxonomy.ts`, `lib/blog-taxonomy-api.ts` | Bewerkbare auteurs/categorieën en hun gedeelde validatie. |
| `lib/socialhero-publication.ts`, `lib/blog-publication-marker.ts` | Duurzame verificatie van de openbare revisie. |
| `components/socialhero-connection.tsx`, `components/blog-taxonomy-settings.tsx`, `components/blog-workspace.tsx` | Koppel- en toestemmingsinterface en beheer van auteurs/categorieën. |
| `components/blog-editor-runtime.js`, `components/blog-studio-markup.ts`, `lib/blog-admin-api.ts` | Bestaande editor, filters, revisie-/publicatieacties en begrijpelijke controlefeedback. |
| `components/blog-public.tsx`, `components/blog-data.ts`, `app/blog/page.tsx` | Openbare SSR, metadata, revisiemarker, categorieën/zoeken en paginering. |
| `supabase/migrations/202611260*.sql`, configuratievoorbeelden en `infra/staging/deploy-helper.py` | Private opslag, rechten en het bestaande native deploymenttraject. |

Er is geen bestaand privaat connectorpakket in deze workspace. Neem voor een volgende Next.js-site de gedeelde contracttypes en `socialhero-core` over. Verbind de state machine met de lokale beheerdersrechten, transacties, private credentialopslag en serverconfiguratie. Houd de blogadapter dun en gebruik dezelfde service als de lokale editor, of de ondersteunde server-API van een bestaand CMS.

Dit voorbeeld toont de daadwerkelijke DartFlow-vertaalslag voor conceptopslag met het gedeelde invoertype:

```ts
import type {SocialHeroPostInput} from './socialhero-contract';
import {validateSocialHeroPost} from './socialhero-core';
import {writeBlogDraft,type BlogCredential} from './blog-store';
import {socialHeroPublicationPending} from './socialhero-publication';

async function saveRemoteDraft(
  credential: BlogCredential,
  externalId: string,
  body: SocialHeroPostInput,
  idempotencyKey: string,
) {
  const {baseRevision,data} = validateSocialHeroPost(body);
  const saved = await writeBlogDraft({credential}, {
    externalId,
    expectedRevision: baseRevision === null ? undefined : baseRevision,
    data,
    requestId: idempotencyKey,
  });
  const status = saved.contractStatus;
  if (!status) throw new Error('Deze adapter vereist een gekoppelde credential.');
  const pending = await socialHeroPublicationPending(
    credential, saved.id, status.publishedRevision,
  );
  return pending ? {...status,state:'publishing',publicUrl:null} : status;
}
```

De nieuwe site vult zelf auteur-/categorie-ID’s, talen, verplichte velden, contentconversie, echte mediavalidatie/-opslag, private preview, revisieconflicten, canonical/slugredirects, cacheverversing en publicatiehooks in. De uitvoer volgt `SocialHeroPostStatus`. Mapping en idempotentieresultaten blijven transactioneel gebonden aan site, omgeving en stabiele `destinationId`. Rechten worden in iedere schrijftransactie opnieuw gecontroleerd. Neem ook de openbare bevestiging over met een marker die de eigen server-renderer voor de specifieke revisie uitgeeft. Lees vóór routeraanpassingen de relevante lokale Next.js-gidsen in `node_modules/next/dist/docs/`.

## Verificatie en actuele live status · 26 november 2026

De finale uitbreiding slaagde met **969 applicatie-/databasetests**, nul fouten en nul skips, op een nieuwe geïsoleerde loopbackdatabase. Ook typecheck, lint, de definitieve productiebuild, negen gerichte browsertests en een aanvullende controle van de revisiemarker in de echte server-rendered artikelpagina slaagden. De logs staan lokaal onder `.local/socialhero-20261126/`. De QA-database is na afloop verwijderd; bestaande ontwikkelwachtrijen zijn behouden. De lokale PostgreSQL-installatie gebruikt voor deze tijdelijke database `jit=off` vanwege de ontbrekende LLVM-runtime.

De bronwijziging is samengevoegd via [PR #37](https://github.com/dartflow/platform/pull/37), broncommit `62726910972df02186e5fd3bbfd2d6f67348abd8`, hoofdbranchcommit `d3ab020b225530e95f6101623e233591aa1dd472`. De [CI voor deze exacte hoofdbranchversie](https://github.com/dartflow/platform/actions/runs/45842607259) is geslaagd, inclusief alle **159 browsertests**, vijf afzonderlijke Feed-/chatscenario’s en 74 deploytests. De [staginguitrol](https://github.com/dartflow/platform/actions/runs/45845688188) is geslaagd.

Op staging zijn **alle vier migraties toegepast**. Connector, toestemming, taxonomie en openbare controles hebben elk featureversie 1. Alle zeven bestaande blogartikelen zijn behouden. De vier nieuwe tabellen uit de vervolgmigraties hebben RLS en runtime-SELECT/INSERT; er zijn nul grants voor publieke rollen. De voorafgaande consistente backup is met readback gecontroleerd: `/var/backups/dartflow/identity-staging-20261126T131723773Z/application.json.gz`, SHA-256 `a48588f64985015091c7c27a66e10f83dc34524aa0171416f8622b3e56592160`. Dit is geen herstelproef.

Staging draait op SHA `d3ab020b225530e95f6101623e233591aa1dd472`, release `45845688188-1` en immutable configuratie `staging-2026-11-26-socialhero-1`. Health en readiness geven `200`, database `ok` en Auth `reachable`. Een bestaand gepubliceerd stagingtestartikel gaf de exacte verwachte revisiemarker, één H1, zes H2-koppen, de stagingcanonical, noindex, absolute Open Graph-afbeelding met afmetingen, X-kaart, BlogPosting-gegevens met auteur/datums en hero met alt/focuspunt. Het overzicht werkt en de stagingsitemap bevat geen publieke URL’s. Blogbeheer vraagt aanmelding; onbevoegde toegang tot connector en taxonomie geeft `401` met gecontroleerde fouten en no-store. Overzicht en detail zijn ook in een echte browser gecontroleerd op 390 en 1440 pixels: beide geven 200, één H1 en geen horizontale overflow. Productie is niet uitgerold.

Live pairing met `https://socialhero.dgwebservices.nl` is afzonderlijk van de geautomatiseerde tests. Die tests gebruiken echte PostgreSQL- en mediavalidatie met een testadapter voor providerrequests en gecontroleerde zichtbaarheidresponsen. Live pairing vereist een verse eenmalige code voor DartFlow staging en de ingelogde websitebeheerder. De gebruiker heeft gekozen om de echte koppelproef later uit te voeren. Er is in deze taak geen live koppeling, nieuw SocialHero-concept of nieuwe testpublicatie aangemaakt. Voer de code uitsluitend in de beheerwizard in.

De live claimroute is zonder koppelcode of credential gecontroleerd met een leeg JSON-object: `400 INVALID_PAIRING_CODE`. Dit is alleen protocolvalidatie en heeft geen koppeling aangemaakt. De nieuwere SocialHero-bron (`384db28a806911c6158bf40f813c88acb8d5c043`) bevat v1-pairing, de juiste veldnamen en standaard automatisch publiceren. De daar bekeken activatiecontrole vereist nog `read` én `draft`, terwijl DartFlow ook een actieve verbinding met uitsluitend `read` toestaat. De variant met beide schrijfrechten uit vraagt daarom afstemming aan de SocialHero-kant; die variant is niet live geverifieerd. De werkelijk uitgerolde SocialHero-SHA is niet vastgesteld.
