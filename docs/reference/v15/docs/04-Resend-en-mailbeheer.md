# Resend en mailbeheer

DartFlow verstuurt applicatiemails via de Resend API. Mailbeheer staat onder **Organiseren → Clubbeheer → Mailbeheer**, met **Sjablonen**, **Verzendlog**, **Automatiseringen** en **Instellingen**. De platformeigenaar beheert het verzendaccount. Clubbeheerders werken binnen hun eigen club. Danny onderhoudt de SMTP-configuratie en OTP-templates rechtstreeks in Supabase Auth. Google gebruikt de aparte OAuth-aanmeldstroom.

## Gecontroleerde prototypebasis

De audit betreft DartFlow Sites v15, broncommit `e27cccdbd0b6cd2144cc2f26cab9e2986a903e61`. `public/mail-engine.js` bevat 32 Nederlandse sjablonen. Daarvan hebben er 28 een actiehook, wachten er drie op serverlogica en valt de OTP-template onder Auth. De demo registreert mails in browseropslag. Het gesimuleerde verzendlog toont de ontvanger, aanleiding, snapshot, versie, testuitkomst en eventuele ontbrekende variabelen. De API-key, providerverzending, bezorgstatus en werkelijke rechten horen bij de serverimplementatie.

| Onderdeel | Werking in v15 | Overnemen op de server |
| --- | --- | --- |
| Catalogus en editor | Zoek/filter, tekstvelden voor onderwerp, preheader, titel, bericht en CTA, variabelen invoegen, veilig iframe met desktop- of mobiele preview en HTML-download | Dezelfde DartFlow-opmaak en tekstcontracten. Valideer velden en toegelaten variabelen in de API, escape tekst en bouw de CTA uit een goedgekeurde applicatieroute |
| Concept en publicatie | Concept en `published` zijn apart. Publicatie verhoogt de versie. Club gebruikt platformdefaults en eigen velden. Auth-tekst is in globale demo te bewerken, in clubscope alleen zichtbaar | Geversioneerde serverpublicaties, geauditeerde actor, compare-and-swap bij gelijktijdig wijzigen en een expliciete reset naar platformdefault. Auth-template via Danny |
| Test en log | Testmail gebruikt de huidige editor en synthetische gegevens. De logregel onderscheidt concept en actieve versie. Retry rendert hetzelfde snapshot opnieuw | Standaard preview of logtest. Een expliciete echte test gaat uitsluitend naar een vooraf toegelaten testadres, met dezelfde scopecontrole en beperkte frequentie |
| Automatiseringen | Per template een schakelaar. Bordoproep staat standaard uit. Scope-instellingen kunnen automatische appmails pauzeren. Herinneringsvoorkeur wordt opgeslagen | Afzonderlijk beleid voor optionele meldingen, verplichte account- en deelnameberichten en de wachtrij. Geplande herinneringen vragen een serverplanner |
| Instellingen | Zichtbare afzendernaam, afzenderadres, Reply-To en voorkeuren per scope. Resend-configuratie ontbreekt | Platformeigenaar configureert de Resend-key en toegestane afzender. Een club kan de toegestane afzendernaam en een geverifieerd antwoordadres beheren |
| Rechten | Beheerweergave controleert de lokale demorolvlag. Verzendlog filtert op actieve scope | Authenticeer en autoriseer iedere serverroute. Leid scope af uit het domeinobject en rechten uit actuele serverrecords |

`resolveTemplate` combineert vaste velden met gepubliceerde platform- en clubwaarden. De demo dedupliceert op `scope + templateId + eventId + genormaliseerd ontvangeradres`. `createMailItem` slaat subject, HTML, tekst, variabelen en templateversie als snapshot op. Het huidige adres komt uit een spelers- of aanvraagrecord. Een zaalspeler zonder gekoppeld adres krijgt geen verzendopdracht. `collectVenueMailEvents` leest alleen nieuwe logs van dezelfde speeldag met `id > previous.sequence`; de event-ID heeft de vorm `venue:<speeldag>:log:<logid>`. Port dit als servergedrag bij de geslaagde zaalmutatie. Een teller uit browseropslag is uitsluitend referentiedata.

## Volledige triggercatalogus

**Demo** betekent dat een concrete actie in v15 een gesimuleerde mail kan registreren. **Gepland** betekent dat de template beschikbaar is en de servergebeurtenis nog nodig is. **Auth** betekent dat Supabase Auth de uitvoerder is. Scope volgt de eigenaar van aanvraag, partij, kamer, competitie of speeldag. Sociale accountacties zonder clubcontext zijn platformbreed.

