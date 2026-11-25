# Notificatietriggers en kanaalkeuze

Deze audit hoort bij de support-/releasewijzigingen vanaf `9d92e50b14589d55488fa979353e18f238d0016a`. De tabel beschrijft de huidige domeintransacties en workers; hij is geen bewijs van een productie-uitrol of fysieke pushontvangst. De catalogus bevat 66 unieke templates: 65 beheerbare gebeurtenissen en de bestaande, alleen-lezen Auth-OTP-template.

## Gedeelde regels

`lib/integrations-catalog.ts` is de catalogus. `lib/notification-core.ts` bepaalt de toepasselijke kanalen en de effectieve stand per gebeurtenis. In onderstaande tabellen betekent **E/I/P** e-mail/inbox/push. Een genoemd kanaal staat bij een ontbrekende spelerskeuze en beheerregel standaard aan. Een expliciet bewaarde keuze blijft behouden; `follow`, `on` en `off` bepalen de effectieve stand. De bestaande mailvoorkeuren blijven als terugval gelden. Moderatie wordt onder **Moderatie** ingedeeld, directe chat onder **Chat**, en de oude categorie Account onder **Beveiliging**.

Een toepasselijk kanaal is geen bezorggarantie. E-mail gebruikt ook de bestaande template-, afzender-, omgeving-, log/test/live- en providergrenzen. Push vereist een geldig accountgebonden abonnement en toestel-/browsertoestemming. Een beheerstand geeft nooit die toestemming. Inbox en push worden onafhankelijk gekozen: een inbox kan blijven bestaan wanneer toestelpush uitstaat. `support-received` is uitsluitend E; `welcome` is E/I; `product-release` en `platform-message` zijn I/P. OTP en Auth-herstel blijven systeemmail buiten deze voorkeuren.

De domeinmutatie en `enqueueDomainMail` gebeuren in dezelfde transactie. De bestaande event-/ontvanger-/template-identiteit dedupliceert e-mail en inbox; de pushoutbox dedupliceert per inbox en abonnement. De nieuwe audittriggers gebruiken `enqueueAuditedNotification` en een getypeerde `notificationSource` uit `lib/notification-audit-source.ts`. Die controleert account, bron en actuele bevoegdheid vóór aanmaken. `domainMailApplicable` gebruikt dezelfde bron bij e-mailaflevering, native-/browserpush en openen. Ingetrokken rechten, verwijderde berichten, vervallen oproepen en achterhaalde reserveringsrevisies geven geen oude toegangsroute terug.

De nieuwe auditmeldingen bevatten een neutrale verwijzing, geen privéchattekst, reporttekst, accountadres, volledige naam, PIN of verifier. Support gebruikt uitsluitend DF-nummer en neutrale tekst, zonder onderwerp, bericht of medewerkersidentiteit. De specifieke private bestemming wordt pas na actuele autorisatie geopend. Oche-projecties krijgen deze private inbox niet.

## Account, sociaal, vereniging en moderatie

