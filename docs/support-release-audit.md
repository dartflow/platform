# Audit support, hulp, releasebeheer en meldingen

Auditbasis: `9d92e50b14589d55488fa979353e18f238d0016a`, aangevuld met de gedeelde support-/releasewerkbron. Dit document beschrijft de implementatie en het gerichte lokale bewijs; het is geen verklaring dat deze bron al uitgerold of door een store goedgekeurd is.

## Bestaande keten en afbakening

De web/PWA gebruikt Next 16.4.6, dezelfde domeinservices als de native Player-API en de private PostgreSQL-tabellen. `app/api/[...path]/route.ts` bepaalt de actor en bestaande CSRF-/body-/rate-limitgrenzen. `lib/native-player.ts` begrenst de native routes; Android is geen tweede autorisatieserver. Verenigingsrollen, locatiebeheer en platformrollen zijn verschillende poorten. Alleen een actuele platform-`owner` of `admin` beheert support, redactionele releases, kanaalregels en campagnes.

De repository had al gedeelde FAQ-publicatie (`lib/faq-publication.ts`), `/api/faq`, FAQ-/handleidinginhoud, Supabase Auth, mailtemplates, event-/outboxopslag, native push en de bestaande worker. Die blijven de bron. Er is geen parallel ticketsysteem in Android, geen nieuwe losse verzendworker en geen publicatie via een demo-opslag toegevoegd. Oche blijft een publieke sport-/locatieprojectie en krijgt geen supportgesprekken of private inbox.

## Geconstateerde afwijkingen en herstel

| Bevinding | Herstel / vindplaats | Bewijs of begrenzing |
| --- | --- | --- |
| Geen canoniek ticketnummer, eigen gesprekken of platformwachtrij | `lib/support-types.ts`, `support-domain.ts`, `support-tickets.ts`, `support-api.ts` en supportmigratie | Echte DB-tests voor nummerconcurrentie, retries, filters, transitions, rechten en rollback |
| Interne supportactiviteit mocht geen tijd-/revisie-/identiteitslek geven | Gescheiden publieke en beheerrevisie/tijdlijn, vaste publieke naam DartFlow Support | Gehele eigenaarresponse blijft bytegelijk na notitie, prioriteit en toewijzing; interne zoekterm geeft geen publiek resultaat |
| Geen neutrale tweerichtingsmelding met DF-nummer | Gedeelde `enqueueNotificationEvent` binnen tickettransactie | Eén melding bij antwoord plus status; eigen afzender krijgt geen echo; ontvangstbewijs alleen e-mail |
| Hulp miste duidelijke supportingang en gecontroleerde terugkeer | FAQ, lege zoekresultaten en handleiding verwijzen naar `/app/support/new`; `safeNext` behoudt exacte toegestane bestemming | `tests/support-release-routes.test.ts`; actuele browser/native uitvoering apart |
| FAQ-doelgroepmetadata was niet bruikbaar; FAQ-admin kon de handleidingkoppeling verliezen | Webhulp toont/filtert doelgroep; admin bewaart `manualId`; vaste inhoud-ID's blijven | Gedeelde inhoud voor web/native; hulp-unitchecks door UI-eigenaar |
| Meldingenkaart en voorkeuren stonden verspreid; header/inbox had geen eigen gelezenstatus | `lib/notifications.ts`, `components/notifications-workspace.tsx`, gedeelde instellingen en hele klikbare rij | Rootcommunicatietests bewaken onafhankelijke kanalen, overrides en vervallen bestemmingen |
| Geen redactionele releasebron met aparte verzendtoestemming | `lib/product-releases.ts` en `notification-campaigns.ts` | Publicatie zonder communicatie; preview/test/send/retry via bestaande events en outbox |
| Een lock op alleen bestaande releaserijen beschermde gelijktijdige eerste saves van hetzelfde UUID niet | Resource-advisorylock vóór lezen en schrijven in `lib/product-releases.ts` | Echte gecontroleerde concurrentie: één revisie 0 wint, stale save krijgt 409; gelijktijdige publicatie behoudt inhoud |
| Relevante profiel-, adres- en PIN-wijzigingen waren stil | Nieuwe brongebonden securitytriggers in `accounts.ts`, `profile-name.ts`, `player-pin.ts` | Alleen werkelijke wijzigingen, geen private waarden of eerste-onboardingruis |
| Reserveringsaanvraag/-besluit, concrete readiness/start en seizoensopvolging waren onvolledig | Hooks in `locations.ts`, `integrations-domain.ts`, `platform-competitions.ts`, `seasons.ts` | Echte bronmutaties en actuele rol-/revisie-/call-/fixturecontrole |
| Tweepersoonsprivéchat had geen afzonderlijke veilige melding | `community.ts`, `platform-social.ts`, getypeerde messagebron | Andere ontvanger, geen chattekst, verwijdering/block/actuele toegang opnieuw gecontroleerd |
| Custom-rolwijziging, werkelijke activiteitpromotie, eigendomsoffer en locatie-/lidmaatschapbesluit misten opvolging | `club-domain.ts`, `clubhouse.ts`, `locations.ts` | Echte RETURNING-/statusovergangen, geen selfecho/no-op, oude bron vervalt bij intrekking |
| Een gemelde speler kon de notificatiedoelroute niet als eigen zaak gebruiken | Eigen geredigeerde besluitprojectie in `platform.ts`, `/app/reports` in gecontroleerde loginreturn | Reporteridentiteit, reporttekst en contentreferenties gemaskeerd; andere account geweigerd |

