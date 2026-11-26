# SocialHero Blog API v1

Openbare afspraak tussen SocialHero en een ontvangende website. Gedeelde TypeScript-vormen staan in `lib/socialhero-contract.ts`: `SocialHeroPairingClaim`, `SocialHeroPostInput`, `SocialHeroPostStatus`, `SocialHeroCapabilities` en `SocialHeroErrorResponse`. De website vertaalt deze interface via haar bestaande blogservice. Site, omgeving, bestemming en rechten komen uitsluitend uit vertrouwde serverconfiguratie en de geauthenticeerde credential.

## Omgeving en lokale toestemming

De website gebruikt een stabiele `siteId`, haar canonieke HTTPS-origin, `environment: "staging" | "production"` en een vaste vertrouwde SocialHero-origin. Staging en productie hebben afzonderlijke verbindingen en credentials. Een code of artikelpayload kan deze configuratie niet vervangen.

Bij een nieuwe bestemming staan de twee zichtbare keuzes **concepten en afbeeldingen beheren** en **zelfstandig publiceren** aanvankelijk aan. De ingelogde bevoegde beheerder bevestigt beide booleans bij het koppelen en kan ze vooraf uitzetten. Publiceren vereist ook concepttoegang. Deze keuze wordt duurzaam per site, omgeving en stabiele bestemming opgeslagen. Een eerdere opt-out blijft bij opnieuw koppelen behouden; opnieuw koppelen kan rechten verder beperken, maar niet vanzelf opnieuw inschakelen. Opnieuw inschakelen gebeurt expliciet via **Toestemmingen opslaan**. Actuele lokale toestemming begrenst iedere serveractie, ook bij een oude token, een eerder opgehaalde capabilities-respons of een herhaald verzoek.

Externe scopes zijn `read`, `draft` en `publish`. `read` staat lezen toe; `draft` staat media en concepten toe; publiceren vereist `draft` én `publish`. De DartFlow-adapter vertaalt `draft` intern naar `media:write` en `drafts:write`. Een voorlopige credential heeft uitsluitend toegang tot capabilities, ongeacht de getoonde toekomstige scopes.

## Koppelen

1. SocialHero genereert voor een bevoegde beheerder een willekeurige eenmalige code, bewaart de hash en bindt deze aan project, site-origin en omgeving. Geldigheid: tien minuten; pogingen zijn begrensd.
2. De websiteserver maakt een willekeurige UUID `attemptId` en roept op de vaste SocialHero-server `POST /api/integrations/blog/v1/pairings/claim` aan:

   ```json
   {"code":"<one-time-code>","attemptId":"<server-uuid>","siteId":"dartflow","origin":"https://staging.dartflow.nl","environment":"staging","contractVersion":1}
   ```

   Succes retourneert uitsluitend server-to-server:

   ```json
   {"connectionId":"<new-connection-id>","destinationId":"<stable-destination-id>","accessToken":"<opaque-bearer>","expiresAt":"<ISO-8601-provisioning-deadline>"}
   ```

   De bearer bevat minstens 256 willekeurige bits. Iedere nieuwe provisioningpoging krijgt een nieuw `connectionId`. `destinationId` blijft gelijk voor hetzelfde project, dezelfde site en omgeving. Een identieke claim met dezelfde code, installatiegegevens en `attemptId` geeft binnen de provisioningtermijn hetzelfde antwoord. Andere claims kunnen de gereserveerde code niet gebruiken. De provisioningtermijn eindigt tien minuten na de claim.
3. De website bewaart eerst transactioneel bearerhash, bindingsgegevens, lokaal beleid en status `pending`. Alleen voor herstel mag zij tijdelijk een server-side versleutelde kopie van de bearer bewaren. Na commit roept zij `POST /api/integrations/blog/v1/pairings/{connectionId}/verify` aan met dezelfde bearer en JSON `{}`.
4. SocialHero vraagt met die bearer `GET /api/socialhero/v1/capabilities` op de website op en vergelijkt versie, verbinding, bestemming, site, origin en omgeving met de claim. Na controle antwoordt SocialHero `200 {"connectionId":"...","status":"verified"}`. Deze verificatie is veilig herhaalbaar.
5. Pas na die bevestiging activeert de website haar credential en verwijdert zij de tijdelijke versleutelde kopie. SocialHero controleert capabilities opnieuw en gebruikt de bestemming pas bij `credentialState: "active"`. Andere routes geven tijdens provisioning `409 PAIRING_IN_PROGRESS` met `Retry-After`; behandel dit als tijdelijk. Verlopen provisioning trekt de voorlopige credential in en verwijdert de tijdelijke kopie.