| Opgeslagen gebeurtenis / actie | Ontvanger | Kanalen | Template(s) | Doel en broncontrole | Implementatie |
| --- | --- | --- | --- | --- | --- |
| OTP aanvragen / Auth-herstel | Alleen het door Auth geverifieerde doel | Systeem-E | `auth-otp` | Bestaande Supabase Auth-flow; geen eigen app-OTP-event of kopie van codes | `lib/auth.ts`, Auth-configuratie |
| Nieuw geverifieerd account | Nieuw account | E/I | `welcome` | Eenmalige profielcreatie, eigen appstart | `lib/accounts.ts` |
| Bestaande publieke/privé-profielidentiteit echt gewijzigd | Eigen account | E/I/P | `account-profile-changed` | Eigen profiel; auditsequence als event-ID; geen alert voor eerste onboarding of no-op | `lib/profile-name.ts` |
| Gecontroleerd accountadres echt veranderd | Eigen account | E/I/P | `account-email-changed` | Eigen profiel; bestaande accountlock voorkomt herhaalde Auth-syncmeldingen | `lib/accounts.ts` |
| Bestaande spelers-PIN gewijzigd of gereset | Eigen account | E/I/P | `player-pin-changed` | Alleen nieuwe PIN-versie; eerste PIN-instelling blijft stil | `lib/player-pin.ts` |
| Spelersregistratie ingediend / beoordeeld | Aanvrager | E/I/P | `registration-received`, `registration-decision` | Eigen registratie; alleen platformbeheer kan beoordelen | `lib/platform-social.ts` |
| Vriendschapsverzoek | Andere speler | E/I/P | `friend-request` | Actueel verzoek en geen block; open dartmaatjes | `lib/platform-social.ts`, `domainMailApplicable` |
| Vriendschapsverzoek geaccepteerd | Oorspronkelijke afzender | E/I/P | `friend-accepted` | Actuele vriendschap en geen block | Dezelfde bronbestanden |
| Kameruitnodiging | Uitgenodigde bestaande speler | E/I/P | `room-invite` | Nog uitgenodigd, kamer open, geen block; kamerlink | `lib/platform-social.ts` |
| Nieuw bericht in besloten kamer met precies twee actieve deelnemers | De andere deelnemer | E/I/P | `chat-message` | Bericht niet verwijderd; beide nog bevoegd; geen block; geen berichttekst in melding | `lib/platform-social.ts`, `notification-audit-source.ts` |
| Nieuw bericht in afgeschermde wedstrijdchat | Andere actuele wedstrijddeelnemer | E/I/P | `chat-message` | Bestaand niet-verwijderd bericht, actuele matchchat-ACL en blockcontrole | `lib/community.ts` |
| Verenigingsuitnodiging | Concrete uitgenodigde speler | E/I/P | `club-invite` | Nog actuele uitnodiging / verenigingsstatus; vereniging openen | `lib/club-domain.ts` |
| Lidmaatschapsaanvraag opgeslagen | Aanvrager | E/I/P | `club-request-received` | Eigen aanvraagbevestiging | `lib/club-domain.ts` |
| Nieuwe lidmaatschapsaanvraag | Actuele leden met `members.approve` | E/I/P | `club-request` | Reviewercontrole en actuele aanvraag bij aflevering | `lib/club-domain.ts`, `lib/club-access.ts` |
| Definitief intake-/uitnodigingsbesluit | Betrokken speler | E/I/P | `club-decision` | Eigen aanvraag of eigen verenigingsomgeving | `lib/club-domain.ts` |
| Roltoewijzing of wijziging/verwijdering van een custom-roldefinitie | Werkelijk getroffen huidige rolhouders, zonder uitvoerder | E/I/P | `club-role` | Actief lidmaatschap opnieuw gecontroleerd; ongewijzigde rol stil | `lib/club-domain.ts` |
| Eigendomsoverdracht aangeboden | Actief aangewezen lid | E/I/P | `club-ownership-offer` | Exact aanbod, nog pending/onverlopen, oorspronkelijke eigenaar nog eigenaar | `lib/clubhouse.ts` |
| Eigendomsoverdracht aanvaard | Vorige eigenaar | E/I/P | `club-role` | Nieuw werkelijk eigenaarschap en bewaard actief lidmaatschap | `lib/clubhouse.ts` |
| Lid geschorst, verwijderd of hersteld | Betrokken speler | E/I/P | `club-membership-changed` | Eigen actuele lidmaatschapsstatus moet overeenkomen; geen oude interne beheerdetails | `lib/clubhouse.ts` |
| Locatiebeheer gegeven / ingetrokken | Betrokken beheerder | E/I/P | `location-role-changed` | Bestaande locatie en actuele aanwezigheid/afwezigheid van de rol; no-op stil | `lib/locations.ts` |
| Tijd/locatie clubactiviteit gewijzigd | Ingeschreven deelnemers en wachtenden | E/I/P | `club-activity-update` | Actief clublid, huidige activiteitlink | `lib/clubhouse-notifications.ts`, `lib/clubhouse.ts` |
| Deelnemer meldt zich af voor activiteit | Bevoegde organisator | E/I/P | `club-activity-withdrawal` | Actieve vereniging en actuele agenda | Dezelfde bronbestanden |
| Wachtende krijgt echt vrijgekomen activiteitplaats | Alleen daadwerkelijk gepromoveerde speler | E/I/P | `club-activity-promoted` | `UPDATE ... RETURNING`, geregistreerde deelname en toekomstig einde; geen zelfecho | `lib/clubhouse.ts` |
| Tijd/functie vrijwilligersdienst gewijzigd | Toegewezen vrijwilligers | E/I/P | `club-task-update` | Actief clublid en taaklink | `lib/clubhouse-notifications.ts` |
| Report opgeslagen | Actuele bevoegde reviewers, zonder melder of beoordeelde speler | E/I/P | `moderation-report` | Open report; actuele platform-/scopebevoegdheid; geen reporttekst | `lib/platform-social.ts`, `notification-audit-source.ts` |
| Report beslist | Eigen melder en betrokken speler, zonder uitvoerder | E/I/P | `moderation-notice` | Alleen eigen definitieve afhandeling; subjectprojectie maskeert melder en gemelde inhoud | `lib/platform-social.ts`, `lib/platform.ts` |
| Bestaande kamermoderatieactie | Betrokken deelnemer | E/I/P | `moderation-notice` | Bevoegde kamerbeheeractie; kamer-/moderatieoverzicht | `lib/platform-social.ts` |

