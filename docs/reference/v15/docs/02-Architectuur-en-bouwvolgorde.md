# Architectuur en bouwvolgorde

## Basis en afbakening

De bestaande DartFlow-repository op de dev-VPS is het implementatiedoel. Sites v15 is de exacte functionele en visuele referentie. Behoud werkende implementaties uit de doelrepo en vervang stapsgewijs de prototype-adapters. De DG-basis gebruikt native Next.js, een gepinde Node/npm-toolchain, Supabase Auth en PostgreSQL, systemd op loopback en Caddy voor HTTPS. Verifieer versies, bestaande bibliotheken en runtimecontract voor je een nieuw onderdeel toevoegt.

| Laag | Productiecontract |
|---|---|
| Marketing | Server-rendered openbare `/`, inhoud en interacties uit v15, juiste productiecanonical, sitemap en deelmetadata. Staging afschermen volgens bestaand beleid en `noindex`. |
| App | Beveiligde `/app`, server-side sessie en routering. Zichtbare navigatie volgt rol en context. Deep links resolve naar blijvende IDs en toetsen toegang op de server. |
| Domain | Hergebruik geteste X01-logica en afzonderlijke regels voor training, vrije match, competitie en baanpartij. Leg format en versie bij aanvang vast. |
| Commando's | Geauthenticeerde servermutaties. Zod of bestaande validatie, transacties, optimistische revisiecheck, idempotente verwerking en audit. |
| Realtime | Geautoriseerde per-wedstrijd/club-/venue-kanalen, een serverprojectie als startpunt en herlezing na reconnect. Aanwezigheid is tijdelijk. Realtime event is een signaal om te synchroniseren. |
| Schermen | Schermautorisatie met een alleen-lezen grant of expliciet publieke, minimale projectie. Geen sessie of schrijfrechten voor een castscherm. Scheid publiek, organisator, telefoon en OBS. |
| Integraties | Supabase Auth voor OTP/Google, Resend API voor appmail, door Danny ingesteld Resend SMTP voor Auth. Server-side secrets en status. |
| Data | De gekozen PostgreSQL-database per omgeving is gezaghebbend. Browseropslag dient voor persoonlijke UI-instellingen, expliciete offline wachtrij en afgeschermde demo. |

## Data en scopes

Verifieer of de bestaande database al types/tabelnamen aanbiedt. Onderstaande entiteiten beschrijven relaties en invarianten. Bewaar bij migraties bestaande primaire sleutels en linkaliassen.

| Entiteiten | Relatie en constraints |
|---|---|
| `profiles`, `platform_roles` | Eén profiel per `auth.users.id`. Platformrollen alleen via beschermd beheerpad. Profielen worden idempotent gekoppeld bij beide aanmeldroutes. |
| `clubs`, `club_memberships`, `membership_requests`, `club_news` | Unieke combinatie club/profiel, status en rol. Een club kan eigen eigenaar en beheerders hebben. Clubleden en evenementdeelnemers zijn verschillende relaties. |
| `friend_requests`, `friendships`, `blocks` | Platformrelaties tussen profielen. Normaliseer paren, voorkom duplicaten en pas blokkades toe bij chat en uitnodigen. |
| `community_rooms`, `room_members`, `messages`, `room_invites`, `room_bans`, `moderation_reports` | Scope, rol, uitnodiging, capaciteit en ban worden bij mutatie getoetst. Voeg deelnemer en bezetting atomair toe. Leesbeleid volgt kamertype en lidmaatschap. |
| `venues`, `boards`, `board_assignments`, `screen_grants` | Stabiele QR-slug per baan. Ten hoogste één actieve toewijzing per bord, geen dubbele gelijktijdige inroostering van dezelfde speler. Vaste QR resolve server-side. |
| `events`, `event_registrations`, `check_ins`, `fixtures`, `groups`, `bracket_edges` | Scope expliciet platform of club. Uitnodiging/deelname buiten eigen club volgt evenementregels. Deterministische doorgifte van winnaar en standings. |
| `matches`, `match_players`, `match_visits`, `match_commands`, `result_confirmations`, `match_results` | Één geautoriseerde scoreleider op een baan. Iedere actie bevat match-ID en revisie. Unieke actie-ID per match en unieke resultaatkoppeling per fixture. |
| `practice_sessions`, `player_statistics` | Training apart van competitieve punten. Stats uit gevalideerde events of afleidbare projecties. Historie van een profiel blijft bij de echte speler. |
| `mail_templates`, `mail_template_versions`, `mail_rules`, `mail_outbox`, `mail_attempts`, `mail_delivery_events` | Versie/scope/ontvanger vast bij enqueue. Unieke combinatie van domain event, scope, template en ontvanger. Leases en audit. |
| `integration_settings`, `integration_credentials`, `admin_audit_events` | Sleutelmateriaal alleen in server-only schema/opslag. Audit bevat actor, omgeving, actie, versie en uitkomst. Credentials worden niet meegestuurd. |