| Template-ID | v15 | Werkelijke aanleiding en ontvanger |
| --- | --- | --- |
| `auth-otp` | Auth | Speler vraagt een e-mailcode aan. Supabase Auth genereert en verstuurt de code naar het aanvragende adres |
| `welcome` | Gepland | Eerste geldig aangemaakte DartFlow-profiel, eenmaal naar de nieuwe speler |
| `registration-received` | Demo | `player`-formulier maakt een nieuwe open spelersaanvraag. Aanmelder krijgt ontvangstbevestiging |
| `registration-decision` | Demo | `approve-request` of `reject-request` voor een open spelersaanvraag. Aanmelder krijgt het besluit |
| `club-request` | Demo | `clubs-join` bij aanvraagbeleid of `clubs-demo-request`. Clubeigenaar en clubbeheerders krijgen de open aanvraag |
| `club-decision` | Demo | `clubs-approve`, `clubs-reject` of rechtstreeks toetreden bij open lidmaatschap. De betrokken speler krijgt het besluit |
| `club-role` | Demo | `clubs-role` verandert daadwerkelijk een bestaande clubrol. Mail naar dat lid |
| `friend-request` | Demo | `portal-friend` maakt een nieuw open verzoek. Mail naar de gevraagde vriend |
| `friend-accepted` | Demo | `portal-accept-friend` of de tegenstandersimulatie `portal-simulate-friend`. Mail naar de oorspronkelijke aanvrager |
| `challenge-invite` | Demo | Gerichte menselijke uitnodiging via `rooms.createGame` of `community-challenge`. Mail naar de uitgedaagde speler |
| `challenge-accepted` | Demo | `community-accept` of de demoactie `room-opponent-ready`. Mail naar de oorspronkelijke uitdager |
| `challenge-cancelled` | Demo | `community-cancel` of `community-decline` beëindigt een open uitnodiging. Mail naar de andere speler |
| `room-invite` | Demo | `community-create` met een geselecteerde vriend. Mail naar die vriend |
| `moderation-notice` | Demo | `community-mute`, `community-kick`, `community-ban` of `community-promote` naar het betrokken kamerlid. `portal-resolve-report` geeft de melder een afhandelbericht in de single-userdemo |
| `moderation-report` | Demo | `portal-report` maakt een nieuwe melding. Demo-platformbeheer ontvangt het bericht. Leid productieontvangers af uit de actuele bevoegdheden voor het dossier |
| `competition-entry` | Demo | `comp-join` voegt speler toe aan de competitie. Mail naar de toegetreden speler |
| `fixture-changed` | Demo | `comp-plan` maakt een tijdvoorstel. Mail naar de andere wedstrijdspeler met status **Voorstel** |
| `fixture-scheduled` | Demo | `comp-accept-time` bevestigt het voorstel. Beide spelers krijgen het afgesproken tijdstip |
| `fixture-reminder` | Gepland | Een bevestigde, open wedstrijd bereikt het ingestelde moment. Mail naar spelers die herinneringen ontvangen |
| `tournament-entry` | Demo | `app.js` `join-tour` maakt een open aanmelding. Mail naar de aanmelder. De zaaltoernooistroom gebruikt de bevestiging of wachtlijsttemplate |
| `tournament-approved` | Demo | Toernooiaanvraag wordt goedgekeurd of zaalinschrijving geeft direct een plaats. Mail naar de bevestigde deelnemer |
| `tournament-rejected` | Demo | `reject-request` voor een toernooiaanvraag. Mail naar de aanmelder |
| `tournament-changed` | Demo | Het `tournament`-formulier verandert naam, datum of locatie. Mail naar unieke adressen in de goedgekeurde aanvragen |
| `tournament-waitlist` | Demo | Zaalinschrijving eindigt op de wachtlijst. Mail naar de geregistreerde speler met adres |
| `tournament-promoted` | Demo | Een beschikbare plaats leidt via `promote` tot een definitieve plek. Mail naar de doorgeschoven speler met adres |
| `tournament-withdrawn` | Demo | De zaalactie `withdraw` slaat een afmelding op. Mail naar de afgemelde speler met adres |
| `tournament-reminder` | Gepland | Toernooi of check-in bereikt de ingestelde herinneringstijd. Mail naar bevestigde deelnemers met deze voorkeur |
| `board-call` | Demo, standaard uit | Officiële zaaloproep via automatische of handmatige toewijzing, alleen zolang de partij `called` is. Mail naar beide spelers als optie aan staat |
| `result-confirm` | Demo | Laatste leg in wedstrijdkamer of zaalstatus `pending` na de actie. Beide menselijke demospelers krijgen de vraag. Bepaal op productie wie daadwerkelijk nog moet bevestigen |
| `result-confirmed` | Demo | Beide bevestigingen of zaalstatus `confirmed`, inclusief een geldige baanimport. Beide spelers krijgen de definitieve stand |
| `result-disputed` | Demo | `room-dispute` of zaaldispuut. Mail naar beide spelers en bevoegde wedstrijdleiding |
| `result-resolved` | Demo | `portal-resolve-dispute` of zaalbesluit via `resolve`/`forfeit`. Beide spelers krijgen het vastgelegde besluit |

