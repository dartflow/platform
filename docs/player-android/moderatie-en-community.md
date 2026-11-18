# DartFlow: community, melden en blokkeren

Versie 2026-11-18. Contact: **info@dartflow.nl**. Dit document beschrijft geïmplementeerde bediening en beheer. Het is geen bewijs van een Google-goedkeuring of een verklaring dat de mailbox permanent bemand is.

## Speler

- Lees `/communityregels` en `/voorwaarden`. Bij de eerste communitypublicatie bevestigt de speler expliciet 13 jaar of ouder te zijn en beide documenten te accepteren. De server bewaart regelversie en moment; er wordt hiervoor geen geboortedatum opgeslagen.
- Zonder die acceptatie blijven normale wedstrijd- en scorefuncties beschikbaar. De server weigert een nieuw communitybericht, reactie, chatbericht of resultaatpublicatie.
- Open **Melden / blokkeren** bij een bericht, reactie, chatbericht of speler. Kies een categorie en geef een toelichting. Meld geen wachtwoorden, spelerspincodes, inlogcodes of onnodige privégegevens.
- De server leidt de echte auteur en het huidige leesbereik af uit de inhoudsreferentie. Een opgegeven willekeurige auteur, een andere kamer of een niet-toegankelijk bericht wordt niet als melding opgeslagen.
- **Speler blokkeren** is een aparte actie. Vriendschapsrelaties en verzoeken worden opgeheven; nieuwe verzoeken en uitnodigingen worden geweigerd. Sociale feed- en chatprojecties filteren de geblokkeerde relatie in beide richtingen. Directe wedstrijdchat en media worden geweigerd tussen geblokkeerde spelers. Groepsinhoud kan voor andere bevoegde deelnemers blijven bestaan.
- Een blokkade wijzigt geen officiële wedstrijd of uitslag. Raadpleeg bij een officieel duel de wedstrijdleiding.
- Een eigen blokkade kan via de vriendenomgeving worden opgeheven.
- Bij ontbrekende bediening: mail `info@dartflow.nl` met onderwerp `Veiligheidsmelding DartFlow`, een korte toelichting en de betreffende link/referentie. Bij kindveiligheidsmeldingen geen illegaal beeldmateriaal kopiëren of meesturen. Bij onmiddellijk gevaar de lokale hulpdiensten gebruiken.

## Beheer

1. Een bevoegd platformbeheerder opent `/app/reports` → **Moderatiemeldingen**. Een huidige bevoegde kamerbeheerder ziet alleen de meldingen binnen het eigen bereik; een gebruiker kan eigen ingediende meldingen terugzien.
2. Controleer categorie, type, inhoudsreferentie en toelichting. Een gemelde speler krijgt niet automatisch de identiteit van de melder te zien en kan de eigen melding niet beoordelen.
3. Kies **Geen verwijdering, beoordeling vastleggen**, **Gemelde inhoud verwijderen** of **Waarschuwing vastleggen** en geef een motivering.
4. De server controleert de actuele beheerrechten opnieuw. Verwijdering verwijdert/verbergt de bijbehorende feed- en communityprojecties samen. Berichten gebruiken de bestaande verwijderstatus. Deze actie wijzigt geen scorebron of officiële uitslag.
5. Ontvanger en melder kunnen een toepasselijke moderatiemelding ontvangen via de bestaande mail-outbox. Dit is geen belofte dat een externe mailprovider elk bericht heeft afgeleverd.
6. Voor aanvullende maatregelen bestaan de bestaande kameracties voor stilte, verwijderen en verbannen. Competitie-/toernooimaatregelen volgen het bevoegde wedstrijdpad.
7. Verzoeken om heroverweging komen via `info@dartflow.nl` met meldreferentie. Beoordeel context en voorkom onnodige verstrekking van persoonsgegevens.

Er is geen automatische inhoudsclassificatie of 24/7 moderatiedienst toegevoegd. De eigenaar moet de meldwachtrij en het contactadres daadwerkelijk blijven opvolgen. Stel bij kindveiligheidsincidenten de benodigde beschermingsmaatregelen en toepasselijke meld- of medewerkingsplichten vast.

## Contract

Native routes (router in hoofdwijziging):

- `GET /api/player/v1/safety`
- `POST /api/player/v1/safety/consent` met `version`, `accepted: true`, `ageConfirmed: true`
- `POST /api/player/v1/safety/report` met `requestId`, `targetType`, `targetId`, `category`, `reason` en zo nodig `scopeKind`/`scopeId`
- `POST /api/player/v1/safety/block` met `requestId`, `userId`, `blocked`

Web gebruikt de bestaande `/api/platform/actions` met `safety.state`, `safety.accept`, `report.create`, `friend.block` en `friend.unblock`. Iedere mutatie heeft een uniek aanvraag-ID; retry van dezelfde platformactie gebruikt hetzelfde ID.

Categorieën: `harassment`, `hate`, `sexual`, `child-safety`, `threats`, `scam`, `privacy`, `other`. Inhoudstypen: `user`, `post`, `reply`, `message` (communitychat), `room-message` (bestaande kamerchat), plus `room` voor bestaande kamermeldingen.

Een actor kan maximaal 10 opgeslagen meldingen per uur maken. Ook ongeldige meldpogingen hebben een persistente limiet van 30 per uur. De meldfunctie heeft geen autoriteit om onbekende profielen of besloten inhoud op te zoeken. Uitvoer naar gewone beheerlogs bevat geen meldtekst; de tekst wordt in de afgeschermde meldopslag verwerkt.

## Opslag en migratie

`supabase/migrations/20261118124054_player_community_safety.sql` voegt de private, RLS-beveiligde `player_safety_acceptances` toe en gescopeerde inhoudsreferenties/categorie aan `platform_reports`. Bestaande spelers worden niet stilzwijgend akkoord verklaard. Geen nieuwe secretconfiguratie.

De gegevens zijn server-only. De beperkte runtime-rol heeft toegang; `public`, `anon` en `authenticated` krijgen geen rechtstreekse tabeltoegang. Acceptaties worden via de profiel-FK bij daadwerkelijke profielverwijdering meegenomen. Afhandeling van overige meldgegevens en bewaarexcepties volgt de accountverwijderworkflow en het gepubliceerde privacybeleid.

## Verificatie

Op geïsoleerde loopbackdata:

- `npx tsx --test --test-concurrency=1 tests/player-safety.test.ts tests/community-db.test.ts tests/feed-db.test.ts tests/platform-db.test.ts`: **44/44 geslaagd**, geen skips.
- `npm run typecheck`: geslaagd.
- ESLint voor gewijzigde safety-, community-, feed-, publieke pagina- en testbestanden: geslaagd.
- `tests/e2e/player-safety.spec.ts`: toegevoegd voor mobiele expliciete acceptatie, melden, blokkeren en publieke documenten. Werkelijke uitvoering wordt in het gezamenlijke releaseverslag geregistreerd.

Echte telefoonbediening, daadwerkelijke mailontvangst, bedrijfsmatige moderatie-opvolging en de uiteindelijke Play-verklaringen vragen hun eigen controle; de tests hierboven claimen die niet.
