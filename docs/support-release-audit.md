# Audit support, hulp, releasebeheer en meldingen

Auditbasis: `9d92e50b14589d55488fa979353e18f238d0016a`, aangevuld met de gedeelde support-/releasewerkbron. De uiteindelijke productbron is `f527ed618b18a12d588b8bdc6fa12edc6f47cbdb` ([PR 25](https://github.com/dartflow/platform/pull/25)); staging/productie zijn geaccepteerd en Player code9 staat intern/productie op completed. De afzonderlijke [0.6.0-release](releases/0.6.0.md) en [uitgiftegegevens](evidence/release-0.6.0-2026-11-20.json) bewaren de werkelijke scope en receipts.

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
| Twee Oche-webtabbladen konden na een verloren inwisselantwoord verschillende nonces bewaren en vastlopen | Smalle clientfix `2f647cf` in `components/oche-device-display.tsx`: browserbrede redeem-lock, daarbinnen sessiehercontrole en alleen na 401 inwisselen; serverbeleid blijft gelijk | Werkelijke f6-PR-fout 123/124; versterkte bestaande browsertest is rood op de oude 749-build. Groene gerichte fixrun 3/3 en volledige lokale browser4-run 124/124 PASS op exact `2f647cf`; definitieve MAIN-webworkflow 44776808678 eveneens volledig PASS |

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

## Verificatie en actuele uitgifte

De volledige exacte MAIN-webworkflow slaagt met 909 server-, 47 prototype-, 5 gerichte feed/chat- en 124 browsercases; nul failures/skips/retries. Player heeft 157 JVM-tests per drie varianten en 89 echte emulatorcases, Oche 34 per twee varianten en 16 cases op telefoon én TV; nul fouten/errors/skips. Alle 18 Player-MAIN-beelden en per hosted omgeving twaalf openbare desktop-/mobiele beelden zijn afzonderlijk bekeken. De aparte gerichte 45/45 communicatie-/protocol- en 50/50 support-/domeinruns overlappen de volledige suite en worden er niet als extra unieke dekking bij opgeteld.

De bronmigraties zijn exact toegepast op beide PG17-projecten, na verse beschermde backups met geverifieerde readback. Alle 35 metadata-/rechtenchecks slagen, 24 orphancontroles zijn nul en 36 sporttellingen/fingerprints zijn onveranderd. De drie featuremarkers zijn elk 1 en de migratiehistorie is met exact twee items per omgeving uitgebreid. Bestaande Auth leaked-password-WARN en twee owner-only RLS-INFO's blijven gelijk; advisorydelta nul. De Auth-instelling is een bestaand P2-beheerpunt buiten deze schemawijziging, geen reden om brede browserpolicies toe te voegen.

Historische mislukte/onderbroken pogingen blijven apart bewaard: eerdere lokale fixture-/cleanupfouten en afgebroken rondes tellen niet als pass; de 508-web-PR bereikte de werkelijke twintigminutengrens op 121/124; f6-PR vond een echte Oche-twee-tab-nonce-race op 123/124. De smalle clientfix is eerst rood op de oude build en groen met de oorspronkelijke assertions op de nieuwe build bewezen. De eerste 2f-Player-poging startte geen UI-tests door publieke Maven404; de volledige tweede poging slaagde ongewijzigd. De eerste hosted browserprobe had een onvolledige fontallowlist; drie vaste publieke fontreads zijn toegevoegd, alle overige guards behouden en de volledige proef herhaald met 25 geslaagde guardtests en 12 goede beelden. Dit wijzigde geen applicatiebron of releasegates.

Geauthenticeerde hosted verificatie gebruikt het bestaande beschermde review-account en gewone GET-projecties met beheer403-grenzen; ticketdetaildekking/missing-versus-foreign-basis staat exact in de private receipts. Echte ticket-/campagne-mutaties en worker-/idempotentieherstel zijn met echte accounts/API/database in de geïsoleerde omgeving getest. Er zijn geen echte gebruikerscampagnes, hosted redactionele releases of proefberichten aangemaakt. Nieuwe OTP-/Google-aanmelding, fysieke Android-/Oche-ontvangst, externe pushbezorging en installatie op een specifieke telefoon zijn niet opnieuw gemeten. Store-trackstatus en provideracceptatie zijn daarvan afzonderlijke uitkomsten.

Zie [DartFlow 0.6.0](releases/0.6.0.md) voor de volledige bron-/runlinks, vorige 0.5.0, ondertekende hashes, twee normale deployments en vier afzonderlijke Play-acties. De normale herstelroute behoudt nieuwe support-/campagne-/sportgegevens en reconcileert outboxen vóór een oudere worker hervat.

Beheeruitleg: pas kanaalregels aan per gebeurtenis, controleer de bewaarde spelerskeuze en effectieve stand, maak voor een campagne een nieuwe preview en proefverzending, bevestig pas daarna de echte doelgroep. Herstel uitsluitend openstaande leveringen binnen dezelfde campagne. Publiceer redactionele releases los van operationele deployments en storepublicatie. Houd een supportantwoord openbaar en een interne notitie intern; gebruik de afzonderlijke publieke/administratieve revisie uit de actuele route.