## Wedstrijden, competities, toernooien en reserveringen

| Opgeslagen gebeurtenis / actie | Ontvanger | Kanalen | Template(s) | Doel en broncontrole | Implementatie |
| --- | --- | --- | --- | --- | --- |
| Uitdaging / lobby-uitnodiging | Concrete andere speler | E/I/P | `challenge-invite` | Actuele uitnodiging, open lobby, geen block; fysieke claim heeft deadline | `lib/platform-boards.ts`, `lib/platform-competitions.ts` |
| Uitdaging geaccepteerd / ingetrokken | Andere betrokken deelnemer | E/I/P | `challenge-accepted`, `challenge-cancelled` | Bestaande lobby en eigen betrokkenheid | `lib/platform-competitions.ts` |
| Lobbydeelnemer wordt voor het eerst gereed | Andere actieve deelnemers | E/I/P | `match-ready` | Actuele ready-vlag, open lobby zonder reeds gemaakte partij, actuele toegang; vervalt na 5 min | `lib/platform-competitions.ts` |
| Canonieke wedstrijdoproep geaccepteerd | Andere wedstrijdspelers | E/I/P | `match-ready` | Zelfde callRef, echte acceptatie, nog called/ready; 5 min | `lib/integrations-domain.ts` |
| Canonieke partij begint echt | Andere wedstrijdspelers | E/I/P | `match-started` | Zelfde callRef en actuele live-status; 5 min | `lib/integrations-domain.ts` |
| Competitie-inschrijving / status | Betrokken speler | E/I/P | `competition-entry` | Werkelijke inschrijftransactie en competitieomgeving | `lib/platform-competitions.ts`, `lib/integrations-domain.ts` |
| Toernooiaanmelding / akkoord / afwijzing | Betrokken speler | E/I/P | `tournament-entry`, `tournament-approved`, `tournament-rejected` | Werkelijke statusovergang; geen ruwe besloten afwijsreden in nieuwe notificatie | Dezelfde bronbestanden |
| Toernooiwachtlijst / promotie / afmelding | Betrokken speler | E/I/P | `tournament-waitlist`, `tournament-promoted`, `tournament-withdrawn` | Werkelijk gewijzigde deelname; dubbele submits via bestaande commandreceipts | Dezelfde bronbestanden |
| Toernooi-/lotings-/planningwijziging | Betrokken deelnemers | E/I/P | `tournament-changed` | Bevoegde opgeslagen wijziging; toernooilink | `lib/platform-competitions.ts`, `lib/tournament-management.ts` |
| Tijdvoorstel / aanvaarde fixtureplanning | Andere betrokken spelers / teams | E/I/P | `fixture-changed`, `fixture-scheduled` | Legacy fixture of seizoen met exact tijd-/voorstelbewijs; eigen voorstel geen echo | `lib/platform-competitions.ts`, `lib/season-reminders.ts` |
| Wizard publiceert echte competitie | Betrokken spelers / teamrosters | E/I/P | `fixture-scheduled` | Bestaande seizoensfixtures; één eerste relevante planning per speler binnen publicatie | `lib/competition-wizard-service.ts` |
| Start/check-in nadert | Betrokken ingeschreven spelers | E/I/P | `fixture-reminder`, `tournament-reminder` | Exact huidig tijdstip / fixture, niet afgesloten of achterhaald; event-ID uit bron+deadline | `planMailReminders`, `lib/season-reminders.ts` |
| Open speelvenster verstreken | Betrokken spelers/captains en leiding | E/I/P | `fixture-overdue` | Actueel open venster; opvolging, nooit automatische straf | `lib/season-reminders.ts` |
| Beheerde seizoensinschrijving / wachtlijst / uitnodiging / beëindiging | Eigen deelnemer | E/I/P | `season-entry` | Exacte actuele participantstatus, actief clublid waar vereist; werkelijk verschil voor/na opslag | `lib/notification-domain-triggers.ts`, `lib/seasons.ts` |
| Seizoensspeler checkt in | Tegenpartij / betrokken andere deelnemers | E/I/P | `season-check-in` | Nieuwe check-in op eigen fixture, huidige status en roster; 15 min | Dezelfde bronbestanden |
| Teamselectie/captain/plaatsvervanger vastgesteld | Actuele teamrosterleden | E/I/P | `season-team-role` | Actueel team-/rolbewijs en clublidmaatschap | `lib/season-reminders.ts` |
| Goedgekeurde reservewissel | Betrokken deelnemers / teams | E/I/P | `season-reserve` | Vastgelegd besluit, actuele opstelling | Dezelfde bronbestanden |
| Hybride speelvorm voorgesteld / bevestigd | Andere betrokken spelers / teams | E/I/P | `season-play-mode` | Actueel voorstel-/speelvormbewijs | Dezelfde bronbestanden |
| Seizoen afgesloten / gearchiveerd | Seizoensdeelnemers | E/I/P | `season-completed` | Werkelijke gecontroleerde status, blijvende historische verwijzing | Dezelfde bronbestanden |
| Canonieke geplande competitiepartij op QR-baan geopend | Exacte tegenstander | E/I/P | `competition-lobby-ready` | Alleen nieuw aangemaakte lobby; actuele spelers/PIN-/expiry-/baanbinding | `lib/competition-board-lobby.ts` |
| Baanoproep | Opgeroepen nog niet geaccepteerde spelers | E/I/P | `board-call` | Exact callRef + boardId, called/ready en niet al geaccepteerd; 5 min | `lib/integrations-domain.ts`, `domainMailApplicable` |
| Canonieke uitslag wacht op bevestiging | Nog betrokken bevestigers | E/I/P | `result-confirm` | Opgeslagen wedstrijdtransitie; eigen wedstrijd | `lib/integrations-domain.ts` |
| Uitslag bevestigd | Betrokken spelers | E/I/P | `result-confirmed` | Duurzame uitslagbevestiging, geen tweede event door receipt-retry | Dezelfde bronbestanden |
| Geschil / herstelbesluit canonieke partij | Betrokken spelers / bevoegde afhandelaren | E/I/P | `result-disputed`, `result-resolved` | Private wedstrijd-/dossierroute; nieuwe dossiermelding bevat geen besloten reden | `lib/integrations-domain.ts`, `lib/match-corrections.ts` |
| Beheerde ontmoeting voorlopig / captainbevestiging / geschil / besluit | Captains/plaatsvervangers bij voorlopig teamresultaat; partijen en bij geschil leiding | E/I/P | `season-result-review` | Exacte actuele fixturestatus en actuele seasonMailRecipients; uitvoerder uitgesloten | `lib/notification-domain-triggers.ts` |
| Baanreservering aangevraagd | Actuele locatie-eigenaar en gedeeld beheerders | E/I/P | `reservation-requested` | Werkelijke reservering revisie 0; locatiebeheer of actuele eventorganisatie | `lib/locations.ts` |
| Reservering geaccepteerd / afgewezen / geannuleerd | Aanvrager, actuele eventorganisatie en locatiebeheer, zonder uitvoerder | E/I/P | `reservation-updated` | Exacte nieuwe reserveringsrevisie; achterhaalde besluiten vervallen | `lib/locations.ts` |

