# Dartflow architectuur

De native Next.js-app gebruikt het v15-ontwerp boven één geautoriseerd PostgreSQL-model. De exacte bron en oorspronkelijke tests staan in `prototype-v15/`; de overdracht staat in `docs/reference/v15/`. Broncommit is `e27cccdbd0b6cd2144cc2f26cab9e2986a903e61`, tree `11a6c9b02a99b5880971380eca05c4ae29151911`. Alle 98 blobs en de exportchecksum zijn gecontroleerd. De prototype-Worker en Sites-hostingconfiguratie blijven bij de referentie.

## Accounts en toegang

Supabase Auth verzorgt OTP en Google met server-side sessies. Iedere geverifieerde Auth-identiteit krijgt idempotent één profiel met dezelfde UUID. Namen uit gebruikersmetadata zijn uitsluitend presentatiegegevens. Platformrollen en actuele clublidmaatschappen komen uit de private database. De lokale accountkiezer is beperkt tot expliciete developmentmodus op loopback.

De eenmalige eigenaarstoewijzing voor het door Danny opgegeven `info@dgwebservices.nl` gebruikt een beschermde uitnodiging en de onafhankelijk geverifieerde `auth.users`-rij. De uitnodiging wordt één keer verbruikt. De runtime kan haar niet lezen/wijzigen en kan zelf geen platformrol schrijven. De private triggerfunctie heeft een leeg zoekpad en geen uitvoerrechten voor browser- of runtime-rollen. Eigenaarherstel is een aparte beheerhandeling.

Het schema `dartflow_private` is uitgesloten van de Data API. Alle applicatietabellen hebben RLS; browserrollen hebben geen schema- of objecttoegang. De beperkte `dartflow_app`-rol voert geautoriseerde serveroperaties uit. Objecten blijven eigendom van de migratiebeheerder. Er is geen verhoogde Supabase-key in browsercode of de gewone applicatieverbinding.

## Wedstrijden en platformfuncties

`lib/domain.ts` bevat de gedeelde X01-motor voor 301/501/701, legale darts, bust, dubbel-uit, legs/sets, best-of, vaste acht/tien legs, gelijkspel en undo. `lib/db.ts` verwerkt kerncommando's met actuele rechten, locks, revisies, payloadhash en actieontvangstbewijs. Score, audit en eventuele mailgebeurtenis committen samen. Twee uitslagbevestigingen publiceren één unieke uitslag en standings. Administratieve beslissingen hebben eigen audit en verzinnen geen worpen.

Spelers kunnen schrijverschap overnemen. Een toegewezen externe schrijver heeft de bedoelde invoerbevoegdheid; spelers bevestigen hun eigen uitslag. Dezelfde match-ID blijft leidend bij opnieuw laden en reconnect. Pauze en correctie gebruiken getypeerde servertransacties.

`lib/platform*.ts` implementeert training, clubs, sociale relaties, kamers/chat, lobbies, competities, toernooien, baanregie, registraties, statistiek, CSV en casting. Entiteiten en relaties staan blijvend in de database. Competitief scoren verwijst naar de kernpartij. Definitieve kernuitslagen worden idempotent doorgegeven aan fixtures, standen en vervolgwedstrijden.

Telefoons, dashboards en schermen lezen serverprojecties via begrensd pollen. Schermen krijgen een beperkte, intrekbare alleen-lezen grant. Sprint toont de volledige huidige leg, vaste lettergroottes, statistiek en gepseudonimiseerde speler-/schrijver-ID's. Onbekende prototypesleutels worden niet aan een willekeurige wedstrijd gekoppeld.

Een onbevestigde live aanvraag behoudt haar actie-ID tot synchronisatie. De afzonderlijke offline-regiequeue voor toernooien bewaart actor, omgeving, match en oorspronkelijke revisies. Replay bevestigt alleen de verwerkte prefix en behoudt conflicterend werk; er wordt niet stilzwijgend op een nieuwe stand verder gespeeld.

## Online beeld

WebRTC-signaling is alleen beschikbaar voor actuele deelnemers en houdt rekening met blokkades. `MediaRoom` verzorgt preflight, gedeeld beeld, camera/microfoon, opnieuw verbinden en het stoppen van tracks. Scoren werkt onafhankelijk van media.

Staging en productie hebben afzonderlijke native coturn-instanties, poorten, relaybereiken en sleutels. De server maakt kortlevende HMAC-credentials per speler en match. Coturn weigert interne peeradressen; systemd-netwerkfilters schermen ook Caddy-beheer af. Publieke relayacceptatie vereist bereikbaarheid door de externe VPS-firewall.

## Mail en Google beheer

`lib/integrations*.ts` bevat de 32 v15-sjablonen, concept/publicatie, platform- en clubscope, voorkeuren, duurzame outbox, leases, retry, reminders en geverifieerde webhooks. Gebeurtenis, ontvanger, scope en sjabloonversie blijven aan de opdracht gebonden. Verzendmodus en testontvangers worden begrensd door de eigen runtimeconfiguratie.

Resend API- en webhookcredentials zijn write-only en worden met AES-256-GCM opgeslagen, gebonden aan omgeving, project en credentialtype. Encryptiesleutels blijven op de host. Een beperkte loopbackworker verwerkt outbox en regieplanning; het publieke Caddy-pad is afgesloten.

OTP blijft een Supabase-stroom met eigen SMTP; logs bewaren geen codes. Googlebeheer gebruikt een server-only Management API-token voor het vaste eigen project en wijzigt uitsluitend Google-instellingen. De beheerinterface onderscheidt configuratie van werkelijke mail-/loginacceptatie.

## Migraties en releases

De kerncontractversie blijft 1 zodat de eerdere release tijdens expansiemigratie en approllback gezond kan blijven. De v15-uitbreiding heeft een aparte `feature_versions`-markering; de nieuwe app controleert beide. De met Supabase CLI 3.1.0 aangemaakte expansiemigratie staat onder `supabase/migrations/`; lokale bootstrap past deze na het kernschema toe.

De native releaseketen gebruikt een exacte commit, verplichte CI, beperkte rootbroker, bronverwerving op de doel-VPS en een afzonderlijke build per omgeving. Buildcode krijgt geen runtimegeheimen. App en immutable configuratie worden gezamenlijk geactiveerd. Approllback herstelt geen database, providerinstellingen of afleveringen. Zie [deployment.md](deployment.md) en de [v15-omgevingsmatrix](v15-omgevingen.md).
