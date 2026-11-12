# Verenigingen in v17

De bestaande DartFlow-accounts en servergevalideerde Supabase-sessies blijven de identiteit voor alle verenigingsacties. Deze uitbreiding gebruikt de private PostgreSQL-tabellen en de bestaande appmail-outbox. Prototype-identiteitsheaders en demo-identiteiten verlenen geen rechten.

## Schermen en acties

Open een vereniging via **Verenigingen**. Het clubdossier biedt Overzicht, Leden en — afhankelijk van de actuele rechten — Aanvragen, Rollen en Instellingen. De clubkleuren gelden alleen binnen dit dossier. Het globale accountmenu blijft herkenbaar.

De eigenaar kan aangepaste rollen maken en deze aan actieve leden koppelen. De beschikbare grants zijn `members.invite`, `members.approve`, `chat.moderate`, `competitions.manage`, `tournaments.manage` en `settings.edit`. Alleen de eigenaar kan rollen maken, wijzigen, verwijderen en toewijzen of het eigendom overdragen. De basisrol Clubbeheerder heeft de zes inhoudelijke grants, maar krijgt daarmee geen eigenaarsbevoegdheden. Een clubrol verleent geen locatie- of fysiek baanbeheer en geen platformbeheer.

Bij overdracht wordt een ander actief lid eigenaar en wordt de vorige eigenaar gewoon lid. De server vergrendelt de club vóór de rolwijzigingen. Een unieke index en uitgestelde databaseconstraints bewaken dat de eigenaar-ID bij precies één actief eigenaarlid hoort. De eigenaar kan niet via de gewone vertrekactie verdwijnen.

## Aanmelden en intake

| Beleid | Gedrag |
| --- | --- |
| Open | Direct lid, binnen de actuele capaciteit. |
| Alleen op uitnodiging | Alleen de concrete ontvanger van een geldige persoonlijke uitnodiging kan accepteren. Een algemene clubcode geeft geen lidmaatschap. |
| Gesloten | Nieuwe aanvragen en uitnodigingen worden geweigerd; ook een oudere uitnodiging kan niet worden geaccepteerd zolang de club gesloten is. |
| Aanvraag met of zonder intake | Er ontstaat één lopende aanvraag per speler/club. Een bevoegde beoordelaar beslist. Zonder vragen blijft dezelfde gecontroleerde aanvraagflow beschikbaar. |

Een instellingenbeheerder kan een toelichting, maximaal twaalf vragen, tekstvelden, motivatievelden en keuzelijsten instellen. De server controleert type, lengte, verplichte velden en exacte keuzewaarden. Een gewijzigd formulier krijgt een nieuwe versie. Een eerder geopend formulier met een oude versie geeft een herstelbare melding; de speler vernieuwt het formulier en verstuurt opnieuw.

Iedere ingediende aanvraag bewaart de vraag-ID's, vraaglabels, typen, verplichtheid en antwoorden van die versie. Latere formulierwijzigingen veranderen de ingediende momentopname niet. De antwoordkolommen zijn niet wijzigbaar door de runtime; een databaseguard voorkomt ook onbedoelde wijziging van de opgeslagen momentopname. Alleen de aanvrager en actuele bevoegde beoordelaars ontvangen deze gegevens in de serverprojectie. Andere leden en andere verenigingen ontvangen ze niet.

De eerste geldige beoordeling wint. Twee beoordelaars worden geserialiseerd door de clublock; de tweede krijgt het reeds verwerkte besluit met de actuele projectie. Acceptatie controleert opnieuw bestaande deelname en capaciteit en schrijft lidmaatschap, besluit en mailgebeurtenis in dezelfde transactie. Een eventuele beslisreden gaat naar de aanvrager; een lege reden toont geen leeg redenblok.

Clubprojecties herlezen de actuele eigenaar en leden onder een gedeelde clublock. De lock loopt door tot na de private projectie. Een gecachte eigenaarsrij of ingetrokken rol kan zo niet met nieuwere intakegegevens worden gecombineerd. Een herhaalde actieprojectie wordt opnieuw geautoriseerd en opgebouwd; de oude receipt met privégegevens wordt niet teruggestuurd.