## Support, releases en platformberichten

| Gebeurtenis | Ontvanger | Kanalen | Template | Doel / waarom stil | Bron |
| --- | --- | --- | --- | --- | --- |
| Nieuw ticket | Actuele platformondersteuning, zonder afzender | E/I/P | `support-created` | Beheerweergave exact ticket, neutraal DF-nummer | `lib/support-tickets.ts`, `lib/notification-events.ts` |
| Ontvangstbevestiging | Ticketeigenaar | E | `support-received` | Eigen gesprek; bewuste ontvangstbevestiging zonder eigen push-/inboxecho | Dezelfde bronbestanden |
| Gebruikersreactie / heropening | Nog bevoegde toegewezen medewerker, anders supportwachtrij | E/I/P | `support-user-replied`, `support-reopened` | Actuele eigenaar/rol/toewijzing bij afleveren en openen | Dezelfde bronbestanden |
| Supportantwoord | Ticketeigenaar, zonder afzender | E/I/P | `support-answered` | Antwoord plus status in één melding | Dezelfde bronbestanden |
| Handmatige openbare supportstatus | Ticketeigenaar, zonder afzender | E/I/P | `support-status-changed` | Actuele private ticketroute | Dezelfde bronbestanden |
| Interne notitie / prioriteit / toewijzing | Geen gebruiker | — | — | Interne tijdlijn en beheerrevisie; eigenaarrespons, activiteitstijd en meldingen blijven gelijk | `lib/support-tickets.ts` |
| Gebruiker sluit eigen ticket / detailscorrectie | Geen automatische echo | — | — | Openbare tijdlijn is voldoende; geen nieuwe opvolgtaak voor gebruiker | Dezelfde bron |
| Releaseconcept opslaan / preview / publiceren | Geen automatische ontvanger | — | — | Publiceren maakt alleen het redactionele item zichtbaar; verzenden is een afzonderlijke expliciete actie | `lib/product-releases.ts` |
| Bevestigde releasecampagne | Alleen actuele product-/kanaalgeschikte doelgroep | I/P | `product-release` | Gepubliceerde release; verse bereikpreview en expliciet `VERSTUREN` | `lib/notification-campaigns.ts` |
| Bevestigd platformbericht | Alleen actuele gekozen/alle geschikte accounts | I/P | `platform-message` | Eigen berichtdetail of gecontroleerde interne bestemming | Dezelfde bron |
| Campagnetest | Uitsluitend gekozen proefontvanger | I/P | `product-release` of `platform-message` | Los testbericht, geen campagne; actuele doeltoegang blijft verplicht | Dezelfde bron |
| Campagneherstel | Alleen nog retry/openstaande leveringen | I/P | Bestaande campagne | Geen nieuwe doelgroep of tweede campagne; dezelfde ontvanger-/eventidentiteit | Dezelfde bron |