De vorige actieve credential wordt na een geslaagde vervanging specifiek ingetrokken. Bestemmingsmapping en idempotentieresultaten blijven behouden. Lokaal ontkoppelen blokkeert toegang meteen; provider-deactivatie blokkeert eerst eigen nieuwe/wachtende schrijfacties en trekt vervolgens de specifieke websitecredential in. `401` bij intrekking van een reeds ongeldige credential geldt als afgerond. Bloghistorie blijft bestaan.

## Website-API

Alle routes staan onder `/api/socialhero/v1` en vereisen `Authorization: Bearer <accessToken>`. Gebruik HTTPS. Zet codes en credentials nooit in URL's, browserresponsen, logs of analytics. Responses gebruiken `Cache-Control: private, no-store`; fouten bevatten een willekeurige `requestId`. DartFlow stuurt ook `X-Request-ID`.

| Methode en pad | Recht / invoer | Resultaat |
| --- | --- | --- |
| `GET /capabilities` | `read`; ook tijdens `pending` | `200 SocialHeroCapabilities`. |
| `POST /media` | `draft`; multipart met één `file`; `Idempotency-Key` | `201 { assetId, mimeType, width, height }`. |
| `PUT /posts/{externalId}` | `draft`; JSON `SocialHeroPostInput`; `Idempotency-Key` | `201` bij aanmaak, `200` bij wijziging; `SocialHeroPostStatus` en revisie-ETag. |
| `GET /posts/{externalId}` | `read` | `200 SocialHeroPostStatus`. |
| `POST /posts/{externalId}/publish` | `draft` en `publish`; JSON `{ revision }`; `Idempotency-Key` | `200` na openbare bevestiging, anders `202`, `state: "publishing"`, `publicUrl: null` en `Retry-After`. |
| `DELETE /connection` | `read`; geen body | `204`; trekt uitsluitend de geauthenticeerde credential in. Herhaling mag `401` opleveren. |

`externalId` is een stabiele opake artikel-ID binnen de bestemming. URL-encodeer deze als padsegment. Media en artikelen blijven gebonden aan site, omgeving en `destinationId`; een andere installatie krijgt geen toegang door hetzelfde artikel-ID of asset-ID te noemen.

Capabilities bevat:

```ts
{
  contractVersion: 1;
  connectionId: string;
  destinationId: string;
  credentialState: 'pending' | 'active';
  siteId: string; siteName: string; origin: string;
  environment: 'staging' | 'production'; blogPath: string;
  contentTypes: ('blog' | 'article')[]; locales: string[];
  scopes: ('read' | 'draft' | 'publish')[];
  authors: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  media: { mimeTypes: string[]; maxBytes: number };
}
```

Optioneel meldt de adapter extra mediagrenzen, ondersteunde velden en verplichte publicatievelden. Auteurs en categorieën komen uit dezelfde actuele records als de editor.

Verplichte velden bij een concept:

```ts
{
  baseRevision: number | null; // null uitsluitend bij aanmaak
  type: 'blog' | 'article'; locale: string; title: string;
  content: { format: 'markdown'; body: string };
  slug?: string; excerpt?: string;
  authorId?: string; categoryId?: string; tags?: string[];
  seo?: { title?: string; description?: string };
  hero?: { assetId: string; alt: string; focalPoint?: { x: number; y: number } };
  ogImageAssetId?: string;
}
```

Hero vereist een door de website uitgegeven `assetId` en niet-lege alt-tekst; focuscoördinaten liggen tussen 0 en 1. De adapter valideert Markdown via de editor, veilige links, werkelijke afbeeldingsinhoud, formaat, bytes en afmetingen. Een onbekende/inactieve auteur of categorie wordt geweigerd. Gebruik capabilities voor ondersteunde types/talen en aanvullende verplichte publicatievelden. De website bepaalt de geldige slug en canonieke URL; tekstwijzigingen behouden een bestaande slug. Een expliciete gepubliceerde slugwijziging gebruikt een permanente redirect.