## Mail

| Gebeurtenis | Ontvangers | Stabiele deduplicatiesleutel |
| --- | --- | --- |
| Geldige aanvraag | Aanvrager: `club-request-received` | Aanvraag-ID + type + ontvanger. |
| Geldige aanvraag | Actieve leden die op dat moment `members.approve` hebben: `club-request` | Aanvraag-ID + type + ontvanger. |
| Besluit of directe toetreding | Betrokken speler: `club-decision` | Definitieve aanvraagtransitie + ontvanger. |
| Persoonlijke uitnodiging | Alleen de doelspeler: `club-invite` | Uitnodigings-ID + ontvanger. |

Deze zijn echte records in dezelfde duurzame outbox als de overige appmails. Het bestaande Resend HTTP-transport, de claims, leases en provider-idempotencykey blijven van toepassing. Voor verzending van een reviewermelding controleert de worker opnieuw de actuele actieve clubrechten en de nog lopende aanvraag. Een ingetrokken rol of al verwerkt verzoek maakt de melding niet meer toepasbaar. Voor een uitnodiging controleert hij ontvanger, verval en actuele uitnodigingsstatus.

Intakeantwoorden worden niet aan de mail-eventpayload, templatevariabelen of HTML/plaintext toegevoegd. De CTA opent het beveiligde clubdossier; klikken op een mail neemt geen besluit. Supabase Auth blijft verantwoordelijk voor OTP-mails en gebruikt zijn eigen SMTP-instellingen.

De lokale tests schrijven echte transacties/outboxrecords en controleren de verzendbaarheidsvoorwaarden zonder een provider aan te roepen. Dat bewijst geen daadwerkelijke Resend-aflevering, SMTP-configuratie of inboxontvangst. Een echte stagingmail vereist de afzonderlijk ingerichte, omgevingsgebonden providerconfiguratie en ontvangersgrenzen.

## Huisstijl en levenscyclus

Kleuren zijn begrensde zescijferige hexwaarden. Tekst op de primaire knop krijgt berekend zwart of wit voor contrast. Logo's mogen alleen PNG, JPEG of WebP zijn: maximaal 96 kB invoer, maximaal 1024 × 1024 pixels en één stilstaand rasterbeeld. De server decodeert het beeld, verwijdert metadata en slaat een begrensde WebP op binnen de betreffende clubgegevens. SVG, externe logo-URL's, ongeldige bestanden en animatie worden geweigerd.

De eigenaar kan een club inactief maken. De server bewaart `inactiveAt` en `deleteAfter`, dertig dagen later. De club verdwijnt uit de openbare ontdekking; ledenrechten zijn tijdens inactiviteit ongeldig. Alleen de eigenaar kan binnen die termijn herstellen. Na die termijn kan de eigenaar de club definitief sluiten. Deze terminale toestand verwijdert de club uit de actieve toepassing en wist de zichtbare omschrijving en huisstijl; stabiele historische club-, wedstrijd- en deelnemers-ID's blijven bewaard. Definitief opschonen van privé-inhoud en wettelijke bewaartermijnen vraagt een apart vastgesteld productiebeleid; deze staginguitbreiding voert geen stilzwijgende destructieve purge uit.

## Gerichte acceptatie

`npx tsx --test tests/club-v17.test.ts tests/club-v17-db.test.ts` gebruikt alleen de expliciet geconfigureerde lokale loopbackdatabase. De databasegevallen maken eigen UUID-fixtures en ruimen die op; ze resetten de database niet en starten geen globale mailworker.

De gevallen behandelen eigenaarswissel/race, exclusief rolbeheer, rolgrenzen tussen twee clubs, intakevalidatie en versieverandering, onveranderlijke antwoorden, projectieprivacy, deduplicatie van ontvangst-/review-/besluitmails, rechtenintrekking vóór verzending, gelijktijdige besluiten, doelgerichte uitnodigingen, capaciteit, levenscyclus en veilige rasterbranding. Uitvoering op staging, twee echte apparaten en provideraflevering moeten afzonderlijk in het releasebewijs worden vastgelegd. Deze handleiding claimt geen productie-uitrol.