Er zijn geen opdrachtvreemde functionele wijzigingen als onderdeel van deze domeinaudit toegevoegd. Bestaande sport-ID's, score-/ratingboekingen, Play-/deployflows en publieke scoreprojecties blijven hun eigen services gebruiken. De catalogusuitbreiding en helper zijn expliciet gekoppeld aan de bestaande meldingsketen, niet aan losse HTTP-verzending vanuit een domeinmutatie.

## Routes en transacties

| Onderdeel | Lezen | Muteren | Autoriteit en gegevensgrens |
| --- | --- | --- | --- |
| Eigen support | `GET /api/support/tickets`, `GET /api/support/tickets/:id` | `POST /api/support/actions` | Alleen eigen ticket; granular `can*`-velden; public revision |
| Supportbeheer | `GET /api/support/admin/tickets`, `GET /api/support/admin/tickets/:id` | Dezelfde actions, `ticket.admin.*` | Actuele platformrol; beheerrevisie, interne tijdlijn en staff alleen hier |
| Eigen inbox/instellingen | `GET /api/notifications`, `/api/notifications/settings` | `POST /api/notifications/actions` | Eigen account; actuele bron en doeltoegang bij openen |
| Kanaalregels/campagnes | `GET /api/notifications/admin` | `POST /api/notifications/admin/actions` | Platformbeheer; versiecontrole, preview/doelgroep/hash en expliciete verzending |
| Gepubliceerde releases | `GET /api/product-releases[/:id]` | Geen gebruikersmutatie | Alleen gepubliceerd; product-/kanaalfilter op lijst |
| Releasebeheer | `GET /api/product-releases/admin` | `POST /api/product-releases/admin/actions` | Platformbeheer; immutable gepubliceerde geschiedenis; publiceren verzendt niet |

De echte gebruikersroutes zijn `/app/support`, `/app/support/new`, `/app/support/:uuid`, `/app/admin/support[/uuid]`, `/app/whats-new[/uuid]`, `/app/notifications[/uuid]`, `/app/settings/notifications`, `/app/admin/releases` en `/app/admin/notifications`. Native delegeert naar dezelfde domeinregels via de bestaande `/api/player/v1`-grens.

Support ontvangt `{requestId, expectedRevision?, action}`. Alleen aanmaken heeft geen revisie nodig. Elke andere mutatie vergelijkt de zichtbare of beheerrevisie uit de eigen route. Actor-/tickettoegang gaat vóór receipt-replay; een bekende aanvraag herstelt geen ingetrokken recht. Receiptpayloads slaan geen privésupportantwoord op. Supporttijdlijn, ticketwijziging, receipt en notificatie-events committeren of rollen samen terug.

## Repository- en actie-inventaris

De volledige gebeurtenis-/kanaal-/ontvangertabel staat in [notification-trigger-matrix.md](notification-trigger-matrix.md), inclusief alle 66 catalog-ID's en bewuste stille acties. Gecontroleerde families:

- Account/Auth/profiel/PIN/registratie: `accounts`, `auth`, `profile-name`, `profile-setup`, `player-pin`, `platform-social`, `account-removal` en erasureworker.
- Sociaal/groepen/clubrollen: `platform-social`, `community`, `club-domain`, `clubhouse`, `clubhouse-calendar`, `clubhouse-chat`, `clubhouse-notifications`, `feed`, `feed-content`, `player-safety` en de actuele platformprojectie.
- Organiseren/spelen: `platform-boards`, `platform-competitions`, `integrations-domain`, `locations`, `seasons`, `season-reminders`, `competition-board-lobby`, `competition-wizard-service`, `tournament-management` en `match-corrections`.
- Persoonlijke score-/oefen-/gastflows, organisatorconcepten, ratinggeneraties, cast/Oche en board-/retentietimers: geen broadcast per routine-/presentatiehandeling; bestaande expliciete uitnodiging, planning, resultaat of toegangswijziging is de betekenisvolle trigger.
- Support/redactionele releases/campagnes: `support-*`, `product-releases`, `notification-events`, `notification-campaigns`, `notification-core`, `notification-targets`, `notifications`, `web-push` en `native-push`.
- Geplande taken: `planMailReminders`, seizoensreminders, campagneplanning, e-mail-/native-/browserpushaflevering, providerwebhook, deferred-enqueueherstel en account-/play-/boardretentie. Er is geen parallelle scheduler of providerclient in de nieuwe domeinhooks.

