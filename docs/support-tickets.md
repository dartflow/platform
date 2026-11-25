# Supporttickets

Tickets gebruiken de bestaande account-, platformrol-, mail-, inbox- en pushinfrastructuur. Verenigingsrechten geven geen supportrechten. Alleen actuele platformrollen `owner` en `admin` mogen de beheerwachtrij openen of beheeracties uitvoeren.

## Routes en commando’s

Webroutes: `/app/support`, `/app/support/new`, `/app/support/:id`, `/app/admin/support` en `/app/admin/support/:id`. De UUID identificeert het ticket; het leesbare, door een databasesequence uitgegeven nummer is `DF-<nummer>`. Nummer en UUID blijven behouden bij onderwerp-, categorie- en statuswijzigingen. Een teruggedraaide transactie mag een ongebruikt sequencegetal achterlaten.

De API gebruikt dezelfde serverfuncties voor cookie-web en de bestaande native bearer-wrapper onder `/api/player/v1`:

| API | Resultaat |
| --- | --- |
| `GET /api/support/tickets` | Eigen tickets met serverfilters en paginering |
| `GET /api/support/tickets/:id` | `{ticket}` met uitsluitend openbare gebeurtenissen |
| `GET /api/support/admin/tickets` | Beheerwachtrij, medewerkers en open/onbehandeld-tellingen |
| `GET /api/support/admin/tickets/:id` | `{ticket}` met afzonderlijke `management`-projectie |
| `POST /api/support/actions` | `{ok,ticket,replayed}` |

Lijstfilters zijn `q`, `status`, `category`, `limit` en `offset`. Beheer ondersteunt ook `priority` en `assignee` (`all`, `me`, `unassigned` of een medewerker-UUID). `status=open` selecteert nieuw, in behandeling en wacht op gebruiker; `status=unhandled` selecteert nieuw. Standaardpagina 25, maximum 100. De gebruiker kan niet zoeken in interne notities of via interne filters.

Ieder schrijfcommando heeft `{requestId,expectedRevision?,action}`. `expectedRevision` is verplicht behalve bij aanmaken. De getypte acties staan in `lib/support-types.ts`: aanmaken, eigen reactie, sluiten en heropenen; afzonderlijke beheeracties voor openbaar antwoord, interne notitie, status en details/toewijzing/prioriteit. Onbekende velden worden geweigerd. `ticket.admin.reply` kan tegelijk de status wijzigen en produceert één reactie-event en één melding per ontvanger.

Een herhaald request wordt pas na actuele account- en rolcontrole uit het append-only ontvangstbewijs herkend. Gewijzigde inhoud met hetzelfde request-ID geeft een conflict. Het antwoord bevat vervolgens de actuele, opnieuw geautoriseerde projectie. Parallelle wijzigingen van dezelfde revisie laten één mutatie slagen; de andere krijgt `revision_conflict`.

## Publieke en interne opvolging

Nieuw en in behandeling betekenen dat support aan zet is. Een supportantwoord zet standaard op wacht op gebruiker. Een gebruikersreactie zet terug op in behandeling. Opgelost en gesloten vereisen eerst heropenen; heropenen zet op in behandeling. De server levert de toegestane knoppen als expliciete capabilities en de toegestane beheerstatussen.

Het ticket heeft een interne revisie/tijd en een afzonderlijke publieke revisie/tijd. Een interne notitie, toewijzing of prioriteitswijziging verandert de volledige gebruikersprojectie niet, ook de activiteitstijd niet. Openbare gebeurtenissen bevatten geen interne actor-ID’s of personeelsnamen: de supportafzender heet `DartFlow Support`. De beheerprojectie bevat actuele publieke accountlabels, actor en tijd per auditgebeurtenis. Historische tickets zonder gebeurtenissen leveren een lege tijdlijn.

## Notificaties