`SocialHeroPostStatus` heeft deze vorm; optionele ontbrekende waarden zijn `null`:

```ts
{
  postId: string; externalId: string; slug: string;
  state: 'draft' | 'publishing' | 'published';
  revision: number;
  draftRevision: number | null;
  publishedRevision: number | null;
  previewUrl: string | null;
  publicUrl: string | null;
  publishedAt: string | null;
}
```

Een wijziging vereist de actuele `revision` als `baseRevision`. Lokale redactiewijzigingen tellen mee. Een verouderde revisie geeft `REVISION_CONFLICT`; ontbreken van het artikel staat alleen aanmaak met `baseRevision: null` toe. Een live artikel kan daarnaast een conceptrevisie hebben. Publiceren kiest exact de opgegeven conceptrevisie; opslaan van een nieuw concept vervangt de bestaande openbare revisie niet.

## Herhalen en openbare bevestiging

Media, concepten en publiceren vereisen een `Idempotency-Key`. Bewaar operatie, sleutel, inhoudsfingerprint en logisch resultaat duurzaam en uniek binnen site, omgeving en stabiele bestemming. Identieke retries geven hetzelfde resultaat; gewijzigde inhoud met dezelfde sleutel geeft `409 IDEMPOTENCY_CONFLICT`. Gebruik een eigen sleutel per bestand en per goedgekeurde publicatierevisie. De bevestigingsstatus kan bij een retry van `publishing` naar `published` voortgaan; de gekozen revisie wordt daarbij niet opnieuw gepubliceerd. Bij een mogelijk uitgevoerde schrijfopdracht eerst de leesroute raadplegen; opnieuw koppelen wist eerdere resultaten niet.

DartFlow schrijft bij publicatie een duurzame controle voor de specifieke revisie. Dezelfde server-renderer zet een opake `dartflow:publication`-marker in de openbare HTML. De server doet een begrensde, niet-geauthenticeerde GET op de eigen canonieke artikel-URL, zonder redirects, en bevestigt uitsluitend de verwachte marker. Opslag of cacheverversing alleen is geen bewijs. Bij tijdelijke onzichtbaarheid blijft `publishing` gelden en herhaalt de bestaande worker de read-only controle; deze retry voert geen nieuwe publicatieschrijfactie uit. Een vervangen of gearchiveerde revisie kan niet later alsnog bevestigd worden.

## Fouten en netwerkgrenzen

Foutvorm: `{ code: string, message: string, requestId: string }`. `message` is gecontroleerd en bevat geen ruwe providerfout, code of credential.

| Code | HTTP |
| --- | --- |
| `INVALID_PAIRING_CODE` | 400 |
| `INVALID_CREDENTIAL` | 401 |
| `PERMISSION_DENIED` | 403 |
| `POST_NOT_FOUND` | 404 |
| `DESTINATION_MISMATCH`, `PAIRING_IN_PROGRESS`, `SLUG_CONFLICT`, `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT` | 409 |
| `PAIRING_EXPIRED` | 410 |
| `PAYLOAD_TOO_LARGE` | 413 |
| `VALIDATION_ERROR`, `INVALID_MEDIA` | 422; verkeerd content-type kan 415 geven |
| `RATE_LIMITED` | 429, indien beschikbaar met `Retry-After` |
| `CONFIGURATION_REQUIRED`, `PROVIDER_UNAVAILABLE`, `TEMPORARILY_UNAVAILABLE` | 503 |

De ontvanger gebruikt uitsluitend de vaste SocialHero-origin en vaste claim-/verify-paden, met time-out, begrensde respons en uitgeschakelde redirects. SocialHero moet uitgaande websiteverzoeken beperken tot de geregistreerde HTTPS-origin en vaste API-paden, DNS-resolutie én daadwerkelijke bestemming controleren tegen private/lokale/link-local/metadata-adressen en redirects weigeren. Geen van beide partijen laat jobs automatisch naar een andere site of omgeving wisselen.