De competitie-/toernooi-overzichten hebben eigen deelnameknoppen. Hun labels in de catalogus beschrijven de productstroom ruimer dan de huidige hooks. Koppel productie aan elke echte, geaccepteerde domeinovergang en controleer dat een zaalregistratie maar één passende eerste bevestiging geeft. De QR-baanmodus gebruikt demoprofielen met schermnamen. Een productie-uitnodiging of definitieve baanuitslag gebruikt het geverifieerde account en dezelfde outbox. Een officiële zaalimport is een afzonderlijk toegestaan beslismoment met een eenduidige eigenaar.

QR-scans, tussenscores, chatberichten, training, statusverversing, kopiëren van codes, check-in en schrijversovername blijven appgebeurtenissen. Een bordoproep blijft primair zichtbaar op telefoon en zaalscherm. Houd bordmail optioneel en laat de job verlopen zodra de partij is gestart. Stuur voor moderatie en geschillen een korte neutrale samenvatting. De bevoegde gebruiker opent het volledige dossier na inloggen.

## Sjablonen en regels op de server

Gebruik vaste veldtypes en een renderfunctie die exact dezelfde template naar HTML en platte tekst vertaalt. Publicatie valideert variabelen per template tegen de catalogus. De server vult gegevens uit bevoegde records, bouwt absolute HTTPS-links op de eigen omgevingsorigin en verwijdert regeleinden uit headers. Gebruik een gecontroleerde logo-URL op diezelfde omgeving en een tekstfallback. Hergebruik het groen/zwarte v15-ontwerp, de vloeiende mailtabel met inline stijlen, begrijpelijke links en mobiele preview. Een GET naar een mail-CTA opent de actuele pagina. Een wijziging of akkoord vraagt daarna een bevoegde POST.

Sla concept, publicatie en triggerbeleid afzonderlijk op. Een concept kan naar een voorbeeld of expliciete test. Een automatische job gebruikt de actieve publicatie bij de businesscommit. Bewaar ID en versienummer, exacte HTML en tekst en de afzendersnapshot bij de job. Een cluboverride mag de eigen scope en toegestane tekstvelden wijzigen. Een bestaand bericht blijft aan zijn oorspronkelijke versie gekoppeld.

Laat gebruikers optionele sociale meldingen en herinneringen per categorie regelen. Functionele besluiten over hun aanvraag, inschrijving of wedstrijd volgen het vastgestelde productbeleid. Pas blokkeer- en suppressieregels toe op het moment van aanbieden. Herinneringen krijgen de afspraakrevisie en een uiterste verzendtijd. Een gewijzigde wedstrijd annuleert de oude nog open reminder. Bewaar UTC en formatteer Nederlandse tijden met `Europe/Amsterdam`.

## Resend-sleutel beheren