## Schema, privacy en exploitatie

De twee nieuwe schemawijzigingen zijn `20261120142422_support_tickets.sql` en `20261120142502_notification_policies_support_releases.sql`. Support voegt drie private RLS-tabellen, een beveiligde DF-sequence en immutable ticketidentiteit toe. Events/receipts zijn runtime append-only. De notificatiemigratie voegt voorkeuren, regels/audit, release-/campagneopslag en browserpush toe; de bedoelde runtimekolomgrants beperken bewerkbare gegevens. Browserrollen en `service_role` krijgen geen directe toegang tot deze private tabellen.

De supportprivacyhelper is eigenaar-only en wordt aangeroepen vanuit de bestaande daadwerkelijk bevestigde, lease-gevalideerde erasurefunctie. Een verzoek blokkeert toegang meteen maar wist nog geen historie. Bij echte erasure worden eigen tekst, actor-/toewijzingskoppelingen en gerelateerde receipts verwijderd of geneutraliseerd. De gedeelde communicatieprivacyhook ruimt eigen subscriptions, private doel-/tokengegevens, concepten en gerelateerde ontvangerkopieën op. Andere gesprekken, clubsportstaat en publicaties blijven hun legitieme eigen bron behouden.

Nieuwe domeinhooks gebruiken alleen de bestaande queue in de brontransactie. Een mislukte queuevalidatie mag geen half ticket of halve bronmutatie achterlaten. Voor elke aflevering gelden opnieuw de effectieve kanaalstand, accountstatus, abonnement, product/kanaal, deadline en huidige bron-/bestemmingstoegang. Provideracceptatie, toestel-/browserontvangst en openen zijn verschillende statussen. Een stilstaande configuratie of ontbrekende toestemming wordt niet als bezorging geteld.

## Verificatie op deze werkbron

De domeinverantwoordelijke draaide de vijf gerichte bestanden voor audittriggers, support, profielopzet en PIN met **50/50 PASS, 0 FAIL, 0 SKIP** op de afgescheiden loopback-PostgreSQL-database, in 18,20 seconden. Dit bevat echte queue-/inboxopslag, huidige bron-/rolintrekking, revisieconcurrentie, immutable DF-identiteit, runtime `42501`, transactie-rollback en daadwerkelijke privacy-erasure. De tests gebruiken willekeurige eigen fixture-ID's en scopegebonden cleanup. Volledige TypeScriptcontrole en gerichte ESLint met nul waarschuwingen slaagden.

De aanvullende `tests/product-release-concurrency-db.test.ts` slaagde met **3/3 PASS, 0 SKIP**: een echte tabel-/rijlock houdt gelijktijdige requests tegen tot beide onderweg zijn. Eén eerste save wint, de andere krijgt een revisieconflict; een publicatie wordt niet door een stale save overschreven en publicatie maakt nul communicatie-events. Oudere club-, profiel-, camera- en platformfixtures zijn uitgebreid met brongebonden notificatiecleanup en gegarandeerd sluiten bij cleanupfouten; alle oorspronkelijke functionele assertions bleven behouden. Die vier suites slaagden daarna met **34/34 PASS, 0 SKIP**. Dezelfde cleanup voor `seasons-db` en `seasons-formats-db` slaagde afzonderlijk met **35/35 PASS, 0 SKIP**. Deze afzonderlijke runs worden niet als één volledige suite gepresenteerd.

De centrale notificatie-eigenaar meldde daarnaast 30 geslaagde communicatie-DB-tests en drie wireprivacytests; dat is afzonderlijk bewijs en wordt niet bij de 50 opgeteld als een reeds uitgevoerde gecombineerde run. De volledige suite op een nieuwe geïsoleerde release-DB, Next-build, browser-E2E, native tests/emulator, echte Android-/browserpush, hosted migraties en staging/productie-uitrol zijn op dit auditmoment nog aparte vereiste gates. Dit document voorspelt geen uitkomsten van die gates en bevat geen fysieke bezorgclaim.

Beheeruitleg: pas kanaalregels aan per gebeurtenis, controleer de bewaarde spelerskeuze en effectieve stand, maak voor een campagne een nieuwe preview en proefverzending, bevestig pas daarna de echte doelgroep. Herstel uitsluitend openstaande leveringen binnen dezelfde campagne. Publiceer redactionele releases los van operationele deployments en storepublicatie. Houd een supportantwoord openbaar en een interne notitie intern; gebruik de afzonderlijke publieke/administratieve revisie uit de actuele route.