Ticketwijziging, tijdlijn, idempotentiebewijs en notificatie-events worden binnen dezelfde databasetransactie opgeslagen. De algemene notificatie-engine beslist over de effectieve kanalen en controleert vlak voor aflevering opnieuw account, eigenaar, rol en toewijzing. Een ingetrokken toewijzing kan daardoor geen toegang via een oude melding geven.

| Gebeurtenis | Ontvanger | Engine-event |
| --- | --- | --- |
| Aanmaken | Actuele supportwachtrij, zonder afzender | `support.created` |
| Ontvangstbevestiging | Eigenaar, uitsluitend toepasselijk e-mailkanaal | `support.received` |
| Gebruikersreactie | Actuele bevoegde toegewezen medewerker; anders wachtrij | `support.user-replied` |
| Gebruiker heropent | Actuele bevoegde toegewezen medewerker; anders wachtrij | `support.reopened` |
| Openbaar supportantwoord | Eigenaar, zonder afzender | `support.answered` |
| Handmatige openbare beheerstatus | Eigenaar, zonder afzender | `support.status-changed` |
| Interne notitie, toewijzing of prioriteit | Geen gebruikersmelding | Geen |
| Gebruiker sluit eigen ticket | Geen eigen echo | Geen |
| Onderwerp/categorie gecorrigeerd | Openbare detailsgebeurtenis; geen extra automatische melding | Geen |

Titels en pushteksten gebruiken uitsluitend een neutrale omschrijving en DF-nummer. Onderwerp, berichten en interne persoonsgegevens worden niet in de meldingsprojectie opgenomen. De klikbestemming is de eigen of beheerweergave van precies dat ticket. Supportmeldingen gebruiken de private inbox en worden niet aan Oche-schermprojecties toegevoegd.

## Opslag en accountverwijdering

Migratie `20261120142422_support_tickets.sql` maakt drie private RLS-tabellen, een nummersequence en de marker `support_tickets=1`. Browserrollen en `service_role` krijgen geen toegang. De runtime kan ticketidentiteit niet aanpassen en gebeurtenissen/ontvangstbewijzen alleen toevoegen. De accountverwijdering roept de eigenaar-only helper uitsluitend vanuit de bestaande bevestigde, lease-gevalideerde erasurefunctie aan. Die wist privétekst en gerelateerde ontvangstbewijzen, neutraliseert het eigen ticket en haalt actor-/toewijzingskoppelingen weg. Onverwante gesprekken blijven behouden. Een verwijderingsverzoek blokkeert toegang meteen, maar wist de inhoud pas bij de daadwerkelijke erasure.

## Uitgevoerde lokale verificatie

`tests/support-domain.test.ts` en `tests/support-tickets-db.test.ts` slaagden als onderdeel van de gerichte gecombineerde 50-test-run met **15/15 tests, 0 overgeslagen** op een afgeschermde loopback-PostgreSQL-database. De proeven gebruiken eigen willekeurige accounts/tickets en ruimen die brongebonden op. Ze bewijzen onder meer concurrente deduplicatie en revisieconflicten, eigen zoek-/paginering, clubbeheerder/ander account geweigerd, geen interne activiteit in de gebruikersprojectie, één reactie/statusmelding, echte inboxlink en rolintrekking, onderwerp/nummerbehoud, volledige rollback bij een echte mailvalidatiefout, runtime-ACL’s en bevestigde erasure met behoud van een ander gesprek. De extra pure routeproef bewaakt de veilige terugkeer naar de eigen moderatiebestemming.

De aanvullende runtime-ACL-proef gebruikt bestaande notification-commands en rule-audit-tabellen en bewijst ook daar `42501` bij wijzigen/verwijderen. De proeven verzenden geen mail naar een provider en meten geen fysieke Android- of browserpushbezorging. Browser-, native-, hosted- en deploymentbewijs moet afzonderlijk aan de uiteindelijke release worden gekoppeld.