## Acties zonder automatische broadcast

| Mutaties / workers | Reden en bestaande opvolging |
| --- | --- |
| Live scores, dartdetails, undo, bullworpen, spelstatistieken, eigen trainingsbeurten | Niet per beurt melden. Tegenstanders/schrijver en Oche gebruiken de actuele scoreprojectie; alleen readiness/start/uitslagovergangen zijn events. |
| Lotingpreview, concept opslaan, wizardstappen, organisatorconcepten, fase-/regelpreview, planningberekening | Nog geen gepubliceerde afspraak. Publicatie of echte latere planningwijziging gebruikt de genoemde trigger. |
| Algemene check-in bij een toernooi | Eigen routinemutatie; geen bericht aan alle deelnemers. Een concrete partijgereedmelding of beheerde ontmoetingcheck-in heeft wel een begrensde tegenpartijtrigger. |
| Openbare kamers, grotere kamers, verenigings-/teamkanalen, feedposts/-reacties/-likes en peilingen | Behoud bestaande lees-/ongelezen-/pollingweergave; geen algemene push per bericht. Het onderscheiden tweepersoonsprivébericht heeft nu een eigen trigger. |
| Vriendschapsverzoek weigeren, blokkeren, rapporteren door melder | Geen ongewenste zelfecho of melding van een block aan de geblokkeerde. Een report gaat uitsluitend naar bevoegde reviewers; een besluit naar de eigen betrokkenen. |
| Notificatievoorkeur, productabonnement, toestelregistratie/intrekking, inbox openen, push ontvangen/openen | Eigen controle-/meetacties. Geen melding over een melding; regelwijzigingen krijgen wel een append-only beheeraudit. |
| Opvragen, zoeken, pagination, refresh, cast-/Oche-scene, kijkerssignaal en cameraheartbeat | Lees-/presentatie-/aanwezigheidsactie, geen nieuwe opvolgtaak. |
| Vrij spelen, gastdeelnemers, gedeelde schrijvercapability, claim-/herstellink, baanverplaatsing | Private capabilityflow met expliciete UI; geen onbewezen gastadres/accountontvanger. Geen ruwe tokens in notificaties of publieke schermen. |
| Legchallenge-/finishpoging, persoonlijke adviesberekening en opslag | Eigen sport-/oefenactie. Een gedeelde link is geen serveropgeslagen uitnodiging aan een concrete accountontvanger. |
| Baanactiviteitstimer, verlopen lease, sessieretentie en accountverwijderingsworker | Bewaar/anonimiseer volgens bestaande domeinregels; geen notificatie per timerpoll. Geen mail/push naar een account waarvoor verwijdering is aangevraagd. |
| Rankingboekingen, generatieherbouw, broncorrectie en circuitafleiding | Geen technische replaymeldingen. De oorspronkelijke uitslag-/dossier-/competitieafhandeling is het betekenisvolle doel. |
| Premium-, branding-, thema-, kanaal-, contributie- en taakconfiguratie zonder toegewezen nieuwe opvolging | Configuratie/audit en actuele UI; geen broadcast voor iedere beheerwijziging. Bestaande taak-/activiteitafspraken en toegang-/rolwijzigingen hebben afzonderlijke triggers. |
| FAQ/handleiding/blogconcepten en publicatie, redactionele releasepublicatie, operationele deploy/Play-build | Publicatie is geen toestemming voor een campagne. Een release- of platformcampagne vereist apart voorbeeld, proefontvanger en bevestigde verzending. |
| Accountverwijderingsverzoek / bevestiging | Bestaande herauthenticatie en zichtbare status; na verwijderingsverzoek zijn nieuwe kanaalontvangers uitgesloten. OTP/herstel blijft Auth-eigendom. |