Voeg in **Platformbeheer → Integraties** voor de platformeigenaar een kaart **Resend** toe, naast **Google Auth**. Geef **Mailbeheer → Instellingen** een directe link naar deze kaart voor bevoegde beheerders. Toon de doelomgeving, status **Ontbreekt**, **Opgeslagen**, **Getest** of **Actie nodig**, de laatste wijziging en testuitkomst. De actie **Sleutel toevoegen/vervangen** bevat een leeg wachtwoordveld en slaat na servervalidatie op. De actie **Testmail versturen** toont template, toegelaten adres en doelomgeving vooraf. De sleutel heeft uitsluitend verzendrechten en is waar ondersteund beperkt tot het geverifieerde verzenddomein. Aanmaken en intrekken gebeurt in Resend. [Resend API-key aanmaken](https://resend.com/docs/api-reference/api-keys/create-api-key)

De kaart beheert afzendernaam, afzenderadres, Reply-To, uitgaande verzendmodus binnen het omgevingsbeleid en de toegelaten testadressen binnen de runtimegrenzen. Toon de webhook-URL met kopieerknop, een write-only invoer voor het signing secret en de laatste geverifieerde webhookstatus. Gebruik een apart versleuteld credentialrecord per geheimsoort. Toon korte instructies voor het geverifieerde DNS-domein en voor het registreren van het endpoint in Resend. Een status- of adreswijziging past ongeclaimde jobs uitsluitend aan via het afgesproken queuebeleid en bewaart reeds aangeboden berichtsnapshots.

| Grens | Implementatie |
| --- | --- |
| Wie | Server controleert de actuele `platform owner`-bevoegdheid per lees-, schrijf-, test-, rotatie- en intrekactie. Clubbeheerders krijgen uitsluitend hun eigen mailbeleid en logprojectie. Gebruik de bestaande recente-herauthenticatie bij sleutelwijziging |
| Schrijven | Verstuur de invoer over HTTPS via een afgeschermde mutatie met dezelfde origin- en sessiecontrole als andere gevoelige beheeracties. `GET` geeft alleen statusmetadata. Antwoord op opslaan met successtatus en audit-ID. Wis het wachtwoordveld na opslaan |
| Opslag | Versleutel de ingevoerde API-key en het signing secret server-side met authenticated encryption. Bewaar sleutelversie, unieke nonce en ciphertext in een private tabel. Houd `DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY` in de beschermde runtimeconfiguratie. Bind project, omgeving en geheimsoort cryptografisch aan de envelop. De database-envelop is de bron voor elk ingesteld credential |
| Lezen | Alleen de servertransportadapter vraagt het geheim op. Gebruik `Cache-Control: no-store` voor eigenaarinstellingen en redacteer request bodies, authorization headers en secretreferenties uit logs, foutresponses, tracing en exports. De audit bewaart actor, tijd, omgeving, operatie en resultaat |
| Roteren | Maak een nieuwe verzendsleutel met dezelfde beperkte rechten. Voer de toegelaten transporttest uit en activeer de nieuwe sleutel via de eigenaaractie. Verifieer één geldige verwerking en trek daarna de vorige providerkey in. Bewaar de bestaande job-ID en het transportsnapshot bij een retry |
| Omgevingen | Staging en productie krijgen een eigen secret namespace, Resend-key, webhooksecret, afzenderconfig, database, `DARTFLOW_APP_ORIGIN` en afzonderlijke runtimeaccounts volgens DG. De server kiest de omgeving uit `DARTFLOW_ENV` |

Een opgeslagen sleutel is pas getest na provideracceptatie. Een verzendsleutel met beperkte rechten hoeft geen domein- of accountlijsten te kunnen lezen. Test met de eigen send-endpoint en een toegelaten testmailbox. Splits opslaan, transporttest en loginspectie in afzonderlijke rechten en auditregels. Een geweigerde key of afzender zet de transportstatus op **Actie nodig** en pauzeert betrokken jobs tot de eigenaar het probleem heeft verholpen.

## Afzender en testgrenzen

Configureer `From` als het gekozen adres op een in Resend geverifieerd domein. Valideer SPF, DKIM en de vastgestelde DMARC-instelling op de werkelijke DNS-zone. Gebruik gescheiden afzenderconfiguratie per omgeving. Valideer clubnaam en Reply-To tegen de toegestane clubcontacten. De server accepteert alleen de vastgelegde afzenderadressen en bewaakt headerlengte en adresvalidatie. Controleer de providerstatus via de beheeromgeving. [Resend verzenddomeinen](https://resend.com/docs/dashboard/domains/introduction) · [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email)

Start staging met een logtransport. De server laat echte tests alleen toe naar exacte adressen uit de afgesproken allowlist. Controleer de allowlist bij aanmaak en opnieuw vlak vóór verzending. Zet een herkenbaar testlabel in het onderwerp en gebruik fictieve data. Begrens frequentie per eigenaar en omgeving. Handmatige tests op productie volgen dezelfde testontvangersgrens. Gebruik afzonderlijke, expliciet geconfigureerde live-verzendmodus voor echte domeingebeurtenissen. Een databasekopie of opnieuw opgebouwde stagingomgeving start met logtransport en eigen secrets.

## Transactionele outbox en worker

1. Autoriseer de domeinmutatie en leid scope en ontvangers af uit de actuele rijen. Vergrendel of vergelijk de domeinrevisie. Hergebruik hetzelfde request-ID voor netwerkherhaling en controleer een canonieke payloadhash.
2. Commit domeinmutatie, ontvangstbewijs, mail-event en concrete job in één Postgres-transactie. Gebruik een blijvende unieke sleutel op `(environment, scope_key, event_id, template_id, recipient_key)`. Gebruik een geverifieerd account-ID of een stabiele ontvangersleutel voor een aanvraag met alleen een e-mailadres. Een rollback laat de vier records achter in hun vorige toestand.
3. Bewaar templateversie, bestemming, HTML, tekst, subject, From, Reply-To, verloopmoment en een eigen stabiele transportsleutel. Gebruik voor dezelfde job een vaste Resend `Idempotency-Key`, bijvoorbeeld `dartflow/<environment>/mail/<uuid>`. De payload blijft bij iedere transportpoging gelijk.
4. Claim een beperkte batch met `FOR UPDATE SKIP LOCKED`, een claimtoken en tijdige lease. Commit de claim en roep daarna de Resend API aan. Werk alleen de eigen geldige claim bij. Begrens batchgrootte en timeout en herbeoordeel geplande of gepauzeerde jobs vóór transport.
5. Behandel tijdelijke transportfouten met begrensde backoff en jitter. Respecteer een geldig `Retry-After`-signaal. Classificeer permanente adres- of afzenderfouten apart. Bij twijfel na netwerkuitval gaat de job naar **Onzeker** en volgt reconciliatie met providerinformatie of terugmeldingen. De herhaalactie gebruikt dezelfde job, versie en sleutel.

Resend houdt idempotentiesleutels 24 uur vast en de documentatie noemt maximaal 256 tekens per sleutel. De unieke appjob en audit blijven buiten dat providervenster bestaan. Zodra het providervenster is verstreken, vraagt een onzekere job controle voordat opnieuw verzenden wordt toegestaan. Bewuste nieuwe verzending krijgt een nieuw bevoegd event met reden en verwijzing naar de oorspronkelijke job. [Resend idempotentiesleutels](https://resend.com/docs/dashboard/emails/idempotency-keys)

Gebruik private databasetabellen voor jobs, payloads, versies en providergebeurtenissen. De gewone browserrollen krijgen alleen bevoegde API-projecties. Houd servercredentials en workerrechten beperkt per omgeving. Een clubbeheerder leest alleen eigen logregels. Platformbrede logs vragen platformrechten. Stel bewaartermijnen vast voor inhoud, geadresseerde, status en een minimaal dedupspoor. Laat releases en databaseherstel jobs en providerhistorie reconciliëren voordat live transport wordt hervat.

## Bezorgwebhooks

Registreer één HTTPS-webhookendpoint per omgeving, bijvoorbeeld `POST /api/mail/resend/webhook`. Voer het eigen signing secret in via **Platformbeheer → Integraties → Resend**. De webhookhandler leest het server-side uit het private credentialrecord. Lees de body als ongewijzigde tekst en geef de body en `svix-id`, `svix-timestamp` en `svix-signature` via `request.headers.get(...)` door aan de officiële verifier. Verifieer voordat de eventgegevens de database bereiken. [Resend webhookverificatie](https://resend.com/docs/webhooks/verify-webhooks-requests)

Sla een gevalideerd event duurzaam op met unieke `(environment, provider, provider_event_id)`. Koppel op providerbericht-ID in dezelfde omgeving. Verwerk een dubbel event idempotent. Een event kan arriveren voordat de worker het bericht-ID heeft opgeslagen. Bewaar zo'n event als te reconciliëren en koppel het alsnog zodra de job beschikbaar is. Geef een succesvolle response na de duurzame ontvangst. Gebruik een expliciete statustoestandsmachine en accepteer bijvoorbeeld **Klacht** na **Afgeleverd**. Een vertraagd **Geaccepteerd** mag de eindstatus niet terugdraaien.

| Logstatus | Betekenis |
| --- | --- |
| In wachtrij / Bezig | Domeincommit is geslaagd en de worker plant of verwerkt de verzending |
| Geaccepteerd | Resend heeft de send-opdracht aangenomen en gaf een bericht-ID terug |
| Afgeleverd | Een geverifieerde providergebeurtenis bevestigt aflevering aan het ontvangende mailsysteem |
| Vertraagd / Opnieuw proberen | Tijdelijke blokkade met volgende poging of providervertraging |
| Onzeker | Een transportpoging is gestart en de uitkomst wacht op reconciliatie |
| Gebounced / Klacht / Mislukt | Provider of applicatie heeft een concrete blijvende of uitgeputte fout vastgelegd |
| Onderdrukt / Geannuleerd | Voorkeur, blokkade, verlopen job of gewijzigde domeintoestand voorkomt verzending |
| Gesimuleerd | De logtransportadapter heeft het bericht lokaal verwerkt |

Meet wachtrijlengte, oudste open job, geaccepteerde berichten, aflevering, bounce, klacht en onzekere jobs. De afhandeling van een bounce of klacht volgt het omgevingsgebonden suppressiebeleid. Houd incident- en herstelbewijs bij de echte release-SHA en provider-ID's, met geschoonde gegevens.

## Supabase Auth en SMTP door Danny

Voor e-mail-OTP gebruikt de app de Auth-stroom. Danny zet het bijbehorende template met `{{ .Token }}` en de actuele geldigheidsinformatie in het bedoelde Supabase-project. SMTP-host, poort, gebruikersnaam, wachtwoord en Auth-afzender blijven in die afzonderlijke Auth-configuratie. Het applicatiescherm toont de fictieve OTP-preview en de beheerlocatie. De Resend-sleutel in Mailbeheer is bedoeld voor applicatiemails. OTP, sessiegegevens en Google-callbackcodes blijven in hun eigen Auth-pad. De welkomstjob ontstaat bij het eerste geverifieerde profiel, ook als Google de gebruikte aanmeldmethode is. [Supabase e-mailtemplates](https://supabase.com/docs/guides/auth/auth-email-templates) · [Supabase Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

## Acceptatie voor Codex

| Controle | Bewijs |
| --- | --- |
| Rollen en keybeheer | Platformeigenaar kan sleutel toevoegen, testen en vervangen. Clubbeheerder en speler worden bij directe routes geweigerd. Configresponses, browserbundles, logexport en foutmeldingen tonen alleen toegestane metadata |
| Scope en versies | Club A kan club B niet lezen of wijzigen. Concepttest gebruikt concept, eventjob gebruikt actieve versie. Twee gelijktijdige publicaties geven één nieuwe revisie en een duidelijk conflict |
| Verzending en retry | Herhaald businessrequest levert één job per ontvanger op. Rollback levert geen job. Twee workers krijgen verschillende geldige claims. Een crash na aanbieden volgt het onzekere herstelpad met dezelfde providerkey |
| Webhooks | Geldig event, herhaling, gewijzigde body, verkeerde omgevingshandtekening, onbekend bericht-ID en afwijkende volgorde zijn getest. Log toont acceptatie en aflevering op basis van afzonderlijk bewijs |
| Test- en omgevingsgrens | Gesimuleerde test, toegelaten echte test en geweigerde ontvanger zijn zichtbaar. De app gebruikt sleutel, webhooksecret en origin van de eigen omgeving. Een verkeerde webhookhandtekening en een verkeerd gebonden sleutelenvelop worden geweigerd |
| Auth | Danny kan Auth-template en SMTP aanpassen via Supabase. De app bewaart geen echte code in verzendlog, outbox of exports. Google-login maakt hoogstens één welkomstjob bij nieuw profiel |
| Werkelijke mailclient | Controleer onderwerp, preheader, HTML, tekst, toegankelijke CTA en mobiel gedrag in de afgesproken testmailboxen. Verifieer ontvangen mail, afzenderauthenticatie en webhookstatus |

De [32 gerenderde mailvoorbeelden](../voorbeelden/mailcatalogus/index.html) bevatten de HTML- en tekstvarianten van v15. `voorbeelden/resend-mail.env.example` en `voorbeelden/resend-mail-contract.ts` geven de configuratie en adaptergrens weer. Gebruik de werkelijke DG-inventaris voor de systemd-worker, beschermde omgevingsconfiguratie en deployinterface. Verifieer de actuele versie van de Resend SDK en de officiële documentatie bij implementatie. Het handoffvoorstel is geschreven op 11 november 2026.