Gebruik een expliciet ownershipmodel. `scope_kind = 'platform'` heeft geen club-ID. `scope_kind = 'club'` vereist een geldige club-ID. Een fixture, bijbehorende match en uitslag erven scope uit het evenement. Vriendschap en een vrije wereldwijde match houden hun eigen scope wanneer de gebruiker daarna een club kiest. Vermijd `NULL`-gedrag in samengestelde unieke sleutels door scope als niet-null, eenduidige sleutel af te leiden of een passende databaseconstraint te kiezen.

## Wie mag wat

| Rol of grant | Voorbeelden | Autorisatie |
|---|---|---|
| Anoniem | Marketing, beperkt openbaar scherm, QR-bestemming openen | Publieke projectie zonder privésessies, chatinhoud of contactgegevens |
| Speler | Eigen profiel, wedstrijden, training, vriendschappen, toegestane evenementen | Eigen account, deelnemer of geldige uitnodiging |
| Clubbeheerder | Ledenbeheer, clubconfiguratie, clubtemplates | Actief beheerrecht in precies die club |
| Wedstrijdleider | Inschrijven/check-in, baanregie en geschilafhandeling | Delegatie tot de relevante club/speeldag |
| Schrijver | Worp, dubbel bevestigen, undo | Actieve writer-grant op de huidige wedstrijd en revisie |
| Platformbeheerder | Platforminstellingen, globale evenementen en integraties | Gecontroleerde platformrol en voor sleutelwijzigingen een recente herauthenticatie passend bij het bestaande auth-beleid |
| Mailworker | Outbox lezen, jobs claimen, provider aanroepen | Dedicated serverrol, toegang tot relevante mailtabellen en encryptiesleutel |
| Scherm/OBS | Alleen-lezen scoreprojectie | Publiek toegestaan of korte, beperkte schermgrant per evenement/baan |

RLS op elke blootgestelde tabel. Test expliciet zowel `SELECT` als schrijven met anoniem, speler A, speler B, club A, club B en platformbeheer. Sluit elevatie via bewerkbare user metadata, door de client aangeleverde actor-ID en geforceerde URL's uit. Views die RLS volgen krijgen passende security-invoker-configuratie. Voer elevated SQL alleen via kleine, gecontroleerde operaties uit met vaste zoekpaden en beperkte execute-rechten. Gebruik server-side verificatie van de Supabase-sessie voor beveiligde mutaties en controleer actuele membership bij gevoelige wijzigingen. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

## Wedstrijdcontract

1. Client verzendt `matchId`, `expectedRevision`, unieke `actionId`, `type` en actieparameters. De server bepaalt actor, omgeving, scope en rechten uit sessie en database.
2. Behandel een herhaalde actie van dezelfde actor met dezelfde payload als dezelfde opdracht. Weiger hergebruik van een action ID met andere inhoud. Controleer daarna revisie, actieve match en bevoegdheid. Bij conflict retourneer een bruikbare actuele projectie en laat een speler een bewuste nieuwe poging doen.
3. Schrijf event, nieuwe stand en revisie in één transactie. Dezelfde transactie kan een domain event vastleggen voor een bevestiging of uitslag. Maak irrelevante profielinformatie onzichtbaar in de publieke projectie.
4. Publiceer aan geautoriseerde abonnees na commit. Gebruik monotone revisie en volledige snapshot op reconnect. Een achtergrondtab of slechte verbinding toont laatst bekende score met status. Worpinvoer kan alleen veilig hervatten na reconciliatie.
5. Bij writer takeover worden schrijver en revisie atomair aangepast. Een scoreverzoek van de vorige schrijver kan in een race hoogstens vóór de overname winnen. Na de overname wordt die schrijver afgewezen. Een oude offline actie krijgt geen automatische nieuwe revisie.
6. De gespeelde uitslag wordt pas door de afgesproken finale bevestiging definitief. Competitie, evenement, baan en historie lezen dezelfde definitieve bron. Correctie na definitief resultaat gebruikt een bevoegde correctietransactie met audit en een herberekening van afgeleiden.