## Worker- en API-inventaris

- `app/api/[...path]/route.ts` blijft de gedeelde cookie/native actor-, CSRF-, body- en rate-limitgrens. Support en communicatie delegeren naar `lib/support-api.ts` en `lib/communication-api.ts`; native gebruikt dezelfde domeinfuncties via de bestaande allowlist.
- `lib/integrations-mail.ts`: opgeslagen domeinevents en immutable rendersnapshot, reminderplanning, campagneplanning, e-maillease/retry/providerverwerking en daarna native-/browserpush. De planner gebruikt brongebonden event-ID's en controleert huidige deadlines. Provideracceptatie wordt niet als fysieke bezorging voorgesteld.
- `lib/native-push.ts`: actieve account-/apparaatbinding, effectieve pushstand, broncontrole, retries en afzonderlijke accepted/received/opened-uitkomsten. `lib/web-push.ts` doet hetzelfde voor toegestane browserproviders en accountgebonden versleutelde subscriptions.
- `lib/notifications.ts` en `lib/notification-targets.ts`: eigen inbox, gelezenstatus en klikbare bestemming. Openen controleert actuele toegang opnieuw; een bekend oud commandreceipt geeft geen oude URL terug.
- `lib/notification-campaigns.ts`: vastgelegde preview/doelgroep, test, expliciete verzending en maximaal 50 geclaimde ontvangers per planningsbatch; kanaal-/product-/bestemmingstoegang wordt opnieuw gecontroleerd.
- `lib/account-removal-worker.ts`, `lib/board-activity-worker.ts` en `lib/play-sessions.ts` blijven bestaande opslag-/retentietaken, geen tweede notificatie-engine.

## Uitgevoerd bewijs en grenzen

De gerichte gecombineerde run van `tests/notification-audit-db.test.ts`, `tests/support-domain.test.ts`, `tests/support-tickets-db.test.ts`, `tests/profile-setup-db.test.ts` en `tests/player-pin-db.test.ts` slaagde lokaal met **50/50 tests, 0 fouten, 0 skips**, in 18,20 seconden. Acht echte domeincases testen security/no-op/retryprivacy, reserveringsrollen/revisieverval, accept/start/scorestilte/chatprivacy, rolhouders/revocatie, seizoensdeelname/check-in/uitslag/geschil/besluit, werkelijke wachtlijstpromotie, eigen moderatieprojectie en eigendom-/lidmaatschap-/locatierollen. De supportcases toetsen daarnaast transactie-rollback, concurrente DF-nummers, eigen zoek-/paginering, interne activiteitprivacy, huidige rechten vóór receipt-replay, legacy lege tijdlijnen en daadwerkelijke erasure.

Typecontrole en gerichte lint met nul waarschuwingen slaagden op deze bron. Dit is lokaal serverbewijs met geïsoleerde synthetische fixtures, zonder echte mail-/FCM-/browserprovider. De centrale volledige suite, browserflows, geïnstalleerde Android-app, fysieke ontvangst, hosted migraties en uiteindelijke CI-/release-SHA moeten apart worden vastgelegd. Een voorbereide native of browserinterface is op zichzelf geen gemeten bezorging.
