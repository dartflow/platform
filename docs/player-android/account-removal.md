# Accountverwijdering

De publieke onafhankelijke aanvraagpagina is `/account-verwijderen`, met uitleg,
een verwijderactie vanuit een geverifieerde eigen sessie en de fallback
`info@dartflow.nl`. De mailroute is voor spelers die niet meer kunnen aanmelden;
een medewerker moet accountbezit controleren voordat die route tot wissen leidt.
Een ontvangst van een mail is geen automatische verificatie.

## API

- `GET /api/account/deletion`: `getAccountDeletionStatus(verifiedActorId)`.
- `POST /api/account/deletion`: `requestAccountDeletion(verifiedActorId, body,
  {recentAuth})` met `requestId` als UUID en `confirmation: "VERWIJDEREN"`.
- Native v1 gebruikt dezelfde achterliggende actie, met de eigen bearerprincipal.
- `recentAuth` komt uitsluitend uit geverifieerde Auth-claims (OTP/OAuth maximaal
  vijftien minuten oud); een bodyveld of nieuw refresh token bewijst dit niet.
- Een succesvolle bevestiging zet direct een tombstone en één duurzame job per
  actor. Zowel cookie- als native authenticatie moet `assertAccountActive()`
  aanroepen vóór profielverversing of een beveiligde actie. De database blokkeert
  ook het terugschrijven van een verwijderd profiel door de runtime.
- Een timeout na bevestiging is veilig opnieuw te proberen: een nieuwe job wordt
  niet aangemaakt. Annuleren/herstellen van een geaccepteerd verzoek is er niet.

## Worker en configuratie

De webapp krijgt geen Auth-adminsleutel of privacy-databasecredential. De aparte
systemd-timer draait elke minuut als een afgeschermde service-identiteit:

```sh
node --import tsx scripts/account-removal-worker.ts --once
```

Benodigde variabelen, uitsluitend in het worker-environmentbestand:

- `DARTFLOW_PRIVACY_DATABASE_URL`: verbinding met rol `dartflow_privacy_worker`.
- `NEXT_PUBLIC_SUPABASE_URL`: het Auth-project van diezelfde omgeving.
- `SUPABASE_AUTH_ADMIN_KEY`: server-side Auth-adminsleutel, nooit `NEXT_PUBLIC_`.
- `DARTFLOW_DATA_MODE`: de bijbehorende mode; lokale verificatie gebruikt uitsluitend
  een loopbackdatabase en een synthetische Auth-adapter.

Migratie `20261118124107_account_deletion_jobs.sql` maakt de beperkte workerrol.
Follow-up `20261118130850_scrub_deleted_score_event_names.sql` koppelt
animatiegebeurtenissen zonder profiel-ID via de vaste wedstrijddeelnemer, zodat
ook oude gebruikersnamen uit de displaycache verdwijnen. Solo-animatiecaches
van het verwijderde account worden gewist.
De hostprovisioner stelt het wachtwoord veilig in. De rol kan alleen de queue
lezen, beperkte verwerkingskolommen wijzigen en de private cleanupfunctie
uitvoeren. De runtime, `PUBLIC`, `anon` en `authenticated` krijgen geen uitvoerrecht
op de cleanupfunctie. De functie heeft een vaste search_path en accepteert alleen
een bevestigde job met een actuele geclaimde lease, nooit een willekeurig account.

De worker verwerkt maximaal vijf jobs per run. Een job heeft een lease van vijf
minuten. Eerst wordt de applicatieopslag transactioneel opgeschoond, daarna wordt
Supabase Auth hard verwijderd. Een Auth-storing bewaart de fase `app_erased` en
plant een retry. De blokkade blijft actief, ook voor een JWT dat cryptografisch
nog geldig is. Fouten worden zonder persoonsgegevens of providerpayload gelogd.
Een failed timer en jobs met herhaalde pogingen vragen operationele opvolging.

## Wat wordt gewist en wat blijft?

Contactvelden, PIN-verifier, sociale relaties, persoonlijke voorkeuren,
intakeantwoorden, private signaalpayloads, persoonlijke mail-outboxgegevens,
geschreven berichten en eigen communityinhoud worden gewist of leeggemaakt.
Persoonlijke deelkoppelingen en door het account verstrekte schermtoegang worden
ingetrokken. Eventuele reviewcredentials van dit account worden verwijderd.

Actieve fysieke sessies volgen de bestaande transactionele vrijgave: vrij spel
wordt afgebroken zonder voorlopige scorehistorie; officiële partijen worden
onderbroken met behoud van voortgang. Reeds vastgelegde resultaten, brackets en
onderlinge uitslagen blijven voor de andere deelnemers en organisatie bestaan.
De identiteit wordt daar `Verwijderde speler`; ook oudere denormaliseerde namen
bij hetzelfde profiel-ID worden opgeschoond. Andere spelers blijven behouden.

Een minimaal tombstoneprofiel met de stabiele technische ID blijft bestaan om
foreign keys, uitslagen en idempotentie veilig te houden. Dit is pseudonimisering,
geen bewering dat iedere technische verwijzing onomkeerbaar anoniem is. Een
technische eigenaarsrij van een club kan om diezelfde reden blijven bestaan; deze
heeft geen naam, e-mail, credential of mogelijkheid tot aanmelden. De organisatie
kan met ondersteuning het beheer regelen. Administratieve auditverwijzingen
blijven zonder profielcontactgegevens bestaan.

Deze taak wist de actuele applicatiedatabase en Supabase Auth. Bestaande berichten
die andere ontvangers onafhankelijk hebben bewaard, back-ups en leveringslogs bij
verwerkers zijn geen rechtstreeks bestuurbare apprecords. Hun werkelijke
bewaarbeleid en eventueel benodigde providerverzoeken moeten in het operationele
privacybeleid worden gevolgd. Er is geen verzonnen algemene termijn van 30 of
90 dagen. Een restore uit back-up mag nooit zonder opnieuw toepassen van de
verwijderjobs/tombstones als actieve omgeving worden geopend.

## Lokale regressies

`tests/account-removal.test.ts` en `tests/account-removal-db.test.ts` gebruiken
uitsluitend synthetische loopbackrecords. Ze controleren recente authenticatie,
expliciete bevestiging, dubbele aanvragen, de directe blokkade, PIN-toegang,
afgeschermde cleanuprechten, de Auth-netwerkfout, concurrente workers, retries en
het behouden van een officiële uitslag met verwijderde oude profielnaam.