Schermprojectie bevat restscore per speler, voortgang legs/sets, actieve beurt, geordende beurten van de leg, checkout, beperkte stats en of de baan vrij is. Namen of initialen komen uit het geautoriseerde profiel, de schermcode geeft geen schrijftoegang. Scope een online uitnodiging op de bedoelde match en deelnemer waar bekend, geef een geldigheidsduur, bewaar een hash en log de link zelf niet.

### Twee vormen van offline

Bij live scoren krijgt één bevestigde serveractie betekenis. Bij verlies van verbinding blijft de laatste score zichtbaar met herstelfeedback en stopt invoer totdat de serverstand bekend is. Bij toernooiregie mogen uitsluitend de bestaande ondersteunde offline-acties in een duurzame, geordende queue met scope, actor, match, basisrevisie en idempotentiesleutel. Na reconnect worden conflicten zichtbaar gemaakt. Een ander account of andere omgeving verwerkt de queue niet. Bewaar foutief of niet-verwerkt werk tot de gebruiker het kan herstellen. Zie ook de acceptatiematrix.

### Online media

Behoud het onderscheid tussen camera/microfoon lokaal testen, eigen camerabeeld en gedeeld beeld op afstand. Sluit aan op de bestaande media-infrastructuur als die aanwezig is. Als de repo geen werkend mediapad biedt, implementeer een toegestane WebRTC-oplossing met geautoriseerde roomtokens/signaling en TURN of een passende bestaande SFU. Houd de scoreketen onafhankelijk van videostatus. Verifieer twee netwerken, toestemming geweigerd, opnieuw verbinden, audio/video toggle en opruimen van media-tracks bij vertrek. Registreer kosten of benodigde credentials bij het echte gekozen contract.

## Migraties en data

- Inspecteer de bestaande staging- en productieschema's vóór migraties. Gebruik versiebeheer voor alle schema-, RLS- en RPC-wijzigingen. Voeg eerst compatibele tabellen en kolommen toe, migreer daarna data en ruim oude vormen pas op na de overeengekomen overgang.
- Gebruik de v15-browserfixtures voor herhaalbare stagingdata met eigen adressen. `puinruimers-demo-v3` en het D1-demoprofiel vormen geen geverifieerde productie-identiteiten. Import van bestaande echte data uit de doelapp gebruikt aantoonbare mappings en tellingen per club/competitie. Maak een aparte dry run en leg de uitkomst vast.
- Leg vast welke oude QR-links van blijvende locaties een alias krijgen en welke oude demo-links als demo of verlopen worden afgehandeld. Gebruik een expliciete mapping per code, om verwisseling van banen te voorkomen.
- Behandel backups en restoreproeven als operationeel herstel. Zie deployhoofdstuk voor app-/configrollback en compatibele migraties. Gebruik productiedata voor testdoeleinden alleen binnen bestaande toegangs- en data-afspraken.

## Lever in verticale slices

| Stap | Werkende doorsnede | Afsluiten met |
|---|---|---|
| A · Referentie en inventaris | Exacte v15 bron, app- en omgevingskaart, featurematrix en geverifieerde build | Prototype baseline tests en impactlijst per module |
| B · Account en platform | Google/OTP, één profiel, rollen, clubs en context, routebeveiliging | Onafhankelijke accounts, twee clubs, negatieve RLS/routeproeven |
| C · Spelen en Sprint | Oefenen, lokaal, online, wedstrijdkamer en gesynchroniseerd baanscherm | Twee apparaten plus scherm, race, undo, finish en reconnect |
| D · Community en evenementen | Vrienden, kamers, chat, inschrijving, competitie, fixtures, regie, casting en offline replay | Van uitnodiging of check-in tot één definitieve uitslag |
| E · Integraties en mail | Resend beheer, alle geldige domeintriggers, OTP via Supabase en Google beheer | Echte proefmail, webhook, replays en Google-login per omgeving |
| F · UI en release | Exacte v15-look, marketing en SEO, toegankelijkheid en responsive, veilige migraties, staging en productie | Opleverrapport met twee echte deployments en reproduceerbaar testbewijs |

Werk slices waar mogelijk parallel uit met duidelijke eigenaarschapgrenzen. Houd één definitie van scope, wedstrijd- en event-ID en ontvangersselectie. Ga bij elke slice van scherm naar server, opslag en tests. De totale overdracht eindigt met de volledige matrix en de productie-uitrol.
